// Mana costs and rules text with Scryfall's symbol images (svgs.scryfall.io has no rate limit).

function Symbol({ sym }: { sym: string }) {
  return <img className="sym" src={`https://svgs.scryfall.io/card-symbols/${encodeURIComponent(sym.replace(/\//g, ""))}.svg`} alt={`{${sym}}`} title={`{${sym}}`} />;
}

export function ManaCost({ cost }: { cost?: string }) {
  if (!cost) return <span className="mana" />;
  const parts: React.ReactNode[] = [];
  let i = 0;
  for (const m of cost.matchAll(/\{([^}]+)\}|( \/\/ )/g)) {
    parts.push(m[2] ? " // " : <Symbol key={i++} sym={m[1]} />);
  }
  return <span className="mana">{parts}</span>;
}
