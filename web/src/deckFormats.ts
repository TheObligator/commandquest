/** The formats a deck can be, in the order the format pickers list them. */
export const FORMATS = ["commander", "conquest", "standard", "pioneer", "modern", "legacy", "vintage", "pauper", "other"];

/** Formats where a deck is led by a commander. */
export const hasCommander = (format: string) => format === "commander" || format === "conquest";
