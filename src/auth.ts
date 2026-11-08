import NextAuth, { type DefaultSession } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import type { Role } from '@/db/schema';
import { loginSchema } from '@/lib/validation';

declare module 'next-auth' {
  interface Session {
    user: { id: string; role: Role } & DefaultSession['user'];
  }
  interface User {
    role?: Role;
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    id?: string;
    role?: Role;
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  // AUTH_SECRET is read from the environment; Auth.js refuses to run without it.
  session: { strategy: 'jwt', maxAge: 12 * 60 * 60 }, // one shift
  pages: { signIn: '/login' },
  providers: [
    Credentials({
      credentials: { username: {}, password: {} },
      async authorize(raw) {
        const parsed = loginSchema.safeParse(raw);
        if (!parsed.success) return null;
        // Imported lazily so the proxy bundle doesn't pull in the database.
        const [{ getDb }, { users }, { verifyPassword, dummyVerify }, { eq, and }] =
          await Promise.all([
            import('@/db'),
            import('@/db/schema'),
            import('@/server/password'),
            import('drizzle-orm'),
          ]);
        const db = await getDb();
        const [user] = await db
          .select()
          .from(users)
          .where(and(eq(users.username, parsed.data.username), eq(users.active, true)));
        if (!user) {
          await dummyVerify(parsed.data.password);
          return null;
        }
        if (!(await verifyPassword(parsed.data.password, user.passwordHash))) return null;
        return { id: user.id, name: user.name, role: user.role };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
      }
      return token;
    },
    session({ session, token }) {
      if (token.id) session.user.id = token.id;
      if (token.role) session.user.role = token.role;
      return session;
    },
  },
});
