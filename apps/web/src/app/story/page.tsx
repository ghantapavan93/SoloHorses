import Link from 'next/link';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { StoryView } from '@/components/story/story-view';
import { apiFetch, apiFetchOrNull } from '@/lib/api';
import { auth } from '@/lib/auth';
import { gestationRail } from '@/lib/gestation-rail';
import { currentTheme } from '@/lib/theme';
import type { AskStatus, Memory, Story, Xray } from '@/lib/types';

export const metadata = { title: 'One mare, every handoff' };
export const dynamic = 'force-dynamic';

/**
 * The front door. No sign-in needed: visitors read as the demo reviewer. One synthetic mare,
 * every handoff across every system, the exceptions that touch her, the two failure controls
 * in context, and the assistant grounded on the same records.
 */
export default async function StoryPage({ searchParams }: { searchParams: Promise<{ ask?: string }> }) {
  const { ask } = await searchParams;
  const [session, story, askStatus, memory, theme] = await Promise.all([
    auth(),
    apiFetch<Story>('/story', { allowReviewer: true }),
    apiFetchOrNull<AskStatus>('/ask/status', { allowReviewer: true }),
    apiFetchOrNull<Memory[]>('/ask/memory', { allowReviewer: true }),
    currentTheme(),
  ]);
  // The x-ray is drawn from the same records; it needs the story's mare, so it follows the story.
  const xray = await apiFetchOrNull<Xray>(`/operations/xray/${encodeURIComponent(story.recip.id)}`, {
    allowReviewer: true,
  });
  return (
    <main className="mx-auto max-w-6xl px-4 py-6 md:py-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted-foreground">
        <span>
          <Link href="/" className="font-heading font-bold uppercase tracking-[0.18em] text-foreground">
            Daysheet
          </Link>{' '}
          · one mare, every handoff · synthetic · live
        </span>
        <span className="flex items-center gap-3">
          <Link href="/build" className="underline">
            Real · simulated · probably wrong
          </Link>
          {session?.user ? (
            <Link href="/today" className="underline">
              Open the app
            </Link>
          ) : (
            <Link href="/login?next=/story" className="underline">
              Sign in as a role
            </Link>
          )}
          <ThemeToggle theme={theme} />
        </span>
      </div>
      <StoryView
        story={story}
        rail={gestationRail(story)}
        xray={xray}
        askStatus={askStatus}
        memory={memory ?? []}
        signedIn={Boolean(session?.user)}
        initialQuestion={typeof ask === 'string' && ask.length > 2 ? ask.slice(0, 300) : undefined}
      />
    </main>
  );
}
