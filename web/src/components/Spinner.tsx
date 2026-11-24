// Everything that says "this is loading": spinners, placeholders that hold a card's or tile's place
// (a light sweeps over them while they wait), and buttons that are working. All of them follow
// prefers-reduced-motion (src/loading.css).
import { useEffect, useState } from "react";
import { pauseLeft } from "../scryfall";

/** Waits longer than this say that they're slow, so they don't look stuck. */
export const SLOW_MS = 5000;

/** The small spinner that goes beside text, the size of the text. */
export function Spinner() {
  return <span className="spin" aria-hidden="true" />;
}

/** A page (or part of one) that's loading. Shows after a moment, so quick loads don't flash it. */
export function Loading({ text = "Loading…", slow }: { text?: string; slow?: string }) {
  const isSlow = useSlow();
  return (
    <div className="loading" role="status">
      <div className="spinner" aria-hidden="true" />
      <p className="muted">{isSlow ? slow ?? "Still loading… this is taking longer than usual." : text}</p>
    </div>
  );
}

/** One line that's loading: a small spinner and what it's waiting for. */
export function Waiting({ text, slow, className }: { text: React.ReactNode; slow?: React.ReactNode; className?: string }) {
  const isSlow = useSlow();
  return (
    <span className={`waiting ${className ?? "muted"}`} role="status">
      <Spinner /> {isSlow && slow ? slow : text}
    </span>
  );
}

/** A line waiting on Scryfall: says when Scryfall is slow, and counts down when it has us wait. */
export function ScryfallWaiting({ text, still, className }: { text: React.ReactNode; still: string; className?: string }) {
  const isSlow = useSlow();
  const [left, setLeft] = useState(() => Math.ceil(pauseLeft() / 1000));
  useEffect(() => {
    const t = window.setInterval(() => setLeft(Math.ceil(pauseLeft() / 1000)), 500);
    return () => clearInterval(t);
  }, []);
  // Screen readers hear that we're waiting, not every second of the countdown.
  return (
    <span className={`waiting ${className ?? "muted"}`} role="status">
      <Spinner />{" "}
      {left > 0 ? (
        <span>Scryfall asked us to slow down. Carrying on in <span aria-hidden="true">{left}s</span><span className="sr-only">a moment</span>.</span>
      ) : isSlow ? `${still} Scryfall is slow right now.` : text}
    </span>
  );
}

/** True once this has been on screen a while. */
export function useSlow(ms = SLOW_MS): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setSlow(true), ms);
    return () => clearTimeout(t);
  }, [ms]);
  return slow;
}

/**
 * A button's label while it works: the spinner and `working` take the label's place. Both are laid
 * out on top of each other, so the button is as wide as the wider one and doesn't change size.
 */
export function BusyLabel({ busy, working, children }: { busy: boolean; working: string; children: React.ReactNode }) {
  return (
    <span className="busy-label" aria-live="polite">
      <span className={busy ? "off" : undefined}>{children}</span>
      <span className={busy ? undefined : "off"}><Spinner /> {working}</span>
    </span>
  );
}

// ---- Placeholders ------------------------------------------------------------------------------

/**
 * Card-shaped placeholders, to fill a grid of cards while they load. Only for cards that are surely
 * coming, never more than there will be: a list that shrinks when it loads looks like cards went
 * missing. When there's no telling how many, show the spinner (Loading) or the cards we have already.
 */
export function CardSkeletons({ n }: { n: number }) {
  return <>{Array.from({ length: n }, (_, i) => <div key={i} className="sk-card shimmer" aria-hidden="true" />)}</>;
}

/** Deck tiles that are loading (the deck list, precons): as many as there were last time, at most. */
export function DeckSkeletons({ n, text }: { n: number; text: string }) {
  const slow = useSlow();
  if (!n) return <Loading text={text} />;
  return (
    <div className="deck-grid sk-late" role="status">
      <span className={slow ? "sk-note muted" : "sr-only"}>{slow ? <Waiting text="Still loading… this is taking longer than usual." /> : text}</span>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="deck-tile sk-tile" aria-hidden="true">
          <div className="deck-cover shimmer" />
          <div className="deck-meta">
            <div className="sk-bar shimmer" style={{ width: `${75 - (i % 3) * 10}%` }} />
            <div className="sk-bar shimmer" style={{ width: `${45 + (i % 2) * 12}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Covers a background picture's element while the picture loads (deck covers). `pending`: we don't know the picture yet. */
export function CoverWait({ src, pending }: { src?: string; pending?: boolean }) {
  const [done, setDone] = useState<string>();
  useEffect(() => {
    if (!src) return;
    const img = new Image();
    img.onload = img.onerror = () => setDone(src);
    img.src = src;
    if (img.complete) setDone(src);
    return () => {
      img.onload = img.onerror = null;
    };
  }, [src]);
  return (src ? done !== src : pending) ? <span className="cover-wait shimmer" aria-hidden="true" /> : null;
}
