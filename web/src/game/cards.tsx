// Card tiles for the game table: Scryfall images, card backs for hidden cards, styled tiles for
// tokens, and the hover preview shared across the table.
import { createContext, useContext, useEffect, useState } from "react";
import { ManaCost } from "../components/ManaCost";
import { cached, cachedTokenArt, imageUrl, resolve, tokenArt } from "../scryfall";
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
  if (card.token) return <TokenFace card={card} />;
  const src = cardImage(card.name, size);
  return (
    <div className={`card-face${knownFaceDown ? " known-facedown" : ""}`}>
      {src ? <img src={src} alt={card.name} draggable={false} loading="lazy" /> : <div className="card-noimg">{card.name}</div>}
    </div>
  );
}

/** A token's Scryfall art if it's been found (see `tokenArt`), for previews and the stack. */
export function tokenImage(card: CardView): string | undefined {
  return card.token && card.name ? cachedTokenArt(tokenSpec(card)) ?? undefined : undefined;
}

const tokenSpec = (card: CardView) => ({ name: card.name ?? "Token", key: card.tokenKey, set: card.tokenSet, number: card.tokenNumber });

/** A token: its Scryfall art once found, a styled tile until then (or if Scryfall has none). */
function TokenFace({ card }: { card: CardView }) {
  const spec = tokenSpec(card);
  const [url, setUrl] = useState(() => cachedTokenArt(spec));
  useEffect(() => {
    let live = true;
    const known = cachedTokenArt(spec);
    setUrl(known);
    if (known === undefined) void tokenArt(spec).then((u) => live && setUrl(u ?? null));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.name, card.tokenKey, card.tokenSet, card.tokenNumber]);
  if (url) {
    return (
      <div className="card-face">
        <img src={url} alt={`${card.name} token`} draggable={false} loading="lazy" />
      </div>
    );
  }
  return (
    <div className="token-tile">
      <span className="token-name">{card.name}</span>
      <span className="token-type">Token {card.types?.join(" ")}</span>
    </div>
  );
}

const plus = (c: CardView) => c.counters?.["+1/+1"] ?? 0;

/** What's printed on the card (front face), from Scryfall: mana cost and P/T. */
function printed(name: string | undefined) {
  const sc = name ? cached({ name, quantity: 1, board: "main" }) : undefined;
  if (!sc) return undefined;
  const face = sc.card_faces?.[0];
  return { cost: sc.mana_cost || face?.mana_cost, power: sc.power ?? face?.power, toughness: sc.toughness ?? face?.toughness };
}

/** The mana cost, large, over the printed one (cards in hand), so it reads at a glance. */
export function CostOverlay({ card }: { card: CardView }) {
  if (card.hidden || card.token) return null;
  const cost = printed(card.name)?.cost;
  if (!cost) return null;
  return (
    <span className="cost-ov" aria-label={`Mana cost ${cost}`}>
      <ManaCost cost={cost} />
    </span>
  );
}

/**
 * Power / toughness, large, over the printed P/T box. On the battlefield it's the current value
 * (counters and effects included), green when above what's printed and red when below.
 */
export function PTOverlay({ card }: { card: CardView }) {
  // A token's base P/T is in Forge's token key ("t:r_1_1_goblin|…"); a name lookup could find another token's.
  const tokenBase = /^t:[a-z]+_(\d+)_(\d+)_/.exec(card.tokenKey ?? "");
  const p = card.hidden ? undefined : card.token ? (tokenBase ? { power: tokenBase[1], toughness: tokenBase[2] } : undefined) : printed(card.name);
  const inPlay = card.zone === "battlefield";
  const power = inPlay ? card.power : p?.power;
  const toughness = inPlay ? card.toughness : p?.toughness;
  if (power === undefined || toughness === undefined) return null;
  if (inPlay && !card.types?.includes("Creature")) return null; // an uncrewed vehicle's P/T isn't in play
  const base = (v: string | undefined) => (v !== undefined && /^\d+$/.test(v) ? Number(v) : undefined);
  const cmp = (now: number | string, was: number | undefined) =>
    typeof now !== "number" || was === undefined || card.hidden ? "" : now > was ? " up" : now < was ? " down" : "";
  const flag = inPlay ? cmp(power, base(p?.power)) || cmp(toughness, base(p?.toughness)) : "";
  return (
    <span className={`pt-ov${flag}${card.token || card.hidden ? " tile" : ""}`} title={inPlay && p?.power !== undefined ? `Printed ${p.power}/${p.toughness}` : undefined}>
      {power}/{toughness}
    </span>
  );
}

export function CardBadges({ card }: { card: CardView }) {
  const boosted = plus(card) !== 0;
  const others = Object.entries(card.counters ?? {}).filter(([k]) => k !== "+1/+1");
  return (
    <>
      <PTOverlay card={card} />
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
