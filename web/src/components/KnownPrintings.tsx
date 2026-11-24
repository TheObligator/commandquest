// The printings we already know of, in a printings window that's still waiting for Scryfall's list. They are
// all in that list, so it only ever grows when it arrives.
import * as scry from "../scryfall";
import { CardImg } from "./CardImg";

export function KnownPrintings({ cards, selected }: { cards: (scry.ScryCard | undefined)[]; selected?: string }) {
  return (
    <>
      {cards.map((p) => p && (
        <div key={p.id} className={p.id === selected ? "result-img selected known" : "result-img known"}>
          <CardImg src={scry.imageUrl(p, "normal") ?? ""} name={p.set_name} alt={p.set_name} />
          <span className="small muted">{p.set.toUpperCase()} #{p.collector_number}</span>
          {scry.artistOf(p) && <span className="small muted">{scry.artistOf(p)}</span>}
        </div>
      ))}
    </>
  );
}
