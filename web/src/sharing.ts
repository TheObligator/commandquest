// Sharing decks on the client: links, labels, and the browser's own id for counting views
// (convex/sharing.ts, convex/social.ts).
import type { Visibility } from "../convex/model/sharing";

export const VISIBILITY: Record<Visibility, { icon: string; label: string; hint: string }> = {
  public: { icon: "🌐", label: "Public", hint: "Anyone can find it in Browse decks and open the link." },
  unlisted: { icon: "🔗", label: "Unlisted", hint: "Only people with the link can see it. It isn't in Browse decks." },
  private: { icon: "🔒", label: "Private", hint: "Only you. The link stops working for everyone else." },
};

/** A shared deck's page. */
export const sharePath = (key: string) => `/d/${key}`;
export const shareLink = (key: string) => `${location.origin}${location.pathname}#${sharePath(key)}`;

const BROWSER_KEY = "cq.browserId";

/** This browser's random id, so a signed-out viewer counts once a day; null without storage. */
export function browserId(): string | null {
  try {
    let id = localStorage.getItem(BROWSER_KEY);
    if (!id) {
      id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
      localStorage.setItem(BROWSER_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

/** 1234 → "1.2k". */
export function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, "")}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
