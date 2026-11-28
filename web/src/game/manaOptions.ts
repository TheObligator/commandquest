// Choosing what mana an ability makes (a filter land's {W}{W}, {W}{U} or {U}{U}; "one mana of any
// color"): the choices as buttons by the card being tapped (ManaChoice.tsx). No React here, so
// `npm test` covers it.

/** One way to answer: the mana it makes, as symbols ("{W}{U}"), and the answer to send. */
export interface ManaChoiceOption {
  /** The mana as symbols; empty when the option is an ability's text (`label`). */
  cost: string;
  /** Without `cost`: what the button says (an ability we can't show as mana, a filter land's). */
  label?: string;
  /** What it costs you besides tapping ("1 damage to you"). */
  note?: string;
  /** distribute: how much of each option; choose: the option's index. */
  answer: number[];
}

/** What the server sends about one option (AskOption's mana fields). */
export interface ManaOptionLike {
  mana?: string;
  max?: number;
  /** Several symbols at once ("{C}{C}"), when the server spells them out. */
  cost?: string;
  label?: string;
  note?: string;
}

const COLOR_NAMES: Record<string, string> = { White: "W", Blue: "U", Black: "B", Red: "R", Green: "G", Colorless: "C" };

/** A color's name ("White") as its mana symbol letter, or undefined. */
export const colorLetter = (name: string | undefined) => (name ? COLOR_NAMES[name.trim()] : undefined);

/** More than this many combinations: the − / + panel in the rail is easier. */
export const MAX_COMBOS = 12;

/**
 * Every way to make `amount` mana from these colors (each at most its `max`), as counts per
 * option, in order: {W}{W}, {W}{U}, {U}{U}. Null when there are more than MAX_COMBOS of them.
 */
export function combos(options: ManaOptionLike[], amount: number): ManaChoiceOption[] | null {
  if (!options.length || amount <= 0) return null;
  const out: ManaChoiceOption[] = [];
  const counts = options.map(() => 0);
  const most = (i: number) => Math.min(amount, options[i].max ?? amount);
  // false: too many, stop
  const go = (i: number, left: number): boolean => {
    if (i === options.length - 1) {
      if (left > most(i)) return true; // the last color can't take the rest
      counts[i] = left;
      if (out.length >= MAX_COMBOS) return false;
      out.push({ answer: [...counts], cost: options.map((o, k) => `{${o.mana}}`.repeat(counts[k])).join("") });
      return true;
    }
    for (let n = Math.min(left, most(i)); n >= 0; n--) {
      counts[i] = n;
      if (!go(i + 1, left - n)) return false;
    }
    return true;
  };
  return go(0, amount) ? out : null;
}

/** One mana of one of these colors: a button each. */
export function singles(options: ManaOptionLike[]): ManaChoiceOption[] {
  return options.map((o, i) => {
    const cost = o.cost ?? (o.mana ? `{${o.mana}}` : "");
    return { cost, answer: [i], ...(cost ? {} : { label: o.label ?? "?" }), ...(o.note ? { note: o.note } : {}) };
  });
}

/** The bits of a question or prompt this looks at (LiveAsk, LivePrompt). */
interface AskLike {
  id: number;
  kind: string;
  mana?: boolean;
  message: string;
  options?: (ManaOptionLike & { label: string })[];
  amount?: number;
  min: number;
  max: number;
  card?: { id: number; name?: string };
}
interface PromptLike {
  message: string;
  ok: { label?: string | null };
  cancel: { label?: string | null };
  pay?: unknown;
}

/** A mana choice to ask by the card: answer an `ask` (by id), or press the prompt's OK (0) or Cancel (1). */
export interface ManaChoiceView {
  via: "ask" | "prompt";
  askId?: number;
  title: string;
  cardId?: number;
  choices: ManaChoiceOption[];
  /** The question may be left unanswered (choose none). */
  cancellable: boolean;
}

/** Is the game asking what mana to make? Then how to ask it by the card; else null (the rail asks). */
export function manaChoiceFor(ask: AskLike | null | undefined, prompt: PromptLike | null | undefined): ManaChoiceView | null {
  if (ask) {
    if (!ask.mana || !ask.options?.length) return null;
    const name = ask.card?.name;
    const title = name ? `${name}: which mana?` : "Which mana?";
    if (ask.kind === "distribute") {
      const choices = combos(ask.options, ask.amount ?? 0);
      return choices ? { via: "ask", askId: ask.id, title, cardId: ask.card?.id, choices, cancellable: false } : null;
    }
    if (ask.kind === "choose" && ask.max === 1) {
      return { via: "ask", askId: ask.id, title, cardId: ask.card?.id, choices: singles(ask.options), cancellable: ask.min === 0 };
    }
    return null;
  }
  // Forge asks "this color or that one?" with two buttons named for the colors.
  const a = colorLetter(prompt?.ok.label ?? undefined);
  const b = colorLetter(prompt?.cancel.label ?? undefined);
  if (!prompt || prompt.pay || !a || !b) return null;
  return {
    via: "prompt",
    title: prompt.message.split("\n")[0] || "Which mana?",
    choices: [{ cost: `{${a}}`, answer: [0] }, { cost: `{${b}}`, answer: [1] }],
    cancellable: false,
  };
}
