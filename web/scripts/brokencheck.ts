// Checks the Forge bug report linked from each entry in overrides/broken.json and lists the ones
// that are closed, so the entry can come out once the fix is in a Forge merge. Run it after merging
// upstream Forge: `npm run broken:check`. Exits 1 if any entry needs a look.
//
// GitHub allows 60 unauthenticated requests an hour; set GITHUB_TOKEN to go past that.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BROKEN_FILE, type BrokenEntry } from "./cardsupport.ts";

/** "https://github.com/Card-Forge/forge/issues/5176" → the API path, or null if it isn't an issue link. */
export function issueApiPath(url: string): string | null {
  const m = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)\/?$/.exec(url.trim());
  return m ? `/repos/${m[1]}/${m[2]}/issues/${m[3]}` : null;
}

export interface IssueState {
  state: "open" | "closed";
  state_reason?: string | null;
  closed_at?: string | null;
}

export type Verdict = { name: string; ok: true } | { name: string; ok: false; message: string };

/** What to do about one entry, given its issue (undefined when the entry has no usable link). */
export function verdict(name: string, entry: BrokenEntry, issue: IssueState | undefined): Verdict {
  if (!entry.issue || !issueApiPath(entry.issue)) return { name, ok: false, message: "no Forge issue link to check" };
  if (!issue) return { name, ok: false, message: `couldn't read ${entry.issue}` };
  if (issue.state === "open") return { name, ok: true };
  const when = issue.closed_at ? ` on ${issue.closed_at.slice(0, 10)}` : "";
  if (issue.state_reason === "completed") {
    return { name, ok: false, message: `fixed${when}: if that's before the last Forge merge, test the card and remove the entry (${entry.issue})` };
  }
  return { name, ok: false, message: `closed${when} as ${issue.state_reason ?? "unknown"}, maybe without a fix: check ${entry.issue}` };
}

async function fetchIssue(path: string): Promise<IssueState | undefined> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "broken-cards-check" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const r = await fetch(`https://api.github.com${path}`, { headers });
  if (!r.ok) {
    console.error(`${path}: HTTP ${r.status}${r.status === 403 ? " (rate limited? set GITHUB_TOKEN)" : ""}`);
    return undefined;
  }
  return (await r.json()) as IssueState;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!existsSync(BROKEN_FILE)) {
    console.log("No overrides/broken.json.");
    process.exit(0);
  }
  const cards = (JSON.parse(readFileSync(BROKEN_FILE, "utf8")) as { cards?: Record<string, BrokenEntry> }).cards ?? {};
  const results = await Promise.all(
    Object.entries(cards).map(async ([name, entry]) => {
      const path = entry.issue ? issueApiPath(entry.issue) : null;
      return verdict(name, entry, path ? await fetchIssue(path) : undefined);
    }),
  );
  const todo = results.filter((r): r is Extract<Verdict, { ok: false }> => !r.ok);
  console.log(`${results.length - todo.length} of ${results.length} known-broken cards still have an open Forge issue.`);
  for (const r of todo) console.log(`- ${r.name}: ${r.message}`);
  if (todo.length) {
    console.log("\nAfter editing overrides/broken.json, run `npm run cardsupport` and commit both.");
    process.exit(1);
  }
}
