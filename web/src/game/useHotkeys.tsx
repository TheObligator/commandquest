// The player's game hotkeys in React: the current keys (account → this browser → defaults), a
// <Kbd> that shows the key bound to an action, and useHotkeys() to run actions on key presses.
import { useConvexAuth, useQuery } from "convex/react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { api } from "../../convex/_generated/api";
import { DEFAULT_HOTKEYS, keyLabel, keyName, MODIFIER_KEYS, withDefaults, type HotkeyAction, type Hotkeys } from "./hotkeys";

const STORE_KEY = "cq.hotkeys";
let current: Hotkeys = load();
const subscribers = new Set<() => void>();

function load(): Hotkeys {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? withDefaults(JSON.parse(raw)) : DEFAULT_HOTKEYS;
  } catch {
    return DEFAULT_HOTKEYS;
  }
}

/** Use these keys now (and remember them in this browser). Saving to the account is the caller's. */
export function setHotkeys(keys: Hotkeys) {
  current = keys;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(keys));
  } catch {
    // private mode: still used for this visit
  }
  subscribers.forEach((f) => f());
}

export function useHotkeyMap(): Hotkeys {
  return useSyncExternalStore(
    (f) => (subscribers.add(f), () => subscribers.delete(f)),
    () => current,
  );
}

/** Mounted once (App): takes the signed-in player's saved keys. */
export function HotkeysSync() {
  const { isAuthenticated } = useConvexAuth();
  const saved = useQuery(api.settings.get, isAuthenticated ? {} : "skip");
  const json = saved ? JSON.stringify(saved.hotkeys) : null;
  useEffect(() => {
    if (json !== null) setHotkeys(withDefaults(JSON.parse(json)));
  }, [json]);
  return null;
}

/** The key for an action, as a <kbd> (nothing when it's unbound). */
export function Kbd({ action }: { action: HotkeyAction }) {
  const key = useHotkeyMap()[action];
  return key ? <kbd>{keyLabel(key)}</kbd> : null;
}

/** "(Shift)" style suffix for titles. */
export function useKeyHint(action: HotkeyAction): string {
  const key = useHotkeyMap()[action];
  return key ? ` (${keyLabel(key)})` : "";
}

/**
 * Runs `handlers[action]` when its key is pressed outside text fields and dialogs. A handler that
 * returns false didn't handle it (the key does its usual thing). Modifier keys (Shift, Ctrl, Alt)
 * fire when tapped on their own, so Shift+click and capitals don't trigger them.
 */
export function useHotkeys(handlers: Partial<Record<HotkeyAction, () => boolean | void>>) {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    let modifierDown: string | null = null;
    const ignored = (e: KeyboardEvent) =>
      !!(e.target as HTMLElement | null)?.closest?.("input, textarea, select, dialog, [contenteditable]") || document.querySelector("dialog[open]");
    const run = (name: string, e: KeyboardEvent) => {
      const keys = current;
      for (const [action, fn] of Object.entries(ref.current) as [HotkeyAction, () => boolean | void][]) {
        if (fn && keys[action] === name && fn() !== false) {
          e.preventDefault();
          // A focused button would also "click" on Space / Enter.
          if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
          return;
        }
      }
    };
    const down = (e: KeyboardEvent) => {
      const name = keyName(e.key);
      if (MODIFIER_KEYS.has(name)) {
        modifierDown = e.repeat ? modifierDown : name;
        return;
      }
      modifierDown = null;
      if (e.ctrlKey || e.metaKey || e.altKey || ignored(e)) return;
      run(name, e);
    };
    const up = (e: KeyboardEvent) => {
      const name = keyName(e.key);
      if (MODIFIER_KEYS.has(name) && modifierDown === name && !ignored(e)) run(name, e);
      modifierDown = null;
    };
    const reset = () => (modifierDown = null);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("pointerdown", reset);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("pointerdown", reset);
      window.removeEventListener("blur", reset);
    };
  }, []);
}
