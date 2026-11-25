/** The Decks page's tabs: your decks, and your packages. */
export function DeckTabs({ current }: { current: "decks" | "packages" }) {
  const tab = (id: "decks" | "packages", href: string, label: string) => (
    <a href={href} className={`page-tab${current === id ? " active" : ""}`} aria-current={current === id ? "page" : undefined}>{label}</a>
  );
  return (
    <nav className="page-tabs" aria-label="Decks and packages">
      {tab("decks", "#/decks", "Decks")}
      {tab("packages", "#/decks/packages", "Packages")}
    </nav>
  );
}
