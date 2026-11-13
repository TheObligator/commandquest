// Game hotkeys: the actions, their default keys, and how a key press is named. Players change them
// on the Settings page (#/settings); they're saved to their account (Convex `settings`) and in
// this browser. No React or DOM here, so `npm test` and the Convex functions can use it.

export type HotkeyAction =
  | "ok"
  | "cancel"
  | "holdPriority"
  | "castCommander"
  | "autoEndOfTurn"
  | "autoBeforeMyTurn"
  | "autoUntilMyTurn"
  | "autoActionOrEnd";

export const HOTKEY_ACTIONS: { id: HotkeyAction; label: string; hint: string; key: string }[] = [
  { id: "ok", label: "Pass priority / OK", hint: "The main button: pass priority, OK, Keep, Confirm.", key: "Space" },
  { id: "cancel", label: "Second button", hint: "Cancel, Mulligan, End turn: whatever the second button says.", key: "X" },
  { id: "holdPriority", label: "Hold priority", hint: "Turn holding priority on or off. Pressed on its own (a modifier key works when tapped alone).", key: "Shift" },
  { id: "castCommander", label: "Cast your commander", hint: "Casts your commander from the command zone (the first one, with partners).", key: "C" },
  { id: "autoEndOfTurn", label: "Auto-pass: end of turn", hint: "Skip the rest of this turn.", key: "E" },
  { id: "autoBeforeMyTurn", label: "Auto-pass: before my turn", hint: "Skip until the end step of the player right before you.", key: "B" },
  { id: "autoUntilMyTurn", label: "Auto-pass: until my turn", hint: "Skip everything until your next turn starts, including the end step before it.", key: "M" },
  { id: "autoActionOrEnd", label: "Auto-pass: action / end step", hint: "Skip until someone casts something, or this turn's end step.", key: "R" },
];

export type Hotkeys = Record<HotkeyAction, string>;

export const DEFAULT_HOTKEYS: Hotkeys = Object.fromEntries(HOTKEY_ACTIONS.map((a) => [a.id, a.key])) as Hotkeys;

/** Keys that can't be bound: Escape closes things, Tab moves focus, Meta is the OS's. */
export const RESERVED_KEYS = new Set(["Escape", "Tab", "Meta", "CapsLock", "ContextMenu"]);

export const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt"]);

/** The name of the key a KeyboardEvent-like `key` stands for: "E", "Space", "Shift", "ArrowUp", "1". */
export function keyName(key: string): string {
  if (key === " " || key === "Spacebar") return "Space";
  if (key.length === 1) return key.toUpperCase();
  return key;
}

/** A key's label for buttons and the settings page. */
export function keyLabel(name: string): string {
  const labels: Record<string, string> = {
    Space: "Space", Shift: "Shift", Control: "Ctrl", Alt: "Alt", Enter: "Enter", Backspace: "⌫",
    ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Delete: "Del",
  };
  return name ? labels[name] ?? name : "—";
}

/** Whether a key name can be bound (empty means unbound). */
export function validKey(name: string): boolean {
  return name === "" || (name.length <= 20 && !RESERVED_KEYS.has(name) && /^[\x21-\x7e]$|^[A-Za-z][A-Za-z0-9]*$/.test(name));
}

/** Saved keys over the defaults; unknown actions and invalid keys are dropped. */
export function withDefaults(saved: Partial<Record<string, string>> | null | undefined): Hotkeys {
  const out = { ...DEFAULT_HOTKEYS };
  for (const a of HOTKEY_ACTIONS) {
    const k = saved?.[a.id];
    if (typeof k === "string" && validKey(k)) out[a.id] = k;
  }
  return out;
}

/** Binds `key` to `action`; another action that had that key is left unbound. */
export function bind(keys: Hotkeys, action: HotkeyAction, key: string): { keys: Hotkeys; unbound?: HotkeyAction } {
  const next = { ...keys, [action]: key };
  const other = key ? HOTKEY_ACTIONS.find((a) => a.id !== action && keys[a.id] === key)?.id : undefined;
  if (other) next[other] = "";
  return { keys: next, unbound: other };
}

/** Only what differs from the defaults (what gets saved). */
export function changedKeys(keys: Hotkeys): Partial<Hotkeys> {
  return Object.fromEntries(HOTKEY_ACTIONS.filter((a) => keys[a.id] !== a.key).map((a) => [a.id, keys[a.id]]));
}
