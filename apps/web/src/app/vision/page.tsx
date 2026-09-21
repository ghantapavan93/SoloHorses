import Link from 'next/link';
import { StoryNav } from '@/components/story/story-nav';
import { VisionView } from '@/components/vision/vision-view';
import { apiFetchOrNull } from '@/lib/api';
import { auth } from '@/lib/auth';
import type {
  AskAuthority,
  AskLastRun,
  AskStatus,
  BuildHealth,
  DecisionRow,
  DigestPreview,
  SettlementScene,
  Story,
} from '@/lib/types';

export const metadata = { title: 'Vision — Ask earns autonomy' };
export const dynamic = 'force-dynamic';

/**
 * Not a roadmap: the ladder the assistant climbs, the continuum from what runs to what is
 * only written down, and three ideas that extend the same architecture, each with the part
 * that already runs beside the part that does not. Public; reads as the demo reviewer.
 */
export default async function VisionPage() {
  const reviewer = { allowReviewer: true } as const;
  const [session, story, sale, build, askStatus, authority, lastRun] = await Promise.all([
    auth(),
    apiFetchOrNull<Story>('/story', reviewer),
    apiFetchOrNull<SettlementScene>('/settlement', reviewer),
    apiFetchOrNull<BuildHealth>('/health/build', reviewer),
    apiFetchOrNull<AskStatus>('/ask/status', reviewer),
    apiFetchOrNull<AskAuthority>('/ask/authority', reviewer),
    apiFetchOrNull<AskLastRun>('/ask/last-run', reviewer),
  ]);
  const [digest, proposals] = await Promise.all([
    story
      ? apiFetchOrNull<DigestPreview>(`/digests/${story.embryo.customer.id}/preview`, reviewer)
      : Promise.resolve(null),
    apiFetchOrNull<DecisionRow[]>('/proposals?status=all', reviewer),
  ]);
  const decisions = {
    total: proposals?.length ?? 0,
    approved: proposals?.filter((p) => p.status === 'APPROVED').length ?? 0,
    stale: proposals?.filter((p) => p.status === 'STALE').length ?? 0,
  };
  return (
    <div className="dark">
      <main className="story glow relative min-h-dvh overflow-hidden text-foreground">
        <div className="grain" aria-hidden />
        <StoryNav current="/vision" />
        <div className="relative z-10 mx-auto max-w-[1180px] px-[5vw] pb-16 pt-[104px] md:px-[4vw]">
          <VisionView
            story={story}
            sale={sale}
            digest={digest}
            lastTrace={build?.lastTrace ?? null}
            askStatus={askStatus}
            authority={authority}
            lastRun={lastRun}
            signedIn={Boolean(session?.user)}
            decisions={decisions}
          />
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] px-[5vw] py-6 text-[11px] text-muted-foreground">
          <span>
            <Link href="/" className="font-heading font-bold uppercase tracking-[0.18em] text-paper">
              Daysheet
            </Link>{' '}
            · unofficial candidate prototype
          </span>
          <span>synthetic data · no production or customer systems accessed · public sources only</span>
        </footer>
      </main>
    </div>
  );
}
