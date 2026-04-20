import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { isOwnerEmail } from "./src/lib/admin-emails";

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
  callbacks: {
    async signIn({ profile }) {
      return Boolean(profile?.email_verified);
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
