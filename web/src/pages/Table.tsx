// Game table preview. There's no game engine connection yet: a simulated game (game/sim.ts) stands
// in for the Forge server so the table layout, stops and decisions can be tried out. The real game
// screen will reuse these components with views from the server.
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { errorMessage } from "../app/errors";
import { useRoute } from "../app/router";
import { toast } from "../dom";
import { ActionRail } from "../game/ActionRail";
import { PreviewContext, useCardData, type Preview } from "../game/cards";
import { HandBar } from "../game/HandBar";
import { PhaseStrip, type Seat } from "../game/PhaseStrip";
import { DEFAULT_PRESET, presetFromStops, stopsFromPreset, type StopPreset, type TableStops } from "../game/phases";
import { SeatBoard, type ZoneName } from "../game/SeatBoard";
import { ME, SIM_CARD_NAMES } from "../game/sim";
import { useSimGame } from "../game/useSimGame";
import { prune, type Arrangement } from "../game/view";
import { ZoneViewer } from "../game/ZoneViewer";
import "../game/table.css";

type LayoutId = "pod" | "focus" | "stacked" | "equal";
const LAYOUTS: { id: LayoutId; label: string; title: string }[] = [
  { id: "pod", label: "Pod", title: "Opponents in a row across the top, you below" },
  { id: "focus", label: "Focus", title: "Like pod, with your board much larger" },
  { id: "stacked", label: "Stacked", title: "One row per player: you, then each opponent in turn order" },
  { id: "equal", label: "Equal", title: "Everyone gets a quarter of the table, clockwise in turn order" },
];

const OPPONENT_NAMES = ["Opponent 1", "Opponent 2", "Opponent 3"];

function useStored<T extends string | boolean>(key: string, fallback: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  });
  return [
    v,
    (next: T) => {
      setV(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // private mode: the choice just isn't remembered
      }
    },
  ];
}

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
        <div className="seg" role="group" aria-label="Layout">
          {LAYOUTS.map((l) => (
            <button key={l.id} className={l.id === layout ? "on" : undefined} aria-pressed={l.id === layout} title={l.title} onClick={() => setLayout(l.id)}>
              {l.label}
            </button>
          ))}
        </div>
      </div>
      <Game key={`${count}-${start}-${nonce}`} count={count} start={start} layout={layout} myName={me?.name ?? "You"} />
    </div>
  );
}

