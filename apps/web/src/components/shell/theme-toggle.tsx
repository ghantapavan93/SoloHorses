'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Moon, Sun } from 'lucide-react';
import { setThemeAction } from '@/lib/theme-actions';
import type { Theme } from '@/lib/theme';
import { cn } from '@/lib/utils';

/** One click between the near-black shell and the office-at-dawn light theme. */
export function ThemeToggle({ theme, className }: { theme: Theme; className?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      disabled={pending}
      aria-label={`Switch to the ${next} theme`}
      title={`Switch to the ${next} theme`}
      onClick={() =>
        start(async () => {
          await setThemeAction(next);
          router.refresh();
        })
      }
      className={cn(
        'inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50',
        className,
      )}
    >
      {theme === 'dark' ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
    </button>
  );
}
