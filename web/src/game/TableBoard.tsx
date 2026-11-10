// The table itself, shared by the simulated preview (#/table) and live games (#/game): seats in
// turn order in the chosen layout, your hand, the phase strip with your stops, and the zone viewer.
// The left rail differs (simulated decisions vs. Forge's prompts), so the caller passes it in.
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../../convex/_generated/api";
import { errorMessage } from "../app/errors";
import { toast } from "../dom";
import { Log } from "./ActionRail";
import { PreviewContext, type Preview } from "./cards";
import { HandBar } from "./HandBar";
import { PhaseStrip, type Seat } from "./PhaseStrip";
import { DEFAULT_PRESET, presetFromStops, stopsFromPreset, type StopPreset, type TableStops } from "./phases";
import { SeatBoard, type ZoneName } from "./SeatBoard";
import { prune, type Arrangement, type GameView } from "./view";
import { useKeyHint, Kbd } from "./useHotkeys";
import { ZoneViewer } from "./ZoneViewer";
import "./table.css";

export type LayoutId = "pod" | "focus" | "stacked" | "equal";
export const LAYOUTS: { id: LayoutId; label: string; title: string }[] = [
  { id: "pod", label: "Pod", title: "Opponents in a row across the top, you below" },
  { id: "focus", label: "Focus", title: "Like pod, with your board much larger" },
  { id: "stacked", label: "Stacked", title: "One row per player: you, then each opponent in turn order" },
  { id: "equal", label: "Equal", title: "Everyone gets a quarter of the table, clockwise in turn order" },
];

