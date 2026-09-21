import { BadRequestException, Body, Controller, Get, Inject, Param, Post, Query, Redirect, Req } from '@nestjs/common';
import type { Actor } from '@daysheet/domain';
import type { Request } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { CurrentActor } from '../../../platform/security/actor';
import { Public } from '../../../platform/security/jwt-auth.guard';
import { Requires } from '../../../platform/security/permission.guard';
import { ZodBodyPipe } from '../../../platform/http/zod-body.pipe';
import { EnvService } from '../../../platform/config/env.module';
import { ACCOUNTING_PROVIDER, type AccountingProvider } from '../infrastructure/accounting.provider';
import { AccountingService } from '../application/accounting.service';
import { IntegrityService } from '../application/integrity.service';
import { QboAdapter } from '../infrastructure/qbo.adapter';
import { QboSimulator } from '../infrastructure/qbo.simulator';

const ResolveSchema = z.object({
  resolution: z.enum(['REPUSH_LOCAL', 'ACCEPT_REMOTE', 'RETRY', 'IGNORE']),
  note: z.string().max(300).nullable().default(null),
});

const TamperSchema = z.object({
  entityType: z.enum(['INVOICE', 'PAYMENT']),
  docNumber: z.string(),
  totalCents: z.number().int().nonnegative().optional(),
  unlink: z.boolean().optional(),
});

const FaultSchema = z.object({ spec: z.string().max(100) });

/** OAuth state is single-use and short-lived; a Map is enough for one API process. */
const pendingStates = new Map<string, number>();

@Controller()
export class AccountingController {
  constructor(
    private readonly accounting: AccountingService,
    private readonly integrity: IntegrityService,
    private readonly envService: EnvService,
    @Inject(ACCOUNTING_PROVIDER) private readonly provider: AccountingProvider,
  ) {}

  @Get('money/summary')
  @Requires('read', 'accounting')
  summary() {
    return this.accounting.summary();
  }

  /** One row per invoice: what the ledger, Stripe and the books each say about it. */
  @Get('money/integrity')
  @Requires('read', 'invoice')
  integrityList(@CurrentActor() actor: Actor) {
    return this.integrity.list(actor);
  }

  @Get('money/integrity/:invoiceId')
  @Requires('read', 'invoice')
  integrityTimeline(@CurrentActor() actor: Actor, @Param('invoiceId') invoiceId: string) {
    return this.integrity.timeline(actor, invoiceId);
  }

  @Get('money/mappings')
  @Requires('read', 'accounting')
  mappings(@Query('entityType') entityType?: 'CUSTOMER' | 'INVOICE' | 'PAYMENT' | 'CREDIT' | 'ITEM') {
    return this.accounting.mappings(entityType);
  }

  @Get('money/discrepancies')
  @Requires('read', 'accounting')
  discrepancies(@Query('all') all?: string) {
    return this.accounting.discrepancies(all === 'true');
  }

  @Get('money/books')
  @Requires('read', 'accounting')
  books() {
    return this.provider.mode === 'simulated' ? this.accounting.booksView() : [];
  }

  @Post('money/discrepancies/:id/resolve')
  @Requires('write', 'accounting')
  resolve(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body(new ZodBodyPipe(ResolveSchema)) body: z.infer<typeof ResolveSchema>,
  ) {
    return this.accounting.resolve(actor, id, body.resolution, body.note);
  }

  @Post('money/mappings/:id/retry')
  @Requires('write', 'accounting')
  retry(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.accounting.retryMapping(actor, id);
  }

  @Post('money/reconcile')
  @Requires('write', 'accounting')
  reconcile(@CurrentActor() actor: Actor) {
    return this.accounting.reconcileNow(actor.userId);
  }

  /** Simulator-only demo controls. Hidden in the UI when a sandbox is connected. */
  @Post('money/simulator/tamper')
  @Requires('write', 'accounting')
  async tamper(@Body(new ZodBodyPipe(TamperSchema)) body: z.infer<typeof TamperSchema>) {
    if (!(this.provider instanceof QboSimulator))
      throw new BadRequestException('tamper is only available with the simulator');
    const ok = await this.provider.tamper(body.entityType, body.docNumber, {
      totalCents: body.totalCents,
      unlink: body.unlink,
    });
    if (!ok) throw new BadRequestException(`${body.docNumber} is not in the simulated books yet`);
    return { tampered: true };
  }

  @Post('money/simulator/faults')
  @Requires('write', 'accounting')
  faults(@Body(new ZodBodyPipe(FaultSchema)) body: z.infer<typeof FaultSchema>) {
    if (!(this.provider instanceof QboSimulator))
      throw new BadRequestException('faults are only available with the simulator');
    this.provider.armFault(body.spec);
    return { armed: body.spec, faults: this.provider.armedFaults() };
  }

  /** Ends a simulated outage (or any armed fault). The breaker still has to see a successful probe to close. */
  @Post('money/simulator/restore')
  @Requires('write', 'accounting')
  restore() {
    if (!(this.provider instanceof QboSimulator))
      throw new BadRequestException('restore is only available with the simulator');
    this.provider.restore();
    return { restored: true, faults: this.provider.armedFaults() };
  }

  @Get('money/simulator/faults')
  @Requires('read', 'accounting')
  armed() {
    return {
      simulator: this.provider instanceof QboSimulator,
      faults: this.provider instanceof QboSimulator ? this.provider.armedFaults() : [],
    };
  }

  // ───────────────────────────── QuickBooks OAuth ─────────────────────────────

  @Get('integrations/qbo/status')
  @Requires('read', 'accounting')
  async status() {
    const connected = this.provider instanceof QboAdapter ? await this.provider.isConnected() : false;
    return {
      mode: this.provider.mode,
      label: this.provider.label,
      connected,
      environment: this.envService.env.QBO_ENVIRONMENT,
    };
  }

  @Get('integrations/qbo/connect')
  @Requires('write', 'accounting')
  @Redirect()
  connect() {
    if (!(this.provider instanceof QboAdapter))
      throw new BadRequestException('set QBO_CLIENT_ID and QBO_CLIENT_SECRET to connect a sandbox');
    const state = randomBytes(16).toString('hex');
    pendingStates.set(state, Date.now());
    return { url: this.provider.authorizeUrl(state), statusCode: 302 };
  }

  /** Intuit redirects here; public because the browser arrives without our session token. */
  @Get('integrations/qbo/callback')
  @Public()
  @Redirect()
  async callback(@Req() req: Request) {
    if (!(this.provider instanceof QboAdapter)) throw new BadRequestException('QuickBooks is not configured');
    const rawState = req.query['state'];
    const state = typeof rawState === 'string' ? rawState : '';
    const issuedAt = pendingStates.get(state);
    if (!issuedAt || Date.now() - issuedAt > 10 * 60_000)
      throw new BadRequestException('unknown or expired OAuth state');
    pendingStates.delete(state);
    const fullUrl = `${this.envService.env.QBO_REDIRECT_URI}?${new URL(req.url, 'http://localhost').searchParams.toString()}`;
    const { realmId } = await this.provider.completeAuthorization(fullUrl);
    return { url: `${this.envService.env.WEB_URL}/money?connected=${encodeURIComponent(realmId)}`, statusCode: 302 };
  }
}
