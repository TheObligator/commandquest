import { useConvexAuth } from "convex/react";
import { useEffect } from "react";
import { DeckList } from "../pages/DeckList";
import { Editor } from "../pages/Editor";
import { Landing } from "../pages/Landing";
import { Play } from "../pages/Play";
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

  // After a magic link or OAuth round trip, go back to where sign-in started.
  useEffect(() => {
    if (!isAuthenticated) return;
    const next = takeNextPath();
    if (next) navigate(next, true);
  }, [isAuthenticated]);

  let page: React.ReactNode;
  let params: Record<string, string> | null;
  if (route.path === "/") page = <Landing />;
  else if (route.path === "/signin") page = <SignIn />;
  else if (route.path === "/play") page = <Play />;
  else if (route.path === "/table") page = <Table />;
  else if (route.path === "/game") page = <RequireAuth><LiveGame /></RequireAuth>;
  else if (route.path === "/decks") page = <RequireAuth><DeckList /></RequireAuth>;
  else if (route.path === "/decks/new") page = <RequireAuth><Editor key="new" /></RequireAuth>;
  else if ((params = match("/decks/:id", route.path))) page = <RequireAuth><Editor key={params.id} id={params.id} /></RequireAuth>;
  else page = <p className="empty">Page not found.</p>;

  return <Layout full={route.path === "/table" || route.path === "/game"}>{page}</Layout>;
}
