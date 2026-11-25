// The menu that sets a Commander deck's bracket: in the deck editor and the deck list.
import { BRACKETS } from "../brackets";
import { CardMenu } from "./CardMenu";

export function BracketMenu(props: { label: string; className: string; trigger: React.ReactNode; bracket?: number; onBracket: (b: number | undefined) => void }) {
  return (
    <CardMenu
      label={props.label}
      className={props.className}
      trigger={props.trigger}
      sections={[
        {
          title: "This deck's bracket",
          items: BRACKETS.map((b) => ({
            label: `${props.bracket === b.n ? "✓ " : ""}${b.n} · ${b.name}: ${b.short}`,
            onSelect: () => props.onBracket(b.n),
          })),
        },
        ...(props.bracket ? [{ items: [{ label: "Clear", onSelect: () => props.onBracket(undefined) }] }] : []),
      ]}
    />
  );
}
