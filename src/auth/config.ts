import NextAuth, { type DefaultSession, type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { eq, sql as raw } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { burnPasswordCompare, verifyPassword } from "./password";
import { appendSafe } from "@/governance/audit";
import { logger } from "@/lib/logger";

export type AppRole = "student" | "teacher" | "admin";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: AppRole;
      status: "invited" | "active" | "suspended";
    } & DefaultSession["user"];
  }
}

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * Credentials-only authentication (NFR-SEC-001). There is deliberately no
 * OAuth provider, no email sign-up, and no `signUp` callback anywhere in this
 * config — accounts exist only because an administrator created them
 * (FR-ADM-008).
 */
export const authConfig: NextAuthConfig = {
  session: { strategy: "jwt", maxAge: 60 * 60 * 8 },
  pages: { signIn: "/login", error: "/login" },
  trustHost: true,
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw_) {
        const parsed = credentialsSchema.safeParse(raw_);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        const [user] = await db
          .select()
          .from(users)
          .where(raw`lower(${users.email}) = lower(${email})`)
          .limit(1);

        if (!user || !user.passwordHash) {
          // Spend the same time as a real comparison so a missing account and a
          // wrong password are indistinguishable from the outside.
          await burnPasswordCompare(password);
          await appendSafe({
            action: "auth.login.failed",
            resourceType: "user",
            outcome: "error",
            payload: { reason: user ? "no_password_set" : "no_such_user" },
          });
          return null;
        }

        // A suspended account must be denied login even with correct
        // credentials (FR-ADM-004).
        if (user.status === "suspended") {
          await burnPasswordCompare(password);
          await appendSafe({
            actorId: user.id,
            actorRole: user.role,
            action: "auth.login.failed",
            resourceType: "user",
            resourceId: user.id,
            outcome: "error",
            payload: { reason: "suspended" },
          });
          return null;
        }

        const ok = await verifyPassword(password, user.passwordHash);
        if (!ok) {
          await appendSafe({
            actorId: user.id,
            actorRole: user.role,
            action: "auth.login.failed",
            resourceType: "user",
            resourceId: user.id,
            outcome: "error",
            payload: { reason: "bad_password" },
          });
          return null;
        }

        await db
          .update(users)
          .set({ lastLoginAt: new Date() })
          .where(eq(users.id, user.id));

        await appendSafe({
          actorId: user.id,
          actorRole: user.role,
          action: "auth.login",
          resourceType: "user",
          resourceId: user.id,
        });

        logger.info("login succeeded", { userId: user.id, role: user.role });

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          status: user.status,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.role = (user as { role: AppRole }).role;
        token.status = (user as { status: string }).status;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? "";
        session.user.role = (token.role as AppRole) ?? "student";
        session.user.status =
          (token.status as "invited" | "active" | "suspended") ?? "active";
      }
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
