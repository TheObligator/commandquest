// Your settings per triggered ability (auto-yield, always yes / no), as the game server keeps them
// (forge-web-server AbilitySettings) and as a deck saves them (convex decks.abilities).

export type Decision = "ASK" | "ACCEPT" | "DECLINE";

export interface AbilitySetting {
  autoYield: boolean;
  decision: Decision;
}

/** The view's `abilities`: settings by ability text, or by full key for those set for one card only. */
export interface AbilitySettings {
  set: Record<string, AbilitySetting>;
  cardOnly: string[];
}

/** A triggered ability of a card, from `actions` / `details`. */
export interface CardAbility {
  /** Forge's key: "Card (id): text". */
  key: string;
  text: string;
  /** It can ask you a "you may". */
  mayAsk?: boolean;
  /** From a card you own (not a token): its setting can be saved with your deck. */
  mine?: boolean;
}

/** A setting saved with a deck, for every copy of the ability. */
export interface SavedAbility {
  card: string;
  text: string;
  autoYield?: boolean;
  decision?: "ACCEPT" | "DECLINE";
}

const NONE: AbilitySetting = { autoYield: false, decision: "ASK" };

/** The ability without its card, as Forge has it (AutoYieldStore.abilitySuffix). */
export function abilityText(key: string): string {
  const at = key.indexOf("): ");
  return at < 0 ? key : key.slice(at + 3);
}

export function isEveryCopy(s: AbilitySettings | undefined, key: string): boolean {
  return !s?.cardOnly.includes(key);
}

export function settingFor(s: AbilitySettings | undefined, key: string): AbilitySetting {
  return s?.set[isEveryCopy(s, key) ? abilityText(key) : key] ?? NONE;
}

export const isSet = (s: { autoYield?: boolean; decision?: Decision }) => !!s.autoYield || (!!s.decision && s.decision !== "ASK");

/** A short name for an ability: its ability word or keyword, else how it starts. */
export function abilityName(text: string): string {
  const line = text.split("\n")[0].trim();
  const word = /^([^.,:()]{1,40}?) — /.exec(line);
  if (word) return word[1];
  const keyword = /^([^.,:()]{1,40}?) \(/.exec(line);
  if (keyword) return keyword[1];
  const clause = line.split(",")[0];
  return clause.length <= 46 ? clause.replace(/\.$/, "") : `${clause.slice(0, 44).trimEnd()}…`;
}

/** The deck's saved settings with this one put in (or taken out, when nothing is set). Oldest first. */
export function withSaved(list: SavedAbility[], card: string, text: string, setting: AbilitySetting): SavedAbility[] {
  const rest = list.filter((a) => a.text !== text);
  if (!isSet(setting)) return rest;
  const entry: SavedAbility = { card, text };
  if (setting.autoYield) entry.autoYield = true;
  if (setting.decision !== "ASK") entry.decision = setting.decision;
  const at = list.findIndex((a) => a.text === text);
  return at < 0 ? [...rest, entry] : [...rest.slice(0, at), entry, ...rest.slice(at)];
}
