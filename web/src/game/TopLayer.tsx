// Modal dialogs (the graveyard viewer, card details…) sit on the browser's top layer, above every
// z-index, and make the rest of the page inert. A popup that has to show and work while one is open
// (the hover zoom, paying mana, a card's menu) renders inside the topmost open modal dialog instead.
import { type ReactNode, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

const isModal = (d: HTMLDialogElement) => {
  try {
    return d.matches(":modal");
  } catch {
    return true; // a browser without :modal: dialogs here are all opened with showModal()
  }
};

/** The topmost open modal dialog (the last one in the page), or the page's body. */
export function topLayerHost(): HTMLElement {
  return [...document.querySelectorAll<HTMLDialogElement>("dialog[open]")].filter(isModal).at(-1) ?? document.body;
}

// One observer for every popup, while any is shown.
const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;
let current: HTMLElement | null = null;

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  if (!observer) {
    current = topLayerHost();
    observer = new MutationObserver(() => {
      const next = topLayerHost();
      if (next === current) return;
      current = next;
      for (const l of listeners) l();
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
  }
  return () => {
    listeners.delete(onChange);
    if (!listeners.size) {
      observer?.disconnect();
      observer = null;
    }
  };
}

/** `topLayerHost()`, updated whenever a dialog opens or closes. */
export function useTopLayerHost(): HTMLElement {
  return useSyncExternalStore(subscribe, () => (observer ? current! : topLayerHost()));
}

/** Renders `children` where they show above any open modal dialog. */
export function TopLayer({ children }: { children: ReactNode }) {
  return createPortal(children, useTopLayerHost());
}
