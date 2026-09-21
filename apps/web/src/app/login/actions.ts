'use server';

import { AuthError } from 'next-auth';
import { redirect } from 'next/navigation';
import { signIn } from '@/lib/auth';
import { safeNext } from '@/lib/safe-next';

export interface LoginState {
  error: string | null;
}

export async function loginAction(_previous: LoginState, formData: FormData): Promise<LoginState> {
  try {
    await signIn('credentials', {
      email: String(formData.get('email') ?? ''),
      password: String(formData.get('password') ?? ''),
      redirect: false,
    });
  } catch (error) {
    if (error instanceof AuthError) return { error: 'That email and password did not match.' };
    throw error;
  }
  redirect(safeNext(formData.get('next')));
}

export async function logoutAction(): Promise<void> {
  const { signOut } = await import('@/lib/auth');
  await signOut({ redirectTo: '/login' });
}
