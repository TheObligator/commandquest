// Small icons for card types (deck bar, mana curve breakdown). Drawn here, in the current text color.

const PATHS: Record<string, React.ReactNode> = {
  // Three claw marks.
  Creature: (
    <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <path d="M4 13 9 3" />
      <path d="M7.5 14 12.5 4" />
      <path d="M11 14.5 14 8.5" />
    </g>
  ),
  // A spark.
  Planeswalker: <path fill="currentColor" d="M8 1 9.6 6.4 15 8l-5.4 1.6L8 15l-1.6-5.4L1 8l5.4-1.6Z" />,
  // Crossed swords.
  Battle: (
    <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M2.5 2.5 12 12M10 14l4-4" />
      <path d="M13.5 2.5 4 12M6 14l-4-4" />
    </g>
  ),
  // A lightning bolt.
  Instant: <path fill="currentColor" d="M9.5 1 3 9h4l-1.5 6L13 7H9l.5-6Z" />,
  // A flame.
  Sorcery: <path fill="currentColor" d="M8 1c.5 2.6 4.5 4.4 4.5 8.4A4.5 4.5 0 0 1 3.5 9.6C3.5 7.3 5 6 5.6 4.6 6.4 6 6.8 7 7.6 7.4 8.4 5.4 8 3.2 8 1Z" />,
  // A chalice.
  Artifact: <path fill="currentColor" d="M3 2h10c0 3.6-1.7 5.6-4 6.1V12h2.5v2h-7v-2H7V8.1C4.7 7.6 3 5.6 3 2Z" />,
  // A starburst.
  Enchantment: (
    <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M8 1.5v4M8 10.5v4M1.5 8h4M10.5 8h4M3.4 3.4l2.4 2.4M10.2 10.2l2.4 2.4M3.4 12.6l2.4-2.4M10.2 5.8l2.4-2.4" />
    </g>
  ),
  // Mountains.
  Land: <path fill="currentColor" d="M1 14 6 5l2.6 4.4L10.5 7 15 14Z" />,
  // A banner.
  Kindred: <path fill="currentColor" d="M4 1h8v13l-4-3-4 3Z" />,
  Other: <circle cx="8" cy="8" r="4" fill="currentColor" />,
};

export function TypeIcon({ type, className }: { type: string; className?: string }) {
  return (
    <svg className={`type-icon${className ? ` ${className}` : ""}`} viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      {PATHS[type] ?? PATHS.Other}
    </svg>
  );
}
