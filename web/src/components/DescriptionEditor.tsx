// The rich text box for a deck's description (Tiptap). Loaded only when someone edits one
// (DeckDescription.tsx), so the editor's code isn't in the page until then.
//
// Bold, italic, strike, two heading levels, lists, links, and card names: type [[ and pick a name.
// What it makes is what convex/model/richText.ts keeps; anything else is turned off here.
import Mention from "@tiptap/extension-mention";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { SuggestionKeyDownProps, SuggestionProps } from "@tiptap/suggestion";
import { useEffect, useRef, useState } from "react";
import { cleanHref, descriptionLength, MAX_DESCRIPTION_TEXT, parseDescription } from "../../convex/model/richText";
import { localNames, startLocalSearch } from "../localsearch";
import * as scry from "../scryfall";

/** Up to 8 card names for what's typed after [[: from the local list, else Scryfall. */
async function cardNames(query: string): Promise<string[]> {
  const q = query.replace(/\]+$/, "").trim();
  if (q.length < 2) return [];
  try {
    const r = await localNames(q);
    if (r?.names.length) return r.names.slice(0, 8);
  } catch {
    // Ask Scryfall instead.
  }
  try {
    return (await scry.autocomplete(q)).slice(0, 8);
  } catch {
    return [];
  }
}

type Picker = { names: string[]; active: number; rect: DOMRect | null; pick: (name: string) => void };

