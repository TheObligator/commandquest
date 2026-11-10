// Tiny DOM helpers so views can be written without a framework.

type Child = Node | string | number | false | null | undefined | Child[];
type Attrs = Record<string, unknown>;

/**
 * h("div", { class: "x", onclick: fn }, "text", child)
 * Attributes starting with "on" become event listeners; `false`/`null` attributes are skipped.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === false || value === null || value === undefined) continue;
      if (key.startsWith("on") && typeof value === "function") {
        el.addEventListener(key.slice(2), value as EventListener);
      } else if (key === "value" && "value" in el) {
        (el as HTMLInputElement).value = String(value);
      } else if (key === "checked" || key === "selected" || key === "disabled") {
        (el as unknown as Record<string, boolean>)[key] = Boolean(value);
      } else {
        el.setAttribute(key, value === true ? "" : String(value));
      }
    }
  }
  append(el, children);
  return el;
}

export function append(parent: Node, children: Child[]) {
  for (const c of children) {
    if (c === false || c === null || c === undefined) continue;
    if (Array.isArray(c)) append(parent, c);
    else parent.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
}

export function clear(el: Element) {
  el.replaceChildren();
}

function symbol(sym: string): HTMLImageElement {
  const file = sym.replace(/\//g, "");
  return h("img", { class: "sym", src: `https://svgs.scryfall.io/card-symbols/${encodeURIComponent(file)}.svg`, alt: `{${sym}}`, title: `{${sym}}` });
}

/** Mana cost text like "{2}{W/U}" as Scryfall's symbol images. */
export function manaCost(cost: string | undefined): HTMLElement {
  const span = h("span", { class: "mana" });
  if (!cost) return span;
  for (const m of cost.matchAll(/\{([^}]+)\}|( \/\/ )/g)) {
    span.append(m[2] ? " // " : symbol(m[1]));
  }
  return span;
}

/** Text with {T}, {G} and so on replaced by symbols. */
function withSymbols(text: string): Node[] {
  return text.split(/(\{[^}]+\})/).filter(Boolean).map((part) =>
    /^\{[^}]+\}$/.test(part) ? symbol(part.slice(1, -1)) : document.createTextNode(part));
}

/** Rules text: symbols as images, one paragraph per line, reminder text in italics. */
export function rulesText(text: string | undefined): HTMLElement {
  const box = h("div", { class: "rules" });
  for (const line of (text ?? "").split("\n")) {
    const p = h("p");
    for (const part of line.split(/(\([^)]*\))/)) {
      if (!part) continue;
      if (/^\(.*\)$/.test(part)) p.append(h("i", null, ...withSymbols(part)));
      else p.append(...withSymbols(part));
    }
    box.append(p);
  }
  return box;
}

let toastTimer: number | undefined;
export function toast(message: string, kind: "info" | "error" = "info") {
  let el = document.querySelector<HTMLDivElement>("#toast");
  if (!el) {
    el = h("div", { id: "toast", role: "status" });
    document.body.append(el);
  }
  el.textContent = message;
  el.dataset.kind = kind;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el!.classList.remove("show"), kind === "error" ? 6000 : 2500);
}
