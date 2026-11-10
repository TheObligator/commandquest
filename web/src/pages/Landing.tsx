import { useConvexAuth } from "convex/react";

export function Landing() {
  const { isAuthenticated } = useConvexAuth();
  return (
    <>
      <section className="hero">
        <div className="hero-art" aria-hidden="true" />
        <div className="hero-body">
          <p className="eyebrow">Four-player Commander in your browser</p>
          <h1>Gather your pod. <span className="accent">Let the rules engine judge.</span></h1>
          <p className="lead">
            CommandQuest runs full games of Magic on the Forge rules engine. You bring the deck, it handles the stack, the triggers and the combat math.
          </p>
          <div className="cta">
            <a href="#/play" className="btn big">Play</a>
            <a href="#/decks" className="btn big ghost">Build a deck</a>
            {!isAuthenticated && <a href="#/signin" className="link">or sign in with email, Google or Discord →</a>}
          </div>
        </div>
      </section>
      <section className="features">
        <Feature icon="⚔" title="Play" href="#/play" text="Commander pods of up to four, against friends or AI opponents. Coming soon." />
        <Feature icon="🗂" title="Deck builder" href="#/decks" text="Search every card on Scryfall, sort by type, check your curve and color identity." />
        <Feature icon="⇩" title="Import anywhere" href="#/decks/new?import=1" text="Paste a Moxfield or Archidekt link, a text export, or upload a .txt file." />
        <Feature icon="☁" title="Saved to your account" href={isAuthenticated ? "#/decks" : "#/signin"} text="Your decks follow you to any device once you sign in." />
      </section>
    </>
  );
}

function Feature({ icon, title, text, href }: { icon: string; title: string; text: string; href: string }) {
  return (
    <a className="feature" href={href}>
      <span className="feature-icon" aria-hidden="true">{icon}</span>
      <h3>{title}</h3>
      <p>{text}</p>
    </a>
  );
}
