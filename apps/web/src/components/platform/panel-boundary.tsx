'use client';

import { Component, type ReactNode } from 'react';

/**
 * One panel failing must not take the page with it. The assistant, the ring, a money
 * timeline, the lab's live view: each sits inside one of these, and when it throws the
 * page says which panel is unavailable and what still works — in the panel's own place,
 * not as a blank screen.
 */
export class PanelBoundary extends Component<
  { name: string; children: ReactNode; className?: string },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error): void {
    // The browser console is the right place for this; the server has its own logs and Sentry has the digest.
    console.error(`[panel:${this.props.name}]`, error.message);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        role="alert"
        className={
          this.props.className ?? 'rounded-md border border-dashed px-3 py-4 text-[12px] text-muted-foreground'
        }
      >
        <p className="font-medium text-foreground">{this.props.name} unavailable.</p>
        <p className="mt-0.5">The rest of the page still works. Reload to try this panel again.</p>
        <button
          type="button"
          className="mt-2 rounded-md border px-2 py-1 text-[12px] hover:bg-muted"
          onClick={() => this.setState({ failed: false })}
        >
          Try again
        </button>
      </div>
    );
  }
}
