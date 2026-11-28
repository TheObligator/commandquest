// The game server announced it's about to restart for an update (a new staging build): a countdown
// across the top, so nobody is surprised when their game ends.
import { useEffect, useState } from "react";

export function RestartBanner({ at }: { at: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (at === null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [at]);
  if (at === null || now > at + 120_000) return null;
  const left = Math.max(0, Math.ceil((at - now) / 1000));
  const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  return (
    <div className="restart-banner" role="status">
      {left > 0 ? <>Server update in <b>{clock}</b>: games in progress will end then.</> : <>The server is restarting for an update…</>}
    </div>
  );
}
