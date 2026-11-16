// Under the deck: the Commander bracket the player gives the deck (with their reasons), what its
// cards say about the lowest bracket it fits, and counts of the cards that matter at a glance
// (Game Changers, tutors, fast mana, removal…). See src/brackets.ts and src/cardtags.ts.
import { useEffect, useMemo, useState } from "react";
import type { DeckCard } from "../../convex/model/deckRules";
import { MAX_BRACKET_TAG_LENGTH, MAX_BRACKET_TAGS } from "../../convex/model/deckRules";
import { BRACKETS, GLANCE, REASON_TAGS, bracketFloor, bracketName, glance, total, type GlanceCard } from "../brackets";
import { knownTags, lookUpTags, pendingQueries } from "../cardtags";
import { errorMessage } from "../app/errors";
import * as scry from "../scryfall";

export function DeckBracket(props: {
  cards: DeckCard[];
  /** Commander decks get the bracket picker; every deck gets the counts. */
  commander: boolean;
  bracket?: number;
  tags: string[];
  onBracket: (b: number | undefined) => void;
  onTags: (tags: string[]) => void;
}) {
  // The cards that are played: main deck and commander(s).
  const played: GlanceCard[] = useMemo(() => {
    const byName = new Map<string, GlanceCard>();
    for (const c of props.cards) {
      if (c.board !== "main" && c.board !== "commander") continue;
      const s = scry.cached(c);
      const e = byName.get(c.name) ?? { name: c.name, quantity: 0, gameChanger: s?.game_changer };
      e.quantity += c.quantity;
      byName.set(c.name, e);
    }
    return [...byName.values()];
  }, [props.cards]);

  // Basic lands are never in a category, so they're never looked up.
  const lookupNames = useMemo(
    () => played.filter((c) => !/^Basic\b/.test(scry.cached({ name: c.name, quantity: 1, board: "main" })?.type_line ?? "")).map((c) => c.name).sort(),
    [played],
  );
  const namesKey = lookupNames.join("\n");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [lookupError, setLookupError] = useState("");
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!lookupNames.length) return;
    let cancelled = false;
    setLookupError("");
    const t = window.setTimeout(() => {
      lookUpTags(
        lookupNames,
        (done, n) => {
          if (cancelled) return;
          setProgress(done < n ? { done, total: n } : null);
          setVersion((v) => v + 1);
        },
        () => cancelled,
      ).catch((e) => !cancelled && (setLookupError(errorMessage(e)), setProgress(null)));
    }, 600); // wait for the deck to settle (typing, imports)
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namesKey]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tagged = useMemo(() => knownTags(lookupNames), [namesKey, version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pendingCats = useMemo(() => new Set(pendingQueries(lookupNames).map((q) => q.category)), [namesKey, version]);
  const groups = useMemo(() => glance(played, tagged), [played, tagged]);
  const count = (id: string) => total(groups.get(id));
  const [open, setOpen] = useState<string | null>(null);
  const openCat = GLANCE.find((c) => c.id === open);

  const floor = bracketFloor({ gameChangers: count("gameChanger"), massLandDenial: count("massLandDenial"), extraTurns: count("extraTurn") });

  return (
    <section className="board glance-panel">
      <h2>{props.commander ? "Bracket and key cards" : "Key cards"}</h2>
      {props.commander && (
        <div className="bracket-block">
          <div className="bracket-pick" role="radiogroup" aria-label="This deck's bracket">
            {BRACKETS.map((b) => (
              <button
                key={b.n}
                role="radio"
                aria-checked={props.bracket === b.n}
                className={`bracket-opt${props.bracket === b.n ? " on" : ""}${b.n < floor.bracket ? " below" : ""}`}
                title={`${b.blurb}${props.bracket === b.n ? " Click again to clear." : ""}`}
                onClick={() => props.onBracket(props.bracket === b.n ? undefined : b.n)}
              >
                <span className="bracket-n">{b.n}</span>
                <span className="bracket-name">{b.name}</span>
              </button>
            ))}
          </div>
          <p className="muted small bracket-hint">
            {props.bracket ? `${BRACKETS[props.bracket - 1].name}: ${BRACKETS[props.bracket - 1].blurb}` : "Pick the bracket you'd call this deck."}
          </p>
          <div className={`bracket-floor${props.bracket && props.bracket < floor.bracket ? " warn" : ""}`}>
            {floor.reasons.length ? (
              <>
                <p>
                  <strong>Its cards fit Bracket {floor.bracket} ({bracketName(floor.bracket)}) or higher</strong>
                  {props.bracket && props.bracket < floor.bracket ? `, but you've picked ${props.bracket}.` : "."}
                </p>
                <ul>{floor.reasons.map((r) => <li key={r.text}>{r.text}</li>)}</ul>
              </>
            ) : (
              <p>Nothing in the list rules out Bracket 1.</p>
            )}
            <p className="muted small">Two-card combos and how early the deck can win aren't checked: tag them below.</p>
          </div>
          <ReasonTags tags={props.tags} onTags={props.onTags} />
        </div>
      )}
      <div className="glance-head">
        <span className="muted small">
          Main deck and commander{progress ? ` · checking Scryfall Tagger ${progress.done}/${progress.total}…` : ""}
          {lookupError && <span className="form-error"> · Couldn't check tags: {lookupError}</span>}
        </span>
      </div>
      <div className="glance-grid">
        {GLANCE.map((c) => {
          const n = count(c.id);
          const pending = pendingCats.has(c.id) || (c.id === "interaction" && ["removal", "boardWipe", "counterspell"].some((x) => pendingCats.has(x)));
          return (
            <button
              key={c.id}
              className={`glance-tile${open === c.id ? " open" : ""}${n === 0 ? " zero" : ""} is-${c.id}`}
              title={c.hint}
              aria-expanded={open === c.id}
              onClick={() => setOpen(open === c.id ? null : c.id)}
            >
              <span className="glance-n">{pending && !lookupError ? "…" : n}</span>
              <span className="glance-label">{c.label}</span>
            </button>
          );
        })}
      </div>
      {openCat && (
        <div className="glance-list">
          <p className="muted small">
            {openCat.hint}
            {openCat.query && (
              <>
                {" "}
                <a href={`https://scryfall.com/search?q=${encodeURIComponent(openCat.query)}`} target="_blank" rel="noopener">See every card ↗</a>
              </>
            )}
          </p>
          {groups.get(openCat.id)?.length ? (
            <ul>
              {[...groups.get(openCat.id)!].sort((a, z) => a.name.localeCompare(z.name)).map((c) => (
                <li key={c.name}>{c.quantity > 1 ? `${c.quantity} × ` : ""}{c.name}</li>
              ))}
            </ul>
          ) : (
            <p className="muted small">None in this deck.</p>
          )}
        </div>
      )}
      <p className="muted small glance-source">
        Game Changers from Scryfall; other counts from <a href="https://tagger.scryfall.com/" target="_blank" rel="noopener">Scryfall Tagger</a>, where players tag cards, so they can miss a card or two.
      </p>
    </section>
  );
}

function ReasonTags({ tags, onTags }: { tags: string[]; onTags: (t: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const has = (t: string) => tags.some((x) => x.toLowerCase() === t.toLowerCase());
  const toggle = (t: string) => onTags(has(t) ? tags.filter((x) => x.toLowerCase() !== t.toLowerCase()) : [...tags, t]);
  const custom = tags.filter((t) => !REASON_TAGS.some((r) => r.toLowerCase() === t.toLowerCase()));
  const full = tags.length >= MAX_BRACKET_TAGS;
  function add() {
    const t = draft.trim().replace(/\s+/g, " ");
    if (!t || full) return;
    if (!has(t)) onTags([...tags, t]);
    setDraft("");
  }
  return (
    <div className="reason-tags">
      <span className="muted small">Why this bracket:</span>
      {[...REASON_TAGS, ...custom].map((t) => (
        <button key={t} className={`reason-tag${has(t) ? " on" : ""}`} aria-pressed={has(t)} disabled={!has(t) && full} onClick={() => toggle(t)}>
          {t}
        </button>
      ))}
      <input
        className="reason-input"
        placeholder="+ Your own tag"
        aria-label="Add your own tag"
        maxLength={MAX_BRACKET_TAG_LENGTH}
        value={draft}
        disabled={full}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
      />
    </div>
  );
}
