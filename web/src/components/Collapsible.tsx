// The deck editor's sections fold away: a click on a heading hides the section's body and keeps
// the heading (and its count). Which ones are folded is remembered on this device for every deck.
import { useSyncExternalStore, type HTMLAttributes, type ReactNode } from "react";

const KEY = "cq.deck.collapsed.v1";
const listeners = new Set<() => void>();
let folded: ReadonlySet<string> = load();

function load(): ReadonlySet<string> {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Whether the section `id` is folded, and a function that flips it. */
export function useCollapsed(id: string): [boolean, () => void] {
  const set = useSyncExternalStore(subscribe, () => folded);
  const toggle = () => {
    const next = new Set(folded);
    if (!next.delete(id)) next.add(id);
    folded = next;
    try {
      localStorage.setItem(KEY, JSON.stringify([...next]));
    } catch {
      // Private windows: it still folds, just isn't remembered.
    }
    listeners.forEach((fn) => fn());
  };
  return [set.has(id), toggle];
}

/** A heading that folds its section: ▾ open, ▸ folded. */
export function FoldHeading({ closed, onToggle, children }: { closed: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <h2>
      <button type="button" className="fold-toggle" aria-expanded={!closed} title={closed ? "Show this section" : "Hide this section"} onClick={onToggle}>
        <span className="fold-caret" aria-hidden="true">{closed ? "▸" : "▾"}</span>
        {children}
      </button>
    </h2>
  );
}

type Props = { id: string; className?: string; title: ReactNode; children: ReactNode } & Omit<HTMLAttributes<HTMLElement>, "title" | "id">;

/** A `.board` section of the deck editor whose heading folds it. */
export function FoldSection({ id, className, title, children, ...rest }: Props) {
  const [closed, toggle] = useCollapsed(id);
  return (
    <section {...rest} className={`board${className ? ` ${className}` : ""}${closed ? " folded" : ""}`}>
      <FoldHeading closed={closed} onToggle={toggle}>{title}</FoldHeading>
      {!closed && children}
    </section>
  );
}
