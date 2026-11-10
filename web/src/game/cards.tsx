// Card tiles for the game table: Scryfall images, card backs for hidden cards, styled tiles for
// tokens, and the hover preview shared across the table.
import { createContext, useContext, useEffect, useState } from "react";
import { cached, imageUrl, resolve } from "../scryfall";
import type { CardView } from "./view";

/** Loads Scryfall data for these card names once; re-renders when it arrives. */
export function useCardData(names: string[]) {
  const [, setVersion] = useState(0);
  const key = names.join("|");
  useEffect(() => {
    let live = true;
    resolve(names.map((name) => ({ name, quantity: 1, board: "main" as const })))
      .catch(() => [])
      .finally(() => live && setVersion((v) => v + 1));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

export function cardImage(name: string | undefined, size: "small" | "normal" | "large" = "normal") {
  if (!name) return undefined;
  const sc = cached({ name, quantity: 1, board: "main" });
  return sc && imageUrl(sc, size);
}

// ---- Hover preview -----------------------------------------------------------------------------

export interface Preview {
  card: CardView;
  /** Shown under the image, e.g. who can see a face-down card. */
  note?: string;
}
export const PreviewContext = createContext<(p: Preview | null) => void>(() => {});
export const usePreview = () => useContext(PreviewContext);

// ---- Tiles -------------------------------------------------------------------------------------

export function CardBack({ label }: { label?: string }) {
  return (
    <div className="card-back" aria-label={label ?? "Face-down card"}>
      <span>◆</span>
    </div>
  );
}

/** The face of a card at any size. Width comes from the parent (`--cw`). */
export function CardFace({ card, size = "normal", knownFaceDown }: { card: CardView; size?: "small" | "normal"; knownFaceDown?: boolean }) {
  if (card.hidden) return <CardBack />;
  if (card.token) {
    return (
      <div className="token-tile">
        <span className="token-name">{card.name}</span>
        <span className="token-type">Token {card.types?.join(" ")}</span>
      </div>
    );
  }
  const src = cardImage(card.name, size);
  return (
    <div className={`card-face${knownFaceDown ? " known-facedown" : ""}`}>
      {src ? <img src={src} alt={card.name} draggable={false} loading="lazy" /> : <div className="card-noimg">{card.name}</div>}
    </div>
  );
}

const plus = (c: CardView) => c.counters?.["+1/+1"] ?? 0;

export function CardBadges({ card, showPT }: { card: CardView; showPT?: boolean }) {
  const pt = card.power !== undefined && card.types?.includes("Creature");
  const boosted = plus(card) !== 0;
  const others = Object.entries(card.counters ?? {}).filter(([k]) => k !== "+1/+1");
  return (
    <>
      {pt && (showPT || boosted || card.token || card.hidden) && (
        <span className={`pt${boosted ? " boosted" : ""}`}>
          {(card.power ?? 0) + plus(card)}/{(card.toughness ?? 0) + plus(card)}
        </span>
      )}
      {boosted && <span className="ctr">+{plus(card)}</span>}
      {others.map(([k, n]) => (
        <span key={k} className="ctr other">{n} {k}</span>
      ))}
      {card.commander && <span className="crown" title="Commander">♛</span>}
      {card.faceDown && !card.hidden && <span className="fd-eye" title="Face down. You can see it.">👁</span>}
    </>
  );
}

/** Who can see a face-down card, phrased for the viewer. */
export function faceDownNote(card: CardView, viewer: string, nameOf: (id: string) => string): string | undefined {
  if (!card.faceDown) return undefined;
  if (!card.hidden) {
    const others = (card.visibleTo ?? []).filter((id) => id !== viewer).map(nameOf);
    return `Face down. Only you${others.length ? " and " + others.join(", ") : ""} can see it.`;
  }
  const who = (card.visibleTo ?? []).map(nameOf);
  return who.length ? `Face down. Only ${who.join(" and ")} can see it.` : "Face down. Nobody can see it.";
}

export function previewFor(card: CardView, viewer: string, nameOf: (id: string) => string): Preview {
  return { card, note: faceDownNote(card, viewer, nameOf) };
}
