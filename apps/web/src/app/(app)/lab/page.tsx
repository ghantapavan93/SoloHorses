import { can } from '@daysheet/domain';
import { ReliabilityLab } from '@/components/lab/reliability-lab';
import { NotForRole } from '@/components/shell/not-for-role';
import { currentActor } from '@/lib/actor';
import { apiFetch } from '@/lib/api';
import type { LabScenario, LabScenarioInfo, LabStatus } from '@/lib/types';

export const metadata = { title: 'Reliability Lab' };

/** The killer page: a reviewer breaks the system on purpose and watches it recover. */
export default async function LabPage() {
  const actor = await currentActor();
  if (!can(actor, 'write', 'platform')) return <NotForRole page="The Reliability Lab" role={actor.role} />;
  const [status, scenarios] = await Promise.all([
    apiFetch<LabStatus>('/lab/status'),
    apiFetch<Record<LabScenario, LabScenarioInfo>>('/lab/scenarios'),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <p className="eyebrow">Reliability Lab · the failures are simulated · the pipeline is real</p>
        <h1 className="text-2xl font-bold">Break the system</h1>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Each control injects a simulated failure into a simulated dependency. The pipeline it runs through is the real
          one: the inbox, the ledger, the retries, the breaker, the rules, the audit rows and the recovery paths. The
          feed is the platform bus.
        </p>
        {!status.simulator ? (
          <p className="mt-2 rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-[12px] text-warn">
            A live accounting sandbox is connected; the lab only runs against the simulator so it can never touch real
            books.
          </p>
        ) : null}
      </div>
      <ReliabilityLab status={status} scenarios={scenarios} />
    </div>
  );
}