function Game({ count, start, layout, myName }: { count: number; start: "new" | "mid"; layout: LayoutId; myName: string }) {
  const { isAuthenticated } = useConvexAuth();
  const savedPreset = useQuery(api.stops.get) as StopPreset | undefined;
  const savePreset = useMutation(api.stops.save);
  const resetPreset = useMutation(api.stops.reset);
  const [perOpponent, setPerOpponent] = useStored<boolean>("cq.table.perOpponent", false);
  const [holdPriority, setHoldPriority] = useStored<boolean>("cq.table.holdPriority", false);

  const names = useMemo(() => [myName, ...OPPONENT_NAMES.slice(0, count - 1)], [count, myName]);
  const oppIds = useMemo(() => Array.from({ length: count - 1 }, (_, i) => `opp${i + 1}`), [count]);

  // Stops start from the saved preset once it loads (or the defaults), then change locally.
  const [stops, setStops] = useState<TableStops>(() => stopsFromPreset(DEFAULT_PRESET, ME, oppIds));
  const loaded = useRef(false);
  useEffect(() => {
    if (savedPreset && !loaded.current) {
      loaded.current = true;
      setStops(stopsFromPreset(savedPreset, ME, oppIds));
    }
  }, [savedPreset, oppIds]);

  const sim = useSimGame({ kind: start, names, stops, holdPriority });
  const v = sim.view;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [arrangements, setArrangements] = useState<Record<string, Arrangement>>({});
  const [zone, setZone] = useState<{ owner: string; zone: ZoneName } | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [bottomIds, setBottomIds] = useState<number[]>([]);

  const seatOf = (id: string) => v.players.find((p) => p.id === id);
  const nameOf = (id: string) => (id === ME ? "you" : seatOf(id)?.name ?? id);
  const colorOf = (id: string) => seatOf(id)?.color ?? "#888";
  const meSeat: Seat = { id: ME, name: myName, color: v.players[0].color };
  const oppSeats: Seat[] = v.players.slice(1).map((p) => ({ id: p.id, name: p.name, color: p.color }));

  const err = (msg: string | undefined) => msg && toast(msg, "error");
  const playCard = (id: number) => err(sim.play(id));

  // Keyboard: F2 pass, F6 / E / B / R auto-pass, H hold priority, Esc closes the enlarged board.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    if ((e.target as HTMLElement).closest("input, textarea, select, dialog") || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const playing = sim.phase === "playing";
    if (k === "F2" && playing) sim.pass();
    else if ((k === "F6" || k === "e") && playing) sim.setAutoPass("END_OF_TURN");
    else if (k === "b" && playing) sim.setAutoPass("BEFORE_MY_TURN");
    else if (k === "r" && playing) sim.setAutoPass("ACTION_OR_END_STEP");
    else if (k === "h") setHoldPriority(!holdPriority);
    else if (k === "Escape" && focused) setFocused(null);
    else return;
    e.preventDefault();
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  async function save() {
    if (!isAuthenticated) return toast("Sign in to save your stops.", "error");
    try {
      const p = presetFromStops(stops, ME, oppIds);
      // Keep saved seats this smaller game doesn't have.
      const seats = [...(p.seats ?? []), ...(savedPreset?.seats?.slice(oppIds.length) ?? [])];
      await savePreset({ ...p, seats });
      toast("Saved as your default stops for every game");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  async function reset() {
    const preset = isAuthenticated ? ((await resetPreset()) as StopPreset) : DEFAULT_PRESET;
    setStops(stopsFromPreset(preset, ME, oppIds));
    toast("Stops reset to the defaults");
  }

  const seat = (id: string, opts: { area?: string; focusedView?: boolean } = {}) => {
    const p = seatOf(id)!;
    const isMe = id === ME;
    const big = opts.focusedView || (isMe && layout === "focus");
    return (
      <div key={id + (opts.focusedView ? "-focus" : "")} className="seat-cell" style={{ gridArea: opts.area }}>
        <SeatBoard
          player={p}
          viewer={ME}
          active={v.active === id}
          maxCard={big ? 150 : isMe ? 130 : layout === "stacked" ? 110 : 100}
          arrangement={arrangements[id] ?? {}}
          onArrange={(a) => setArrangements((all) => ({ ...all, [id]: prune(a, p.battlefield) }))}
          nameOf={nameOf}
          colorOf={colorOf}
          onOpenZone={(owner, z) => setZone({ owner, zone: z })}
          onPlayFromHand={isMe ? playCard : undefined}
          onTap={isMe ? sim.toggleTap : undefined}
          onCastCommander={isMe ? () => err(sim.castCommander()) : undefined}
          onFocus={() => setFocused(opts.focusedView ? null : id)}
          focused={opts.focusedView}
          line={layout === "stacked" && !opts.focusedView}
        />
      </div>
    );
  };

  // Seats in turn order: o1 is the player after you. "equal" goes clockwise from bottom-left.
  const opps = v.players.slice(1).map((p) => p.id);
  const area = (id: string) => (id === ME ? "me" : `o${opps.indexOf(id) + 1}`);
  const k = opps.length;
  const oAreas = opps.map(area);
  const grid: Record<LayoutId, { areas: string[]; rows: string }> = {
    pod: { areas: [oAreas.join(" "), Array(k).fill("me").join(" ")], rows: "1fr 1.3fr" },
    focus: { areas: [oAreas.join(" "), Array(k).fill("me").join(" ")], rows: "1fr 2.2fr" },
    stacked: { areas: ["me", ...oAreas], rows: `1.3fr ${Array(k).fill("1fr").join(" ")}` },
    equal: {
      areas: k === 1 ? ["o1", "me"] : k === 2 ? ["o1 o2", "me me"] : ["o1 o2", "me o3"],
      rows: "1fr 1fr",
    },
  };
  const g = grid[layout];

  const zonePlayer = zone && seatOf(zone.owner);
  const ZONE_TITLES: Record<ZoneName, string> = { graveyard: "graveyard", exile: "exile", command: "command zone", library: "library" };

  return (
    <PreviewContext.Provider value={setPreview}>
      <div className="game-main">
        <ActionRail sim={sim} nameOf={nameOf} colorOf={colorOf} bottomIds={bottomIds} preview={preview} onError={(m) => toast(m, "error")} />

        <div className="game-center">
          <div
            className={`game-table layout-${layout}`}
            style={{ gridTemplateAreas: g.areas.map((a) => `"${a}"`).join(" "), gridTemplateRows: g.rows }}
          >
            {v.players.map((p) => seat(p.id, { area: area(p.id) }))}
            {focused && seatOf(focused) && <div className="focus-overlay">{seat(focused, { focusedView: true })}</div>}
          </div>
          <HandBar
            cards={v.players[0].hand}
            viewer={ME}
            nameOf={nameOf}
            selecting={sim.phase === "bottom"}
            selected={bottomIds}
            onToggleSelect={(id) => setBottomIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : ids.length < sim.mulligans ? [...ids, id] : ids))}
            onPlay={playCard}
          />
        </div>

        <div className="strip-col">
          <PhaseStrip
            me={meSeat}
            opponents={oppSeats}
            stops={stops}
            onChange={(s) => setStops(new Map(s))}
            activePlayer={v.active}
            step={v.step}
            turn={v.turn}
            priority={sim.priority && sim.phase === "playing"}
            perOpponent={perOpponent}
            onPerOpponent={setPerOpponent}
            holdPriority={holdPriority}
            onHoldPriority={setHoldPriority}
          />
          <div className="strip-actions">
            <button className="btn small" onClick={() => void save()} title="Use these stops in every new game (per seat, in turn order after you)">Save stops</button>
            <button className="btn small ghost" onClick={() => void reset()}>Reset</button>
          </div>
        </div>
      </div>

      {zone && zonePlayer && (
        <ZoneViewer
          title={`${zone.owner === ME ? "Your" : zonePlayer.name + "'s"} ${ZONE_TITLES[zone.zone]}`}
          cards={zone.zone === "graveyard" ? zonePlayer.graveyard : zone.zone === "exile" ? zonePlayer.exile : zonePlayer.command}
          viewer={ME}
          nameOf={nameOf}
          onClose={() => setZone(null)}
        />
      )}
    </PreviewContext.Provider>
  );
}
