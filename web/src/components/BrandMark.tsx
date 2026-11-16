/** The CommandQuest mark (a hand of cards with the commander's crown), as in favicon.svg but without its background tile. */
export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="8 8 48 48" aria-hidden="true">
      <g stroke="var(--bg)" strokeWidth="2.5" strokeLinejoin="round">
        <rect x="22" y="14" width="22" height="32" rx="3.5" fill="#8a6a35" transform="rotate(-20 33 52)" />
        <rect x="22" y="14" width="22" height="32" rx="3.5" fill="#b98a42" transform="rotate(20 33 52)" />
        <rect x="21" y="12" width="22" height="34" rx="3.5" fill="var(--accent)" />
      </g>
      <path d="M25.5 33V24.5l3.6 3 2.9-5.5 2.9 5.5 3.6-3V33z" fill="var(--bg)" stroke="var(--bg)" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}
