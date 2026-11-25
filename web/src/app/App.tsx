import { useConvexAuth } from "convex/react";
import { useEffect, useState } from "react";
import { clearPending, openedLink, tidyUrl } from "./handoff";
import { SignInLink } from "../pages/SignInLink";
import { DeckList } from "../pages/DeckList";
import { Editor, PackageEditor } from "../pages/Editor";
import { Landing } from "../pages/Landing";
import { Packages } from "../pages/Packages";
import { Play } from "../pages/Play";
import { Precons } from "../pages/Precons";
import { Settings } from "../pages/Settings";
import { HotkeysSync } from "../game/useHotkeys";
import { PrintingPrefSync } from "../usePrintingPref";
import { SignIn, takeNextPath } from "../pages/SignIn";
import { LiveGame } from "../pages/LiveGame";
import { Replays } from "../pages/Replays";
import { ReplayViewer } from "../pages/ReplayViewer";
import { Table } from "../pages/Table";
import { TableLobby } from "../pages/TableLobby";
import { JoinTable } from "../pages/JoinTable";
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
  const [link, setLink] = useState(openedLink);

  // A sign-in link's `pair` stays in the address bar after Convex Auth takes the code: tidy it.
  useEffect(() => {
    if (!link) tidyUrl();
  }, [link]);
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
  if (link) page = <SignInLink link={link} onDone={() => (tidyUrl(true), setLink(null))} />;
  else if (route.path === "/") page = <Landing />;
  else if (route.path === "/signin") page = <SignIn />;
  else if (route.path === "/play") page = <Play />;
  else if (route.path === "/table") page = <Table />;
  else if (route.path === "/settings") page = <Settings />;
  else if (route.path === "/game") page = <RequireAuth><LiveGame /></RequireAuth>;
  else if (route.path === "/replays") page = <RequireAuth><Replays /></RequireAuth>;
  else if (route.path === "/replay") page = <RequireAuth><ReplayViewer /></RequireAuth>;
  else if ((params = match("/tables/:id", route.path))) page = <RequireAuth><TableLobby key={params.id} id={params.id} /></RequireAuth>;
  else if ((params = match("/join/:code", route.path))) page = <RequireAuth><JoinTable key={params.code} code={params.code} /></RequireAuth>;
  else if (route.path === "/decks") page = <RequireAuth><DeckList /></RequireAuth>;
  else if (route.path === "/decks/precons") page = <RequireAuth><Precons /></RequireAuth>;
  else if (route.path === "/decks/packages") page = <RequireAuth><Packages /></RequireAuth>;
  else if (route.path === "/decks/packages/new") page = <RequireAuth><PackageEditor key="new-package" /></RequireAuth>;
  else if ((params = match("/decks/packages/:id", route.path))) page = <RequireAuth><PackageEditor key={params.id} id={params.id} /></RequireAuth>;
  else if (route.path === "/decks/new") page = <RequireAuth><Editor key="new" /></RequireAuth>;
  else if ((params = match("/decks/:id", route.path))) page = <RequireAuth><Editor key={params.id} id={params.id} /></RequireAuth>;
  else page = <p className="empty">Page not found.</p>;

  return (
    <Layout full={route.path === "/table" || route.path === "/game" || route.path === "/replay"}>
      <HotkeysSync />
      <PrintingPrefSync />
      {page}
    </Layout>
  );
}
