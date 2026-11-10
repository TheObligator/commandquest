// Card details dialog: Scryfall's card image (both faces), rules text, artist, printing and
// format legality, with a link back to the card on Scryfall.

import { h, manaCost, rulesText } from "./dom";
import { cardLegality } from "./formats/conquest";
import { artistOf, hasBackImage, imageUrl, type CardFace, type ScryCard } from "./scryfall";

const LEGALITY_FORMATS: [string, string][] = [
  ["commander", "Commander"], ["standard", "Standard"], ["pioneer", "Pioneer"], ["modern", "Modern"],
  ["legacy", "Legacy"], ["vintage", "Vintage"], ["pauper", "Pauper"], ["brawl", "Brawl"],
];
const LEGALITY_LABEL: Record<string, string> = { legal: "Legal", not_legal: "Not legal", banned: "Banned", restricted: "Restricted" };

export interface CardDetailAction {
  label: string;
  run: () => void;
}

export function showCardDetails(card: ScryCard, actions: CardDetailAction[] = []) {
  let face = 0;
  const img = h("img", { class: "detail-img", alt: card.name });
  const flip = hasBackImage(card)
    ? h("button", { class: "btn ghost small flip", onclick: () => { face = 1 - face; img.src = imageUrl(card, "large", face) ?? ""; } }, "⟲ Flip")
    : null;
  img.src = imageUrl(card, "large") ?? "";

  // Multi-face cards list each face's text; otherwise the card's own fields.
  const faces: CardFace[] = card.card_faces?.length ? card.card_faces : [card];

  const dialog = h("dialog", { class: "card-detail", "aria-label": card.name },
    h("button", { class: "dialog-close", "aria-label": "Close", onclick: () => dialog.close() }, "×"),
    h("div", { class: "detail-grid" },
      h("div", { class: "detail-image" }, img, flip),
      h("div", { class: "detail-text" },
        ...faces.map((f) => h("section", { class: "face" },
          h("div", { class: "face-head" }, h("h2", null, f.name), manaCost(f.mana_cost)),
          h("p", { class: "type-line" }, f.type_line ?? card.type_line),
          f.oracle_text && rulesText(f.oracle_text),
          f.flavor_text && h("p", { class: "flavor" }, f.flavor_text),
          stats(f) && h("p", { class: "pt" }, stats(f)),
        )),
        h("p", { class: "printing muted small" },
          `${card.set_name} (${card.set.toUpperCase()}) #${card.collector_number} · ${capitalize(card.rarity)}`,
          artistOf(card) && h("span", null, h("br"), `Illustrated by ${artistOf(card)}`),
        ),
        h("div", { class: "legalities" },
          conquestChip(card),
          ...LEGALITY_FORMATS.map(([k, label]) => {
            const v = card.legalities?.[k] ?? "not_legal";
            return h("span", { class: `legal is-${v}`, title: LEGALITY_LABEL[v] ?? v }, label);
          }),
        ),
        h("div", { class: "detail-actions" },
          ...actions.map((a) => h("button", { class: "btn small", onclick: () => { a.run(); dialog.close(); } }, a.label)),
          h("a", { class: "btn ghost small", href: card.scryfall_uri, target: "_blank", rel: "noopener" }, "View on Scryfall ↗"),
        ),
      ),
    ),
  );
  dialog.addEventListener("close", () => dialog.remove());
  dialog.addEventListener("click", (e) => closeOnBackdrop(e, dialog));
  document.body.append(dialog);
  dialog.showModal();
}

/** Conquest isn't a Scryfall format, so its legality comes from our own rules. */
function conquestChip(card: ScryCard) {
  const v = cardLegality(card);
  return h("span", { class: `legal ${v.ok ? "is-legal" : "is-banned"}`, title: v.ok ? "Legal" : `Not legal: ${v.reason}` }, "Conquest");
}

function stats(f: CardFace): string | undefined {
  if (f.power !== undefined && f.toughness !== undefined) return `${f.power}/${f.toughness}`;
  if (f.loyalty !== undefined) return `Loyalty ${f.loyalty}`;
  if (f.defense !== undefined) return `Defense ${f.defense}`;
  return undefined;
}

function capitalize(s: string) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * Closes a modal <dialog> when a click lands outside its box (on the backdrop). A click on the
 * dialog's own padding also targets the dialog element, so compare positions, not just targets.
 * Keyboard "clicks" (detail 0, no position) never close it.
 */
export function closeOnBackdrop(e: MouseEvent, dialog: HTMLDialogElement | null) {
  if (!dialog || e.target !== dialog || e.detail === 0) return;
  const r = dialog.getBoundingClientRect();
  const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  if (!inside) dialog.close();
}
