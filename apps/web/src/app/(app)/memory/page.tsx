import { MemoryEditor } from '@/components/ask/memory-editor';
import { apiFetch } from '@/lib/api';
import { auth } from '@/lib/auth';
import type { Memory } from '@/lib/types';

export const metadata = { title: 'Memory' };

export default async function MemoryPage() {
  const [rows, session] = await Promise.all([apiFetch<Memory[]>('/ask/memory'), auth()]);
  return (
    <div className="space-y-4">
      <div>
        <p className="eyebrow">Ask</p>
        <h1 className="text-2xl font-bold">Memory</h1>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Written by a person, visible, deletable. Wording only — never a medical or financial fact.
        </p>
      </div>
      <MemoryEditor rows={rows} canOrg={session?.user.role !== 'CUSTOMER'} />
    </div>
  );
}
