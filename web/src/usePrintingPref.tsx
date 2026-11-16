// The player's default printing (src/printings.ts) in React: account → this browser → Scryfall's default.
import { useConvexAuth, useQuery } from "convex/react";
import { useEffect, useSyncExternalStore } from "react";
import { api } from "../convex/_generated/api";
import { DEFAULT_PRINTING_PREF, isPrintingPref, type PrintingPref } from "./printings";

const STORE_KEY = "cq.printingPref";
let current: PrintingPref = load();
const subscribers = new Set<() => void>();

function load(): PrintingPref {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return isPrintingPref(raw) ? raw : DEFAULT_PRINTING_PREF;
  } catch {
    return DEFAULT_PRINTING_PREF;
  }
}

/** Use this preference now (and remember it in this browser). Saving to the account is the caller's. */
export function setPrintingPref(pref: PrintingPref) {
  current = pref;
  try {
    localStorage.setItem(STORE_KEY, pref);
  } catch {
    // private mode: still used for this visit
  }
  subscribers.forEach((f) => f());
}

/** The current preference, for code outside React. */
export const printingPref = () => current;

export function usePrintingPref(): PrintingPref {
  return useSyncExternalStore(
    (f) => (subscribers.add(f), () => subscribers.delete(f)),
    () => current,
  );
}

/** Mounted once (App): takes the signed-in player's saved preference. */
export function PrintingPrefSync() {
  const { isAuthenticated } = useConvexAuth();
  const saved = useQuery(api.settings.get, isAuthenticated ? {} : "skip");
  const pref = saved?.printingPref;
  useEffect(() => {
    if (isPrintingPref(pref)) setPrintingPref(pref);
  }, [pref]);
  return null;
}
