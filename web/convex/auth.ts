// Sign-in (Convex Auth): email magic links, plus Google and Discord.
//
// Keys are deployment environment variables, never in the repo:
//   AUTH_RESEND_KEY            Resend API key for sending the magic-link emails
//   AUTH_EMAIL_FROM            sender (optional); defaults to signin@commandquest.app, whose
//                              domain is verified in Resend
//   AUTH_GOOGLE_ID/SECRET, AUTH_DISCORD_ID/SECRET   OAuth apps
//   SITE_URL, JWT_PRIVATE_KEY, JWKS                 Convex Auth itself
import Discord from "@auth/core/providers/discord";
import Google from "@auth/core/providers/google";
import Resend from "@auth/core/providers/resend";
import { convexAuth } from "@convex-dev/auth/server";

/** Effectively "stay signed in forever": nothing on the site is sensitive enough to need re-auth. */
const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60 * 1000;

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Resend({ from: process.env.AUTH_EMAIL_FROM ?? "CommandQuest <signin@commandquest.app>" }),
    Google,
    Discord,
  ],
  session: {
    totalDurationMs: TEN_YEARS_MS,
    inactiveDurationMs: TEN_YEARS_MS,
  },
});
