import { Spinner } from "../components/Spinner";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { navigate, useRoute } from "./router";
import { UpdateNotice } from "./UpdateNotice";
import { CreateMenu } from "../components/CreateMenu";
import { BrandMark } from "../components/BrandMark";
import { CONTACT_EMAIL } from "../pages/Legal";

/** `full`: the page uses the whole window width (the game table). */
export function Layout({ children, full }: { children: React.ReactNode; full?: boolean }) {
  const { path } = useRoute();
  const nav = (to: string, label: string) => (
    <a href={`#${to}`} className={path.startsWith(to) ? "active" : undefined}>{label}</a>
  );
  return (
    <>
      <header className="topbar">
        <a href="#/" className="brand"><BrandMark />CommandQuest</a>
        <nav>
          {nav("/play", "Play")}
          {nav("/decks", "Decks")}
          {nav("/replays", "Replays")}
          {nav("/settings", "Settings")}
        </nav>
        <Account create={!full} />
      </header>
      <main id="view" className={full ? "full" : undefined}>
        {!full && path !== "/settings" && <UsernamePrompt />}
        {children}
      </main>
      <footer className="footer">
        <nav className="footer-links" aria-label="About this site">
          <a href="#/about">About</a>
          <a href="#/privacy">Privacy</a>
          <a href="#/terms">Terms</a>
          <a href={`mailto:${CONTACT_EMAIL}`}>Contact</a>
        </nav>
        Rules engine by <a href="https://github.com/Card-Forge/forge" target="_blank" rel="noopener">Forge</a>. Card data and images from{" "}
        <a href="https://scryfall.com" target="_blank" rel="noopener">Scryfall</a> (not endorsed by Scryfall).
        <br />
        CommandQuest is unofficial Fan Content permitted under the{" "}
        <a href="https://company.wizards.com/en/legal/fancontentpolicy" target="_blank" rel="noopener">Fan Content Policy</a>. Not
        approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.
      </footer>
      <UpdateNotice />
    </>
  );
}

/** `create`: show the Create menu (not over a game). */
function Account({ create }: { create: boolean }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const me = useQuery(api.users.me, isAuthenticated ? {} : "skip");
  const { signOut } = useAuthActions();
  if (isLoading) return <div className="account sk-late" role="status" aria-label="Signing you in"><Spinner /></div>;
  if (!isAuthenticated) {
    return (
      <div className="account">
        <a href="#/signin" className="btn small">Sign in</a>
      </div>
    );
  }
  return (
    <div className="account">
      {create && <CreateMenu />}
      {me?.image && <img className="avatar" src={me.image} alt="" />}
      <span className="user">{me === undefined ? <Spinner /> : me?.name ?? ""}</span>
      <button className="btn ghost small" onClick={() => void signOut().then(() => navigate("/"))}>Sign out</button>
    </div>
  );
}

/** A gentle nudge for signed-in players who haven't picked a username (shown in games instead). */
function UsernamePrompt() {
  const { isAuthenticated } = useConvexAuth();
  const me = useQuery(api.users.me, isAuthenticated ? {} : "skip");
  if (!me || me.hasUsername) return null;
  return (
    <p className="username-prompt small">
      Other players see you as “{me.name}”. <a href="#/settings" className="link">Choose a username</a> in Settings.
    </p>
  );
}
