// Keyword icons from the Mana font (mana-font, "ms-ability-*"), for keywords a permanent has gained.
// Pure logic (no DOM), so node --test can run it.

/** Keywords the font has an icon for, by its class name (ms-ability-<slug>). */
const ICONS = new Set("adamant adapt addendum adventure afflict afterlife aftermath alliance amass amass-orcs amass-zombies annihilator ascend backup bargain battle-cry blitz boast case-solved casualty celebration changeling channel cleave cloak cohort collect-evidence companion constellation convoke corrupted coven craft crew crime cycling daybound-nightbound deathtouch decayed defender delirium delve descend detain devotion discover disguise disturb domain double-strike eerie embalm enlist enrage escape eternalize evolve exalted expend exploit explore fabricate fading fear ferocious finality first-strike flash flying for-mirrodin forage forestwalk foretell gift goad haste haunt hexproof hexproof-black hexproof-blue hexproof-green hexproof-red hexproof-white hideaway impending improvise incubate indestructible infect ingest intimidate investigate islandwalk jumpstart kicker landfall learn lifelink magecraft manifest-dread meld menace mentor monstrous morph mountainwalk mutate ninjutsu obscura offspring outlast phyrexian plainswalk plot proliferate protection protection-black protection-blue protection-green protection-red protection-white prototype prowess raid rally reach read-ahead reconfigure regenerate renowned revolt riot saddle shroud skulk soulshift specialize spectacle spree surveil survival suspect swampwalk totem-armor toxic training trample transform unblockable undergrowth undying unearth valiant vigilance ward".split(" "));

const COLORS = ["white", "blue", "black", "red", "green"];
const LANDS = ["plains", "island", "swamp", "mountain", "forest"];

/**
 * The Mana font class for a keyword (Forge's keyword name, "First Strike", and its full text,
 * "Protection from red"), or undefined when the font has none.
 */
export function keywordIcon(keyword: string | undefined, text: string): string | undefined {
  if (!keyword) return undefined;
  const t = text.toLowerCase().trim();
  const slug = keyword.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  let name = slug;
  if (slug === "protection" || slug === "hexproof") {
    // One color: its own icon ("Protection from red"); anything else gets the plain one.
    const from = /\bfrom (\w+)$/.exec(t)?.[1];
    if (from && COLORS.includes(from)) name = `${slug}-${from}`;
  } else if (slug === "landwalk") {
    const land = LANDS.find((l) => t.startsWith(`${l}walk`));
    if (!land) return undefined;
    name = `${land}walk`;
  } else if (slug === "daybound" || slug === "nightbound") {
    name = "daybound-nightbound";
  }
  return ICONS.has(name) ? `ms ms-ability-${name}` : undefined;
}

/** Something a permanent gained in this game that isn't printed on it (from the server's `gained`). */
export interface Gained {
  /** The keyword ("Protection from red") or the ability's text. */
  text: string;
  /** For a keyword: Forge's keyword name ("Protection"). */
  keyword?: string;
  /** For a keyword: what it does. */
  reminder?: string;
  /** The card that gave it, when known. */
  source?: string;
}

/**
 * Forge's card text without what was gained (it's shown on its own): whole lines that are a gained
 * ability, and gained keywords out of a keyword line ("Flying, Haste" without Haste → "Flying").
 */
export function withoutGained(text: string, gained: readonly Gained[] | undefined): string {
  if (!gained?.length) return text;
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const abilities = new Set(gained.filter((g) => !g.keyword).flatMap((g) => g.text.split("\n")).map(norm));
  const keywords = new Set(gained.filter((g) => g.keyword).map((g) => norm(g.text)));
  const out: string[] = [];
  for (const line of text.replace(/\r/g, "").split("\n")) {
    if (abilities.has(norm(line))) continue;
    const parts = line.split(/,\s*/);
    const kept = parts.filter((p) => !keywords.has(norm(p)));
    if (kept.length < parts.length) {
      if (kept.some((p) => p.trim())) out.push(kept.join(", "));
      continue;
    }
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
