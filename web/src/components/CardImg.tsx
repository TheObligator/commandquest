// A card's picture. While it's on its way there's a card-shaped placeholder with its name and a
// light sweeping over it; when it arrives it fades in; and when it can't be had, the placeholder
// stands still, says so and offers to try again. It's one <img> in a wrapper the same size, so
// styles for `.somewhere img` still apply.
import { useEffect, useLayoutEffect, useRef, useState } from "react";

/** Pictures that have loaded in this tab: showing one again doesn't show the placeholder first. */
const loaded = new Set<string>();
/** One quiet second try before saying that it didn't work. */
const RETRY_MS = 2000;

type Props = Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src" | "onLoad" | "onError"> & {
  src: string;
  /** Shown on the placeholder; "" for pictures whose name is written beside them. */
  name: string;
  /** Small pictures beside their name: only the sweeping light, no words. */
  tiny?: boolean;
};

export function CardImg({ src, name, tiny, className, ...img }: Props) {
  // A new picture (turning a card over, another printing) starts over.
  return <Picture key={src} src={src} name={name} tiny={tiny} className={className} {...img} />;
}

function Picture({ src, name, tiny, className, ...img }: Props) {
  const ref = useRef<HTMLImageElement>(null);
  const [state, setState] = useState<"loading" | "arrived" | "here" | "failed">(() => (loaded.has(src) ? "here" : "loading"));
  const [attempt, setAttempt] = useState(0);
  const auto = useRef(true);

  const arrived = (how: "arrived" | "here") => {
    loaded.add(src);
    setState(how);
  };
  // Already in the browser's cache: no placeholder, no fade.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el?.complete && el.naturalWidth > 0) arrived("here");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const again = () => {
    setState("loading");
    setAttempt((n) => n + 1);
  };
  const [retryAt, setRetryAt] = useState(false);
  useEffect(() => {
    if (!retryAt) return;
    const t = window.setTimeout(() => (setRetryAt(false), again()), RETRY_MS);
    return () => clearTimeout(t);
  }, [retryAt]);
  // Back online: what failed is worth asking for again.
  useEffect(() => {
    if (state !== "failed") return;
    window.addEventListener("online", again);
    return () => window.removeEventListener("online", again);
  }, [state]);

  return (
    <span className={`cimg ${state}${tiny ? " tiny" : ""}`}>
      <img
        {...img}
        key={attempt}
        ref={ref}
        className={className}
        src={src}
        onLoad={() => arrived("arrived")}
        onError={() => {
          loaded.delete(src);
          if (auto.current) {
            auto.current = false;
            setRetryAt(true);
          } else setState("failed");
        }}
      />
      {state === "loading" && <span className="cimg-wait shimmer" aria-hidden="true">{!tiny && <span className="cimg-name">{name}</span>}</span>}
      {state === "failed" && <NoPicture name={name} tiny={tiny} onRetry={again} />}
    </span>
  );
}

/** A card with no picture, standing still. `onRetry`: it could still be had. */
export function NoPicture({ name, tiny, onRetry, why = "No image" }: { name: string; tiny?: boolean; onRetry?: () => void; why?: string }) {
  // Often inside a card that's itself a button (or draggable): don't let the click through.
  const retry = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onRetry?.();
  };
  return (
    <span className="cimg-none">
      {!tiny && <span className="cimg-name">{name}</span>}
      {!tiny && <span className="cimg-why">{why}</span>}
      {onRetry && (
        <span
          role="button"
          tabIndex={0}
          className="cimg-retry"
          aria-label={`Try loading ${name || "the image"} again`}
          title="Try again"
          onClick={retry}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && retry(e)}
        >
          <span className="cimg-retry-words">Try again</span>
          <span className="cimg-retry-sign" aria-hidden="true">↻</span>
        </span>
      )}
    </span>
  );
}

/** Where a card's picture will be, while what it looks like is being looked up. */
export function CardWait({ name }: { name: string }) {
  return (
    <span className="cimg blank">
      <span className="cimg-wait shimmer"><span className="cimg-name">{name}</span></span>
    </span>
  );
}

/** The same, when it isn't coming. */
export function CardNone({ name, onRetry, why }: { name: string; onRetry?: () => void; why?: string }) {
  return (
    <span className="cimg blank">
      <NoPicture name={name} onRetry={onRetry} why={why} />
    </span>
  );
}
