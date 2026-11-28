// Mana costs and rules text with Scryfall's symbol images (svgs.scryfall.io has no rate limit), or
// in the game's mana choices the Mana font's symbols (mana-font), which match its keyword icons.
import "mana-font/css/mana.min.css";
import { manaSymbolClass } from "../manaSymbols";

export function Symbol({ sym }: { sym: string }) {
  return <img className="sym" src={`https://svgs.scryfall.io/card-symbols/${encodeURIComponent(sym.replace(/\//g, ""))}.svg`} alt={`{${sym}}`} title={`{${sym}}`} />;
}

/** A symbol in the Mana font, or Scryfall's image when the font has none. */
export function FontSymbol({ sym }: { sym: string }) {
  const cls = manaSymbolClass(sym);
  if (!cls) return <Symbol sym={sym} />;
  return <i className={`${cls} ms-shadow sym-font`} role="img" aria-label={`{${sym}}`} title={`{${sym}}`} />;
}

/** `font`: draw the symbols with the Mana font (the game's mana choices). */
export function ManaCost({ cost, font }: { cost?: string; font?: boolean }) {
  if (!cost) return <span className="mana" />;
  const parts: React.ReactNode[] = [];
  let i = 0;
  const Sym = font ? FontSymbol : Symbol;
  for (const m of cost.matchAll(/\{([^}]+)\}|( \/\/ )/g)) {
    parts.push(m[2] ? " // " : <Sym key={i++} sym={m[1]} />);
  }
  return <span className="mana">{parts}</span>;
}
