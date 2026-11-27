/** The Decks page's tabs: your decks, your packages, and everyone's shared decks. */
export function DeckTabs({ current }: { current: "decks" | "packages" | "browse" }) {
  const tab = (id: "decks" | "packages" | "browse", href: string, label: string) => (
    <a href={href} className={`page-tab${current === id ? " active" : ""}`} aria-current={current === id ? "page" : undefined}>{label}</a>
  );
  return (
    <nav className="page-tabs" aria-label="Decks, packages and shared decks">
      {tab("decks", "#/decks", "Decks")}
      {tab("packages", "#/decks/packages", "Packages")}
      {tab("browse", "#/decks/browse", "Browse")}
    </nav>
  );
}
