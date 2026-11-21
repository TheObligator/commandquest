// While a table's page (or its game) is open, check in with Convex every 20 seconds, so a player
// who closed it is let go before the game starts (convex/tables.ts, AWAY_MS).
import { useMutation } from "convex/react";
import { useEffect } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

const EVERY_MS = 20_000;

export function useTablePresence(id: Id<"tables"> | null | undefined) {
  const heartbeat = useMutation(api.tables.heartbeat);
  useEffect(() => {
    if (!id) return;
    const beat = () => void heartbeat({ id }).catch(() => undefined); // gone, or not seated any more: the page shows it
    beat();
    const timer = window.setInterval(beat, EVERY_MS);
    const onVisible = () => document.visibilityState === "visible" && beat();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [id, heartbeat]);
}
