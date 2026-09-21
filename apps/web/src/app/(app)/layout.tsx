import { redirect } from 'next/navigation';
import { AppShell } from '@/components/shell/app-shell';
import { apiFetchOrNull } from '@/lib/api';
import { auth } from '@/lib/auth';
import { currentTheme } from '@/lib/theme';
import type { AskStatus, Health } from '@/lib/types';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const [health, askStatus, theme] = await Promise.all([
    apiFetchOrNull<Health>('/health'),
    apiFetchOrNull<AskStatus>('/ask/status'),
    currentTheme(),
  ]);
  return (
    <AppShell
      user={{
        name: session.user.name ?? '',
        email: session.user.email ?? '',
        role: session.user.role,
        customerId: session.user.customerId,
      }}
      today={health?.today ?? new Date().toISOString().slice(0, 10)}
      demoClock={health?.demoClock ?? false}
      integrations={
        health?.integrations ?? {
          stripe: 'simulated',
          qbo: 'simulated',
          twilio: 'simulated',
          resend: 'simulated',
          anthropic: 'simulated',
        }
      }
      askStatus={askStatus}
      theme={theme}
    >
      {children}
    </AppShell>
  );
}
