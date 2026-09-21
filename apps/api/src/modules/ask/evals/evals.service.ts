import { ConflictException, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { ExpectedBehaviorSchema, gradeDeterministic, type Actor, type Role } from '@daysheet/domain';
import type { EvalCase } from '@daysheet/db';
import { execSync } from 'node:child_process';
import { z } from 'zod';
import { AuditService } from '../../../platform/audit/audit.service';
import { PrismaService } from '../../../platform/persistence/prisma.service';
import { EnvService } from '../../../platform/config/env.module';
import { AskService, estimateCostCents } from '../application/ask.service';

/**
 * Evals run the real pipeline — tools, RBAC, verifier — against seeded records, then grade
 * each answer. Grading is deterministic wherever it can be (IDs cited, abstention reasons,
 * forbidden phrases); a small judge model scores wording only when a case carries a rubric
 * and the deterministic checks already passed. Results are stored so the UI shows real
 * runs with real failures, not a green badge.
 */

const JudgeSchema = z.object({ score: z.number().min(0).max(1), reason: z.string().max(300) });

export interface RunOptions {
  categories?: string[];
  limit?: number;
  requestedBy: Actor | null;
}

@Injectable()
export class EvalsService implements OnModuleInit {
  private readonly logger = new Logger(EvalsService.name);
  private readonly judge: Anthropic | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ask: AskService,
    private readonly audit: AuditService,
    private readonly envService: EnvService,
  ) {
    const key = envService.env.ANTHROPIC_API_KEY;
    this.judge = key ? new Anthropic({ apiKey: key, maxRetries: 2, timeout: 60_000 }) : null;
  }

  private get db() {
    return this.prisma.client;
  }

  /**
   * Starts a run and returns its id at once; the cases are graded in the background and the
   * run row fills as they land. A local model takes a minute a case, and no HTTP client should
   * hold a connection open for twenty of them. One run at a time: a second start while one is
   * grading is refused with the running id, because two runs would share one GPU and one clock.
   */
  async start(options: RunOptions): Promise<{ id: string; total: number; model: string }> {
    // Without a model the deterministic answerer is graded: the same gate, tools, graph and verifier, labelled as such on the run.
    if (!this.ask.live)
      this.logger.log('no model is answering Ask; grading the deterministic answerer through the same pipeline');
    if (this.running)
      throw new ConflictException({
        code: 'EVAL_RUN_IN_PROGRESS',
        message: `run ${this.running.id} is still grading; wait for it to finish`,
        runId: this.running.id,
      });
    const cases = await this.db.evalCase.findMany({
      where: {
        enabled: true,
        ...(options.categories?.length ? { category: { in: options.categories as never[] } } : {}),
      },
      orderBy: [{ category: 'asc' }, { createdAt: 'asc' }],
      take: options.limit ?? 100,
    });
    const run = await this.db.evalRun.create({
      data: { model: this.ask.model, gitSha: gitSha(), total: cases.length },
    });
    await this.audit.record({
      actor: options.requestedBy,
      source: options.requestedBy ? 'UI' : 'JOB',
      action: 'evals.started',
      entityType: 'EvalRun',
      entityId: run.id,
      after: { total: cases.length, categories: options.categories ?? 'all' },
    });
    const done = this.grade(run.id, cases, options)
      .catch((error: unknown) => this.logger.error(`eval run ${run.id} stopped: ${(error as Error).message}`))
      .finally(() => {
        this.running = null;
      });
    this.running = { id: run.id, done };
    return { id: run.id, total: cases.length, model: this.ask.model };
  }

  /** The run this process is grading, if any: the guard against two runs sharing one model and one clock. */
  private running: { id: string; done: Promise<void> } | null = null;

  /** Starts a run and waits for it: for a fast model or a test that wants the scorecard in one call. */
  async run(options: RunOptions) {
    const { id } = await this.start(options);
    await this.running?.done;
    return this.db.evalRun.findUniqueOrThrow({ where: { id } });
  }

  /**
   * A run this process was grading when it stopped is closed with what it had: the row says
   * finished, its passed count is the results that landed, and the log says it was cut short.
   * Otherwise the Evals page would show it running forever.
   */
  async onModuleInit(): Promise<void> {
    const orphans = await this.db.evalRun.findMany({
      where: { finishedAt: null },
      include: { _count: { select: { results: { where: { passed: true } } } } },
    });
    for (const orphan of orphans) {
      await this.db.evalRun.update({
        where: { id: orphan.id },
        data: { finishedAt: new Date(), passed: orphan._count.results },
      });
      this.logger.warn(
        `eval run ${orphan.id} was cut short by a restart; closed with ${orphan._count.results} passed of ${orphan.total}`,
      );
    }
  }

  private async grade(runId: string, cases: EvalCase[], options: RunOptions): Promise<void> {
    const run = { id: runId };
    let passed = 0;
    let costCents = 0;
    for (const evalCase of cases) {
      const actor = await this.actorFor(evalCase.actorRole, evalCase.actorCustomerId);
      const expected = ExpectedBehaviorSchema.parse(evalCase.expected);
      const started = Date.now();
      try {
        const { answer, usage, messageId } = await this.ask.askOnce(actor, evalCase.input);
        const grade = gradeDeterministic(answer, expected);
        let score: number | null = grade.passed ? 1 : 0;
        let reason = grade.failures.join('; ');
        if (grade.passed && expected.rubric) {
          const judged = await this.judgeRubric(evalCase.input, answer, expected.rubric);
          score = judged.score;
          reason = judged.reason;
          if (judged.score < 0.7) grade.passed = false;
        }
        if (grade.passed) passed += 1;
        costCents += estimateCostCents(this.ask.model, usage);
        // The answer as graded, plus the run that produced it, so a failure opens on its flight record.
        await this.db.evalResult.create({
          data: {
            runId: run.id,
            caseId: evalCase.id,
            passed: grade.passed,
            score,
            actual: { ...answer, messageId },
            reason: reason || null,
            latencyMs: Date.now() - started,
          },
        });
      } catch (error) {
        await this.db.evalResult.create({
          data: {
            runId: run.id,
            caseId: evalCase.id,
            passed: false,
            score: 0,
            actual: { error: (error as Error).message },
            reason: `pipeline error: ${(error as Error).message}`,
            latencyMs: Date.now() - started,
          },
        });
      }
    }

    await this.db.evalRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), passed, costCents: Math.round(costCents) },
    });
    await this.audit.record({
      actor: options.requestedBy,
      source: options.requestedBy ? 'UI' : 'JOB',
      action: 'evals.finished',
      entityType: 'EvalRun',
      entityId: run.id,
      after: { passed, total: cases.length, costCents: Math.round(costCents) },
    });
  }

  private async actorFor(role: Role, customerId: string | null): Promise<Actor> {
    const user = await this.db.user.findFirst({ where: { role, ...(customerId ? { customerId } : {}) } });
    if (!user) throw new Error(`no seeded user for role ${role}`);
    return { userId: user.id, role, customerId: user.customerId };
  }

  private async judgeRubric(
    question: string,
    answer: unknown,
    rubric: string,
  ): Promise<{ score: number; reason: string }> {
    if (!this.judge) return { score: 1, reason: 'no judge configured' };
    const { zodOutputFormat } = await import('@anthropic-ai/sdk/helpers/zod');
    const response = await this.judge.messages.parse({
      model: this.envService.env.ANTHROPIC_JUDGE_MODEL,
      max_tokens: 400,
      system:
        'You grade an assistant answer against a rubric. Output only the JSON requested. Be strict about wording; ignore formatting.',
      messages: [
        {
          role: 'user',
          content: `Question:\n${question}\n\nAnswer (JSON):\n${JSON.stringify(answer)}\n\nRubric:\n${rubric}\n\nScore 0–1 and one sentence of reason.`,
        },
      ],
      output_config: { format: zodOutputFormat(JudgeSchema) },
    });
    return response.parsed_output ?? { score: 0, reason: 'judge produced no parseable output' };
  }

  /** Recent runs, each with how many cases have been graded so far (a running row fills in). */
  async listRuns() {
    const runs = await this.db.evalRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 20,
      include: { _count: { select: { results: true } } },
    });
    return runs.map(({ _count, ...run }) => ({ ...run, graded: _count.results }));
  }

  async getRun(id: string) {
    const run = await this.db.evalRun.findUnique({
      where: { id },
      include: { results: { include: { case: true }, orderBy: { case: { category: 'asc' } } } },
    });
    if (!run) throw new NotFoundException('run not found');
    const byCategory = new Map<string, { passed: number; total: number }>();
    for (const r of run.results) {
      const bucket = byCategory.get(r.case.category) ?? { passed: 0, total: 0 };
      bucket.total += 1;
      if (r.passed) bucket.passed += 1;
      byCategory.set(r.case.category, bucket);
    }
    return { ...run, byCategory: Object.fromEntries(byCategory) };
  }

  async listCases() {
    return this.db.evalCase.findMany({
      orderBy: [{ category: 'asc' }, { createdAt: 'asc' }],
      include: { feedback: { select: { id: true, correction: true } } },
    });
  }

  async toggleCase(id: string, enabled: boolean) {
    return this.db.evalCase.update({ where: { id }, data: { enabled } });
  }
}

function gitSha(): string | null {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return null;
  }
}
