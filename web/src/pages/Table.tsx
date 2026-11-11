// Game table preview: a simulated game (game/sim.ts) stands in for the Forge server, so the table
// layout, stops and decisions can be tried without a game server. Live games (#/game) use the same
// board (game/TableBoard.tsx) with views from the server.
import { useConvexAuth, useQuery } from "convex/react";
import { useMemo, useState } from "react";
import { api } from "../../convex/_generated/api";
import { useRoute } from "../app/router";
import { toast } from "../dom";
import { ActionRail } from "../game/ActionRail";
import { useCardData } from "../game/cards";
import { ME, SIM_CARD_NAMES } from "../game/sim";
import { LayoutPicker, TableBoard, useStored, useTableStops, type LayoutId } from "../game/TableBoard";
import { useHotkeys } from "../game/useHotkeys";
import { useSimGame } from "../game/useSimGame";

const OPPONENT_NAMES = ["Opponent 1", "Opponent 2", "Opponent 3"];

export function Table() {
  const { query } = useRoute();
  const count = Math.min(4, Math.max(2, Number(query.get("players")) || 4));
  const start = query.get("start") === "new" ? "new" : "mid";
  const [nonce, setNonce] = useState(0);
  const [layout, setLayout] = useStored<LayoutId>("cq.table.layout", "pod");
  const { isAuthenticated } = useConvexAuth();
  const me = useQuery(api.users.me, isAuthenticated ? {} : "skip");
  useCardData(SIM_CARD_NAMES);

  const link = (params: Record<string, string | number>) => {
    const q = new URLSearchParams({ players: String(count), ...(start === "new" ? { start } : {}) });
    for (const [k, v] of Object.entries(params)) q.set(k, String(v));
    if (q.get("start") === "mid") q.delete("start");
    return `#/table?${q}`;
  };

  return (
    <div className="game">
      <div className="game-toolbar">
        <h1>Game table <span className="muted small">preview · simulated opponents</span></h1>
        <div className="seg" role="group" aria-label="Players">
          {[2, 3, 4].map((n) => (
            <a key={n} className={n === count ? "on" : undefined} href={link({ players: n })}>{n}p</a>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Start">
          <a className={start === "mid" ? "on" : undefined} href={link({ start: "mid" })} title="Turn 9 with full boards">Mid-game</a>
          <a className={start === "new" ? "on" : undefined} href={link({ start: "new" })} title="Opening hands and mulligans">New game</a>
        </div>
        <button className="btn small ghost" onClick={() => setNonce((n) => n + 1)} title="Start this scenario over">Restart</button>
        <span className="sb-spacer" />
        <LayoutPicker layout={layout} onChange={setLayout} />
      </div>
      <Game key={`${count}-${start}-${nonce}`} count={count} start={start} layout={layout} myName={me?.name ?? "You"} />
    </div>
  );
}

function Game({ count, start, layout, myName }: { count: number; start: "new" | "mid"; layout: LayoutId; myName: string }) {
  const names = useMemo(() => [myName, ...OPPONENT_NAMES.slice(0, count - 1)], [count, myName]);
  const oppIds = useMemo(() => Array.from({ length: count - 1 }, (_, i) => `opp${i + 1}`), [count]);
  const st = useTableStops(ME, oppIds);
  const sim = useSimGame({ kind: start, names, stops: st.stops, holdPriority: st.holdPriority });
  const v = sim.view;
  const [bottomIds, setBottomIds] = useState<number[]>([]);

  const seatOf = (id: string) => v.players.find((p) => p.id === id);
  const nameOf = (id: string) => (id === ME ? "you" : seatOf(id)?.name ?? id);
  const colorOf = (id: string) => seatOf(id)?.color ?? "#888";
  const err = (msg: string | undefined) => msg && toast(msg, "error");
  const playCard = (id: number) => err(sim.play(id));

  // Your hotkeys (Settings): auto-pass skips and hold priority. The decision's buttons handle their own.
  const playing = sim.phase === "playing";
  useHotkeys({
    autoEndOfTurn: () => (playing ? sim.setAutoPass("END_OF_TURN") : false),
    autoBeforeMyTurn: () => (playing ? sim.setAutoPass("BEFORE_MY_TURN") : false),
    autoActionOrEnd: () => (playing ? sim.setAutoPass("ACTION_OR_END_STEP") : false),
    holdPriority: () => st.setHoldPriority(!st.holdPriority),
  });

  return (
    <TableBoard
      view={v}
      layout={layout}
      stops={st}
      priority={sim.priority && sim.phase === "playing"}
      rail={(preview) => (
        <ActionRail sim={sim} nameOf={nameOf} colorOf={colorOf} bottomIds={bottomIds} preview={preview} onError={(m) => toast(m, "error")} />
      )}
      hand={{
        selecting: sim.phase === "bottom",
        selected: bottomIds,
        onToggleSelect: (id) => setBottomIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : ids.length < sim.mulligans ? [...ids, id] : ids)),
        onPlay: playCard,
      }}
      onTap={sim.toggleTap}
      menuFor={(t) => {
        if (t.kind !== "card" || t.card.controller !== ME) return { sections: [] };
        const c = t.card;
        if (t.where === "hand") return { sections: [{ items: [{ label: `Play ${c.name}`, onSelect: () => playCard(c.id) }] }] };
        if (t.where === "battlefield") return { sections: [{ items: [{ label: c.tapped ? "Untap" : "Tap", onSelect: () => sim.toggleTap(c.id) }] }] };
        if (t.where === "command") return { sections: [{ items: [{ label: `Cast ${c.name}`, onSelect: () => err(sim.castCommander()) }] }] };
        return { sections: [] };
      }}
      onCastCommander={() => err(sim.castCommander())}
    />
  );
}
