import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { hasOwners, isOwnerEmail } from "./src/lib/admin-emails";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  session: { strategy: "jwt" },
  trustHost: true,
  pages: { signIn: "/login" },
  // default logger prints a full stack for every bad /api/auth/* URL — anyone could flood prod logs
  logger: { error: (e) => console.error(`[auth] ${e.name}: ${e.message.split("\n")[0].slice(0, 200)}`) },
  callbacks: {
    async signIn({ profile }) {
      // Only owner accounts may sign in — anyone else gets /login?error=AccessDenied.
      if (!profile?.email_verified) return false;
      return !hasOwners() || isOwnerEmail(profile.email ?? "");
    },
    async jwt({ token, profile }) {
      if (profile?.email) token.email = profile.email;
      const email = typeof token.email === "string" ? token.email : "";
      token.role = isOwnerEmail(email) ? "owner" : "viewer";
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.email = (token.email as string | undefined) ?? session.user.email;
      }
      (session as { role?: string }).role = (token.role as string) ?? "viewer";
      return session;
    },
  },
});