export function useStored<T extends string | boolean>(key: string, fallback: T): [T, (v: T) => void] {
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

export function LayoutPicker({ layout, onChange }: { layout: LayoutId; onChange: (l: LayoutId) => void }) {
  return (
    <div className="seg" role="group" aria-label="Layout">
      {LAYOUTS.map((l) => (
        <button key={l.id} className={l.id === layout ? "on" : undefined} aria-pressed={l.id === layout} title={l.title} onClick={() => onChange(l.id)}>
          {l.label}
        </button>
      ))}
    </div>
  );
}

/** Your stops for this table: from your saved preset (per seat in turn order), changed locally, saved on request. */
export function useTableStops(me: string, oppIds: string[]) {
  const { isAuthenticated } = useConvexAuth();
  const savedPreset = useQuery(api.stops.get) as StopPreset | undefined;
  const savePreset = useMutation(api.stops.save);
  const resetPreset = useMutation(api.stops.reset);
  const [perOpponent, setPerOpponent] = useStored<boolean>("cq.table.perOpponent", false);
  const [holdPriority, setHoldPriority] = useStored<boolean>("cq.table.holdPriority", false);
  const oppKey = oppIds.join(",");
  const [stops, setStops] = useState<TableStops>(() => stopsFromPreset(DEFAULT_PRESET, me, oppIds));
  const loadedFor = useRef("");
  useEffect(() => {
    // Start from the saved preset once it loads, and again if the seats change (a new game).
    const key = `${me}|${oppKey}`;
    if (savedPreset !== undefined && loadedFor.current !== key) {
      loadedFor.current = key;
      setStops(stopsFromPreset(savedPreset ?? DEFAULT_PRESET, me, oppIds));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedPreset, me, oppKey]);

  async function save() {
    if (!isAuthenticated) return toast("Sign in to save your stops.", "error");
    try {
      const p = presetFromStops(stops, me, oppIds);
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
    setStops(stopsFromPreset(preset, me, oppIds));
    toast("Stops reset to the defaults");
  }

  return { stops, setStops, perOpponent, setPerOpponent, holdPriority, setHoldPriority, save, reset };
}

export type TableStopsState = ReturnType<typeof useTableStops>;

export function TableBoard(props: {
  view: GameView;
  layout: LayoutId;
  /** The left rail; it shows the hovered card. */
  rail: (preview: Preview | null) => ReactNode;
  stops: TableStopsState;
  /** You have priority right now (lights up the strip). */
  priority: boolean;
  hand: {
    selecting?: boolean;
    selected?: number[];
    onToggleSelect?: (id: number) => void;
    onPlay: (id: number) => void;
    /** Single click on a hand card (live games: Forge decides what that does). */
    onClick?: (id: number) => void;
  };
  /** Click on any card on any board (live games). Without it, clicking your own permanent taps it. */
  onCardClick?: (id: number) => void;
  onPlayerClick?: (id: string) => void;
  onTap?: (id: number) => void;
  /** Cast a commander from your command zone (by card id: partners are two). */
  onCastCommander?: (id: number) => void;
  /** Cards Forge lets you pick right now. */
  selectable?: Set<number>;
}) {
  const { view: v, layout, stops: st } = props;
  const me = v.viewer;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [arrangements, setArrangements] = useState<Record<string, Arrangement>>({});
  const [zone, setZone] = useState<{ owner: string; zone: ZoneName } | null>(null);
  const [focused, setFocused] = useState<string | null>(null);

  const seatOf = (id: string) => v.players.find((p) => p.id === id);
  const nameOf = (id: string) => (id === me ? "you" : seatOf(id)?.name ?? id);
  const colorOf = (id: string) => seatOf(id)?.color ?? "#888";
  const meSeat: Seat = { id: me, name: v.players[0].name, color: v.players[0].color };
  const oppSeats: Seat[] = useMemo(() => v.players.slice(1).map((p) => ({ id: p.id, name: p.name, color: p.color })), [v.players]);

  useEffect(() => {
    if (!focused) return;
    const on = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFocused(null);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [focused]);

  const seat = (id: string, opts: { area?: string; focusedView?: boolean } = {}) => {
    const p = seatOf(id)!;
    const isMe = id === me;
    const big = opts.focusedView || (isMe && layout === "focus");
    return (
      <div key={id + (opts.focusedView ? "-focus" : "")} className="seat-cell" style={{ gridArea: opts.area }}>
        <SeatBoard
          player={p}
          viewer={me}
          active={v.active === id}
          maxCard={big ? 150 : isMe ? 130 : layout === "stacked" ? 110 : 100}
          arrangement={arrangements[id] ?? {}}
          onArrange={(a) => setArrangements((all) => ({ ...all, [id]: prune(a, p.battlefield) }))}
          nameOf={nameOf}
          colorOf={colorOf}
          onOpenZone={(owner, z) => setZone({ owner, zone: z })}
          onPlayFromHand={isMe ? props.hand.onPlay : undefined}
          onTap={isMe ? props.onTap : undefined}
          onCardClick={props.onCardClick}
          onPlayerClick={props.onPlayerClick}
          onCastCommander={isMe ? props.onCastCommander : undefined}
          onFocus={() => setFocused(opts.focusedView ? null : id)}
          focused={opts.focusedView}
          line={layout === "stacked" && !opts.focusedView}
          selectable={props.selectable}
        />
      </div>
    );
  };

  // Seats in turn order: o1 is the player after you. "equal" goes clockwise from bottom-left.
  const opps = v.players.slice(1).map((p) => p.id);
  const area = (id: string) => (id === me ? "me" : `o${opps.indexOf(id) + 1}`);
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
        {props.rail(preview)}

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
            viewer={me}
            nameOf={nameOf}
            selecting={!!props.hand.selecting}
            selected={props.hand.selected ?? []}
            onToggleSelect={props.hand.onToggleSelect ?? (() => {})}
            onPlay={props.hand.onPlay}
            onClick={props.hand.onClick}
            selectable={props.selectable}
          />
        </div>

        <div className="strip-col">
          <PhaseStrip
            me={meSeat}
            opponents={oppSeats}
            stops={st.stops}
            onChange={(s) => st.setStops(new Map(s))}
            activePlayer={v.active}
            step={v.step}
            turn={v.turn}
            priority={props.priority}
            perOpponent={st.perOpponent}
            onPerOpponent={st.setPerOpponent}
          />
          <div className="strip-actions">
            <button className="btn small" onClick={() => void st.save()} title="Use these stops in every new game (per seat, in turn order after you)">Save stops</button>
            <button className="btn small ghost" onClick={() => void st.reset()}>Reset</button>
          </div>
          <HoldPriority on={st.holdPriority} onChange={st.setHoldPriority} />
          <Log lines={v.log} />
        </div>
      </div>

      {zone && zonePlayer && (
        <ZoneViewer
          title={`${zone.owner === me ? "Your" : zonePlayer.name + "'s"} ${ZONE_TITLES[zone.zone]}`}
          cards={zone.zone === "graveyard" ? zonePlayer.graveyard : zone.zone === "exile" ? zonePlayer.exile : zonePlayer.command}
          viewer={me}
          nameOf={nameOf}
          onClose={() => setZone(null)}
        />
      )}
    </PreviewContext.Provider>
  );
}

/** Hold priority: after you cast a spell or activate an ability, keep priority instead of passing. */
function HoldPriority({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  const hint = useKeyHint("holdPriority");
  return (
    <button
      className={`ps-hold${on ? " on" : ""}`}
      aria-pressed={on}
      title={`${on ? "On: you keep priority after you cast or activate something, so you can do more before passing." : "Off: casting or activating something passes priority."}${hint}`}
      onClick={() => onChange(!on)}
    >
      Hold priority
      <span className="ps-toggle"><i /></span>
      <Kbd action="holdPriority" />
    </button>
  );
}
