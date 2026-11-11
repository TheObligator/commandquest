import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { linkFromElsewhere } from "./app/handoff";
import "./style.css";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);

createRoot(document.getElementById("app")!).render(
  <StrictMode>
    {/* A sign-in link asked for on another device: let the page ask where to sign in (app/handoff.ts). */}
    <ConvexAuthProvider client={convex} shouldHandleCode={() => !linkFromElsewhere}>
      <App />
    </ConvexAuthProvider>
  </StrictMode>,
);