/** `value`: the description as stored (Tiptap JSON). `onChange` gets the new one, or undefined once it's empty. */
export default function DescriptionEditor({ value, onChange, onDone }: { value: string | undefined; onChange: (json: string | undefined) => void; onDone: () => void }) {
  const [picker, setPicker] = useState<Picker | null>(null);
  const pickerRef = useRef(picker);
  pickerRef.current = picker;
  const [length, setLength] = useState(() => descriptionLength(value));
  const [linking, setLinking] = useState<string | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => startLocalSearch(), []);

  const editor = useEditor({
    autofocus: "end",
    content: safeDoc(value),
    editorProps: { attributes: { class: "rich-text description-input", "aria-label": "Deck description", "aria-multiline": "true", role: "textbox" } },
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        blockquote: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        underline: false,
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: "https",
          protocols: [],
          isAllowedUri: (url) => cleanHref(url) !== undefined,
          HTMLAttributes: { target: "_blank", rel: "noopener noreferrer nofollow ugc" },
        },
      }),
      Mention.extend({ name: "card" }).configure({
        HTMLAttributes: { class: "card-ref" },
        renderText: ({ node }) => node.attrs.id ?? "",
        renderHTML: ({ options, node }) => ["span", options.HTMLAttributes, node.attrs.id ?? ""],
        deleteTriggerWithBackspace: true,
        suggestion: {
          char: "[[",
          allowSpaces: true,
          allowedPrefixes: null,
          items: ({ query }) => cardNames(query),
          render: () => {
            const show = (p: SuggestionProps<string, { id: string }>) =>
              setPicker((old) => ({ names: p.items, active: old && old.names.length === p.items.length ? Math.min(old.active, p.items.length - 1) : 0, rect: p.clientRect?.() ?? null, pick: (id) => p.command({ id }) }));
            return {
              onStart: show,
              onUpdate: show,
              onExit: () => setPicker(null),
              onKeyDown: ({ event }: SuggestionKeyDownProps) => {
                const p = pickerRef.current;
                if (event.key === "Escape") {
                  setPicker(null);
                  return true;
                }
                if (!p?.names.length) return false;
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  const step = event.key === "ArrowDown" ? 1 : -1;
                  setPicker({ ...p, active: (p.active + step + p.names.length) % p.names.length });
                  return true;
                }
                if (event.key === "Enter" || event.key === "Tab") {
                  p.pick(p.names[p.active]);
                  return true;
                }
                return false;
              },
            };
          },
        },
      }),
    ],
    onUpdate: ({ editor }) => {
      const json = JSON.stringify(editor.getJSON());
      const n = descriptionLength(json);
      setLength(n);
      // Too long isn't saved: the last one that fit stays until it's shortened.
      if (n <= MAX_DESCRIPTION_TEXT) onChangeRef.current(n ? json : undefined);
    },
  });

  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      strike: e.isActive("strike"),
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      bullets: e.isActive("bulletList"),
      numbers: e.isActive("orderedList"),
      link: e.isActive("link"),
    }),
  });

  if (!editor) return null;
  const run = (fn: (e: Editor) => void) => (ev: React.MouseEvent) => {
    ev.preventDefault();
    fn(editor);
  };
  const tool = (label: string, title: string, on: boolean, fn: (e: Editor) => void, cls = "") => (
    <button type="button" className={`rt-tool${on ? " on" : ""}${cls ? ` ${cls}` : ""}`} aria-pressed={on} title={title} onMouseDown={run(fn)}>
      {label}
    </button>
  );

  function applyLink(text: string) {
    const href = text.trim() ? cleanHref(text) : undefined;
    if (text.trim() && !href) return;
    const chain = editor!.chain().focus().extendMarkRange("link");
    if (!href) chain.unsetLink().run();
    else if (editor!.state.selection.empty && !editor!.isActive("link")) chain.insertContent({ type: "text", text: text.trim(), marks: [{ type: "link", attrs: { href } }] }).run();
    else chain.setLink({ href }).run();
    setLinking(null);
  }

  const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";
  const over = length > MAX_DESCRIPTION_TEXT;
  return (
    <div className="description-editor">
      <div className="rt-toolbar" role="toolbar" aria-label="Formatting">
        {tool("B", `Bold (${mod}B)`, !!active?.bold, (e) => e.chain().focus().toggleBold().run(), "b")}
        {tool("I", `Italic (${mod}I)`, !!active?.italic, (e) => e.chain().focus().toggleItalic().run(), "i")}
        {tool("S", `Strikethrough (${mod}Shift+S)`, !!active?.strike, (e) => e.chain().focus().toggleStrike().run(), "s")}
        <span className="rt-sep" />
        {tool("H", "Heading", !!active?.h2, (e) => e.chain().focus().toggleHeading({ level: 2 }).run())}
        {tool("h", "Subheading", !!active?.h3, (e) => e.chain().focus().toggleHeading({ level: 3 }).run())}
        {tool("•", "Bulleted list", !!active?.bullets, (e) => e.chain().focus().toggleBulletList().run())}
        {tool("1.", "Numbered list", !!active?.numbers, (e) => e.chain().focus().toggleOrderedList().run())}
        <span className="rt-sep" />
        {tool("Link", "Link", !!active?.link || linking !== null, (e) => setLinking(e.getAttributes("link").href ?? ""))}
        {tool("[[ Card", "Name a card: shows its image on hover", false, (e) => e.chain().focus().insertContent("[[").run())}
        <span className="spacer" />
        <button type="button" className="btn small" onClick={onDone}>Done</button>
      </div>
      {linking !== null && (
        <form className="rt-link" onSubmit={(e) => (e.preventDefault(), applyLink(linking))}>
          <input autoFocus value={linking} placeholder="https://…" aria-label="Link address" onChange={(e) => setLinking(e.target.value)} onKeyDown={(e) => e.key === "Escape" && (e.preventDefault(), setLinking(null), editor.commands.focus())} />
          <button type="submit" className="btn small" disabled={!!linking.trim() && !cleanHref(linking)}>{linking.trim() ? "Set link" : "Remove link"}</button>
          <button type="button" className="btn ghost small" onClick={() => (setLinking(null), editor.commands.focus())}>Cancel</button>
        </form>
      )}
      <EditorContent editor={editor} />
      <div className="rt-foot small">
        <span className="muted">Type <kbd>[[</kbd> to name a card.</span>
        <span className={over ? "error" : "muted"}>{over ? `Too long to save: ${length} / ${MAX_DESCRIPTION_TEXT}` : `${length} / ${MAX_DESCRIPTION_TEXT}`}</span>
      </div>
      {picker && picker.rect && (
        <ul className="rt-picker" role="listbox" style={{ left: picker.rect.left, top: picker.rect.bottom + 4 }}>
          {picker.names.length ? (
            picker.names.map((n, i) => (
              <li key={n} role="option" aria-selected={i === picker.active} className={i === picker.active ? "active" : ""} onMouseDown={(e) => (e.preventDefault(), picker.pick(n))} onMouseEnter={() => setPicker({ ...picker, active: i })}>
                {n}
              </li>
            ))
          ) : (
            <li className="muted">Type a card name…</li>
          )}
        </ul>
      )}
    </div>
  );
}

/** The stored description to start from; an unreadable one starts empty rather than breaking the editor. */
function safeDoc(value: string | undefined) {
  try {
    return parseDescription(value) ?? "";
  } catch {
    return "";
  }
}
