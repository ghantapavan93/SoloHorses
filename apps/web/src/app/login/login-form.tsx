'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { loginAction } from './actions';

/** One click per demo role. The password is on the page already; typing it proves nothing. */
export function OneClick({ email, next, label }: { email: string; next: string; label: string }) {
  const [state, action, pending] = useActionState(loginAction, { error: null });
  return (
    <form action={action}>
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="email" value={email} />
      <input type="hidden" name="password" value="daysheet-demo" />
      <Button
        type="submit"
        size="sm"
        variant="outline"
        className="h-7 text-[12px]"
        disabled={pending}
        aria-label={`Sign in as ${label}`}
        data-testid={`login-${email.split('@')[0]}`}
      >
        {pending ? '…' : 'Sign in'}
      </Button>
      {state.error ? (
        <p role="alert" className="mt-1 text-[11px] text-critical">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(loginAction, { error: null });
  return (
    <form action={action} className="max-w-sm space-y-4">
      <input type="hidden" name="next" value={next} />
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          defaultValue="recips@daysheet.local"
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          defaultValue="daysheet-demo"
          required
        />
      </div>
      {state.error ? (
        <p role="alert" className="text-[13px] text-critical">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
