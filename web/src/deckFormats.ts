/** The formats a deck can be, in the order the format pickers list them. */
export const FORMATS = ["commander", "conquest", "standard", "pioneer", "modern", "legacy", "vintage", "pauper", "other", "cardlist"];

/** A plain list of cards: any cards, any number, no deck rules, and not for games. */
export const CARD_LIST = "cardlist";
/** What the editor calls a package (convex/packages.ts). Not a format a deck can have. */
export const PACKAGE = "package";
/** Not decks: no commander, size, color or legality checks, and one list of cards. */
export const isPlainList = (format: string) => format === CARD_LIST || format === PACKAGE;

export const formatLabel = (format: string) => (format === CARD_LIST ? "Card list" : format.charAt(0).toUpperCase() + format.slice(1));

/** Formats where a deck is led by a commander. */
export const hasCommander = (format: string) => format === "commander" || format === "conquest";
