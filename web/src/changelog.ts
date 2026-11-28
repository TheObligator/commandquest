// The site's changelog (#/changelog): what each version changed, plus, on staging, what's waiting to
// go live. The data lives in web/changelog/ (see its README); scripts/changelog.ts adds entries and
// cuts releases, and vite.config.ts compiles it into the bundle as `virtual:changelog`.

export const CATEGORIES = ["new", "improved", "fixed"] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_LABELS: Record<Category, string> = { new: "New", improved: "Improved", fixed: "Fixed" };

export interface Entry {
  category: Category;
  /** One line, written for players. */
  title: string;
  /** Optional extra detail shown under the title. */
  body?: string;
  /** When it was added (ISO), which orders entries within a category. */
  date: string;
}

export interface Release {
  /** "1.2.0" */
  version: string;
  /** When it went live (ISO). */
  date: string;
  /** Promoted within HOTFIX_WINDOW_MS of the last normal release: a patch version. */
  hotfix: boolean;
  entries: Entry[];
}

export interface Changelog {
  /** Newest first. */
  releases: Release[];
  /** Changes on staging that aren't live yet. Always empty in the public site's build. */
  unreleased: Entry[];
}

/** A promotion this soon after the last normal release is a hotfix. */
export const HOTFIX_WINDOW_MS = 48 * 60 * 60 * 1000;

/** Checks one entry file's contents; throws a readable error naming `where` when it's wrong. */
export function parseEntry(data: unknown, where: string): Entry {
  const fail = (why: string): never => {
    throw new Error(`${where}: ${why}`);
  };
  if (!data || typeof data !== "object") fail("not a JSON object");
  const d = data as Record<string, unknown>;
  if (!CATEGORIES.includes(d.category as Category)) fail(`category must be one of ${CATEGORIES.join(", ")}`);
  if (typeof d.title !== "string" || !d.title.trim()) fail("needs a title");
  if (d.body !== undefined && typeof d.body !== "string") fail("body must be text");
  if (typeof d.date !== "string" || Number.isNaN(Date.parse(d.date))) fail("needs an ISO date");
  const entry: Entry = { category: d.category as Category, title: (d.title as string).trim(), date: d.date as string };
  const body = typeof d.body === "string" ? d.body.trim() : "";
  if (body) entry.body = body;
  return entry;
}

/** New, then Improved, then Fixed; oldest first within each. */
export function sortEntries(entries: Entry[]): Entry[] {
  return [...entries].sort(
    (a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) || Date.parse(a.date) - Date.parse(b.date),
  );
}

function parseVersion(v: string): [number, number, number] {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m) throw new Error(`Bad version "${v}"`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * The version the next promotion gets. Normally a minor bump (1.2.0 → 1.3.0). Within 48 hours of
 * the last normal release it's a hotfix: a patch bump on the latest version (1.3.0 → 1.3.1 → 1.3.2).
 * The window counts from the last normal release, so hotfixes every day don't chain forever.
 */
export function nextVersion(releases: Release[], now: Date): { version: string; hotfix: boolean } {
  const latest = releases[0];
  if (!latest) return { version: "1.0.0", hotfix: false };
  const [major, minor, patch] = parseVersion(latest.version);
  const lastNormal = releases.find((r) => !r.hotfix);
  if (lastNormal && now.getTime() - Date.parse(lastNormal.date) < HOTFIX_WINDOW_MS) {
    return { version: `${major}.${minor}.${patch + 1}`, hotfix: true };
  }
  return { version: `${major}.${minor + 1}.0`, hotfix: false };
}

/** Adds the unreleased entries as a new release on top. */
export function cutRelease(releases: Release[], unreleased: Entry[], now: Date): Release[] {
  const { version, hotfix } = nextVersion(releases, now);
  return [{ version, date: now.toISOString(), hotfix, entries: sortEntries(unreleased) }, ...releases];
}

/** A file-name-safe slug of an entry title. */
export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48)
      .replace(/-+$/, "") || "change"
  );
}
