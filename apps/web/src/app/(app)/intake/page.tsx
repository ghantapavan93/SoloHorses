import { IntakeInbox } from '@/components/intake/intake-inbox';
import { can } from '@daysheet/domain';
import { NotForRole } from '@/components/shell/not-for-role';
import { currentActor } from '@/lib/actor';
import { SimulateInbound } from '@/components/intake/simulate-inbound';
import { apiFetch } from '@/lib/api';
import type { CustomerLite, Message } from '@/lib/types';

export const metadata = { title: 'Intake' };

export default async function IntakePage() {
  const actor = await currentActor();
  if (!can(actor, 'read', 'intake')) return <NotForRole page="Intake" role={actor.role} />;
  const [inbox, outbox, status] = await Promise.all([
    apiFetch<Message[]>('/intake'),
    apiFetch<Message[]>('/intake/outbox'),
    apiFetch<{ sms: 'live' | 'simulated'; email: 'live' | 'simulated'; intakeNumber: string }>(
      '/integrations/messaging/status',
    ),
  ]);
  const customers = await apiFetch<CustomerLite[]>('/customers');
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Recip Farm line · {status.intakeNumber}</p>
          <h1 className="text-2xl font-bold">Intake</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Every cross arrives as a text. It is parsed, a person confirms it, and the reply carries the embryo IDs. A
            text is not confirmed until we reply.
          </p>
        </div>
        <SimulateInbound mode={status.sms} />
      </div>
      <IntakeInbox inbox={inbox} outbox={outbox} customers={customers} />
    </div>
  );
}
