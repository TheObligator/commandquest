// What's new (#/changelog): every released version, newest first, and on staging (and in dev) the
// changes that aren't live yet. Data: web/changelog/, compiled in by vite.config.ts.
import changelog from "virtual:changelog";
import { CATEGORY_LABELS, sortEntries, type Entry } from "../changelog";

/** The live version, shown in the footer. */
export const SITE_VERSION = changelog.releases[0]?.version ?? null;

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

function Entries({ entries }: { entries: Entry[] }) {
  return (
    <ul className="site-changes">
      {sortEntries(entries).map((e, i) => (
        <li key={i}>
          <span className={`change-cat cat-${e.category}`}>{CATEGORY_LABELS[e.category]}</span>
          <span>
            {e.title}
            {e.body && <span className="change-body">{e.body}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Changelog() {
  const { releases, unreleased } = changelog;
  return (
    <article className="legal site-changelog">
      <h1>What's new</h1>
      <p className="legal-sub">Every update to CommandQuest, newest first.</p>

      {unreleased.length > 0 && (
        <section className="release unreleased">
          <div className="release-head">
            <span className="release-tag tag-staging">On staging · not live yet</span>
            <span className="release-date">
              {unreleased.length} change{unreleased.length === 1 ? "" : "s"}, only shown here
            </span>
          </div>
          <Entries entries={unreleased} />
        </section>
      )}

      {releases.map((r) => (
        <section className="release" key={r.version} id={`v${r.version}`}>
          <div className="release-head">
            <h2 className="release-version">v{r.version}</h2>
            {r.hotfix && <span className="release-tag tag-hotfix">Hotfix</span>}
            <span className="release-date">{formatDate(r.date)}</span>
          </div>
          <Entries entries={r.entries} />
        </section>
      ))}
    </article>
  );
}
