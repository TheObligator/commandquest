import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { CrashScreen } from "./app/CrashScreen";
import { openedLink } from "./app/handoff";
import "./style.css";
import "./loading.css";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);

createRoot(document.getElementById("app")!).render(
  <StrictMode>
    <CrashScreen>
      {/* Our sign-in links are handled by pages/SignInLink (app/handoff.ts), not by Convex Auth itself. */}
      <ConvexAuthProvider client={convex} shouldHandleCode={() => !openedLink}>
        <App />
      </ConvexAuthProvider>
    </CrashScreen>
  </StrictMode>,
);
