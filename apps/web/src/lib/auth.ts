import NextAuth, { type DefaultSession } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { z } from 'zod';
import { env } from './env';

/**
 * Sessions live in the web app (Auth.js JWT cookies). Credentials are verified by the API,
 * which is the only thing that can see the password hash; the web server proves itself to
 * the API with the shared AUTH_SECRET. The browser never talks to the API directly.
 */

export type SessionRole = 'ADMIN' | 'STALLION_OFFICE' | 'RECIPS' | 'VET' | 'BILLING' | 'CUSTOMER';

declare module 'next-auth' {
  interface Session {
    user: DefaultSession['user'] & { id: string; role: SessionRole; customerId: string | null };
  }
  interface User {
    role: SessionRole;
    customerId: string | null;
  }
}

const LoginResponse = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  role: z.string(),
  customerId: z.string().nullable(),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: env.AUTH_SECRET,
  session: { strategy: 'jwt', maxAge: 12 * 60 * 60 },
  pages: { signIn: '/login' },
  providers: [
    Credentials({
      credentials: { email: { label: 'Email', type: 'email' }, password: { label: 'Password', type: 'password' } },
      async authorize(credentials) {
        const email = typeof credentials.email === 'string' ? credentials.email : '';
        const password = typeof credentials.password === 'string' ? credentials.password : '';
        if (!email || !password) return null;
        const response = await fetch(`${env.API_URL}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-service-secret': env.AUTH_SECRET },
          body: JSON.stringify({ email, password }),
          cache: 'no-store',
        });
        if (!response.ok) return null;
        const user = LoginResponse.parse(await response.json());
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role as SessionRole,
          customerId: user.customerId,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.role = user.role;
        token.customerId = user.customerId;
        token.name = user.name;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.sub ?? '';
      session.user.role = (token.role as SessionRole | undefined) ?? 'CUSTOMER';
      session.user.customerId = (token.customerId as string | null | undefined) ?? null;
      return session;
    },
  },
});
