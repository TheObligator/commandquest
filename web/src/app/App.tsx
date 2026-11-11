import { useConvexAuth } from "convex/react";
import { useEffect, useState } from "react";
import { clearPending, linkFromElsewhere, openedLink, tidyUrl } from "./handoff";
import { SignInHere } from "../pages/SignInHere";
import { DeckList } from "../pages/DeckList";
import { Editor } from "../pages/Editor";
import { Landing } from "../pages/Landing";
import { Play } from "../pages/Play";
import { Settings } from "../pages/Settings";
import { HotkeysSync } from "../game/useHotkeys";
import { SignIn, takeNextPath } from "../pages/SignIn";
import { LiveGame } from "../pages/LiveGame";
import { Table } from "../pages/Table";
import { Loading } from "../components/Spinner";
import { Layout } from "./Layout";
import { match, navigate, useRoute } from "./router";

/** Pages that need an account send signed-out visitors to sign in, then back. */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const route = useRoute();
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      const here = route.path + (route.query.toString() ? "?" + route.query : "");
      navigate("/signin?next=" + encodeURIComponent(here), true);
    }
  }, [isLoading, isAuthenticated, route]);
  if (isLoading || !isAuthenticated) return <Loading />;
  return <>{children}</>;
}

export function App() {
  const route = useRoute();
  const { isAuthenticated } = useConvexAuth();
  const [foreignLink, setForeignLink] = useState(linkFromElsewhere ? openedLink : null);

  // A sign-in link's `pair` stays in the address bar after Convex Auth takes the code: tidy it.
  useEffect(() => {
    if (!foreignLink) tidyUrl();
  }, [foreignLink]);
  useEffect(() => {
    if (isAuthenticated) clearPending();
  }, [isAuthenticated]);

  // After a magic link or OAuth round trip, go back to where sign-in started.
  useEffect(() => {
    if (!isAuthenticated) return;
    const next = takeNextPath();
    if (next) navigate(next, true);
  }, [isAuthenticated]);

  let page: React.ReactNode;
  let params: Record<string, string> | null;
  if (foreignLink) page = <SignInHere link={foreignLink} onDone={() => (tidyUrl(true), setForeignLink(null))} />;
  else if (route.path === "/") page = <Landing />;
  else if (route.path === "/signin") page = <SignIn />;
  else if (route.path === "/play") page = <Play />;
  else if (route.path === "/table") page = <Table />;
  else if (route.path === "/settings") page = <Settings />;
  else if (route.path === "/game") page = <RequireAuth><LiveGame /></RequireAuth>;
  else if (route.path === "/decks") page = <RequireAuth><DeckList /></RequireAuth>;
  else if (route.path === "/decks/new") page = <RequireAuth><Editor key="new" /></RequireAuth>;
  else if ((params = match("/decks/:id", route.path))) page = <RequireAuth><Editor key={params.id} id={params.id} /></RequireAuth>;
  else page = <p className="empty">Page not found.</p>;

  return (
    <Layout full={route.path === "/table" || route.path === "/game"}>
      <HotkeysSync />
      {page}
    </Layout>
  );
}
