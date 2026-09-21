import type { Actor } from '@daysheet/domain';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';

/** The signed-in person as the domain sees them; sends the visitor to sign in when there is no session. */
export async function currentActor(): Promise<Actor> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  return { userId: session.user.id, role: session.user.role, customerId: session.user.customerId };
}
