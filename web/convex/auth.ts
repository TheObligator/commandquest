// Sign-in (Convex Auth): email links with a code to type instead, plus Google and Discord.
//
// Keys are deployment environment variables, never in the repo:
//   AUTH_RESEND_KEY            Resend API key for sending the magic-link emails
//   AUTH_EMAIL_FROM            sender (optional); defaults to signin@commandquest.app, whose
//                              domain is verified in Resend
//   AUTH_GOOGLE_ID/SECRET, AUTH_DISCORD_ID/SECRET   OAuth apps
//   SITE_URL, JWT_PRIVATE_KEY, JWKS                 Convex Auth itself
import Discord from "@auth/core/providers/discord";
import Google from "@auth/core/providers/google";
import { Email } from "@convex-dev/auth/providers/Email";
import { convexAuth } from "@convex-dev/auth/server";

/** Effectively "stay signed in forever": nothing on the site is sensitive enough to need re-auth. */
const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60 * 1000;

/** Sign-in codes: 8 characters without look-alikes (0/O, 1/I), shown as ABCD-EFGH. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function signInCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * The sign-in email: a link (opened anywhere, it signs in the browser that asked: src/app/handoff.ts)
 * and the same code to type into that browser instead.
 */
async function sendSignInEmail({ identifier, url, token, provider }: { identifier: string; url: string; token: string; provider: { from?: string; apiKey?: string } }) {
  const code = `${token.slice(0, 4)}-${token.slice(4)}`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${provider.apiKey ?? process.env.AUTH_RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: provider.from,
      to: identifier,
      subject: `Your CommandQuest sign-in code: ${code}`,
      text: `Sign in to CommandQuest: ${url}\n\nOr enter this code on the sign-in page: ${code}\n\nThe link and code work once, for an hour. If you didn't ask to sign in, ignore this email.`,
      html: `<div style="font-family:system-ui,sans-serif;max-width:420px;margin:auto;padding:24px;color:#222">
  <h2 style="margin:0 0 16px">Sign in to CommandQuest</h2>
  <p><a href="${escapeHtml(url)}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#d4a24c;color:#111;font-weight:600;text-decoration:none">Sign in</a></p>
  <p style="margin-top:20px">Or enter this code on the sign-in page:</p>
  <p style="font:700 28px ui-monospace,Menlo,monospace;letter-spacing:3px;margin:8px 0">${code}</p>
  <p style="color:#666;font-size:13px">The link opens on any device and signs in the browser where you asked. The link and code work once, for an hour. If you didn't ask to sign in, ignore this email.</p>
</div>`,
    }),
  });
  if (!res.ok) throw new Error("Resend error: " + JSON.stringify(await res.json()));
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    // Convex Auth's Email provider: a short code is only accepted with the email it was sent to,
    // so it can't be guessed (and failed tries per email are limited). Id "resend" as before.
    Email({
      id: "resend",
      from: process.env.AUTH_EMAIL_FROM ?? "CommandQuest <signin@commandquest.app>",
      maxAge: 60 * 60,
      generateVerificationToken: async () => signInCode(),
      sendVerificationRequest: sendSignInEmail,
    }),
    Google,
    Discord,
  ],
  session: {
    totalDurationMs: TEN_YEARS_MS,
    inactiveDurationMs: TEN_YEARS_MS,
  },
});
