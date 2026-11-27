// Settings (#/settings): your username, deck search additions, default printing and the game hotkeys. Changes apply right away, are kept in this browser, and
// are saved to your account when you're signed in, so they follow you to other devices.
// Signed in, it also has Delete account (convex/account.ts).
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../../convex/_generated/api";
import { confirmsDeletion, DELETE_WORD } from "../../convex/model/account";
import { errorMessage } from "../app/errors";
import { navigate } from "../app/router";
import { closeOnBackdrop } from "../carddetails";
import { BusyLabel, Waiting } from "../components/Spinner";
import { toast } from "../dom";
import { bind, changedKeys, DEFAULT_HOTKEYS, HOTKEY_ACTIONS, keyLabel, keyName, MODIFIER_KEYS, RESERVED_KEYS, type HotkeyAction, type Hotkeys } from "../game/hotkeys";
import { setHotkeys, useHotkeyMap } from "../game/useHotkeys";
import { isPrintingPref, PRINTING_PREFS } from "../printings";
import { MAX_ADDITIONS } from "../searchquery";
import { setPrintingPref, usePrintingPref } from "../usePrintingPref";
import { checkUsername, USERNAME_MAX } from "../username";

export function Settings() {
  const keys = useHotkeyMap();
  const { isAuthenticated } = useConvexAuth();
  const save = useMutation(api.settings.saveHotkeys);
  const [listening, setListening] = useState<HotkeyAction | null>(null);

  async function apply(next: Hotkeys) {
    setHotkeys(next);
    if (!isAuthenticated) return;
    try {
      await save({ hotkeys: changedKeys(next) as Record<string, string> });
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  function assign(action: HotkeyAction, key: string) {
    const { keys: next, unbound } = bind(keys, action, key);
    void apply(next);
    if (unbound) toast(`${keyLabel(key)} was used for “${HOTKEY_ACTIONS.find((a) => a.id === unbound)!.label}”, which now has no key.`);
  }

  // Waiting for a key: the next key press is the new binding (Escape cancels). A modifier counts
  // when it's released without another key.
  useEffect(() => {
    if (!listening) return;
    let modifier: string | null = null;
    const down = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const name = keyName(e.key);
      if (name === "Escape") return setListening(null);
      if (MODIFIER_KEYS.has(name)) {
        modifier = name;
        return;
      }
      modifier = null;
      if (RESERVED_KEYS.has(name)) return toast(`${name} can't be used as a hotkey.`, "error");
      setListening(null);
      assign(listening, name);
    };
    const up = (e: KeyboardEvent) => {
      const name = keyName(e.key);
      if (modifier && name === modifier) {
        setListening(null);
        assign(listening, name);
      }
    };
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening, keys]);

  return (
    <div className="settings">
      <h1>Settings</h1>
      <UsernameSection />
      <SearchAdditionsSection />
      <PrintingSection />
      <section className="card settings-section">
        <h2>Game hotkeys</h2>
        <p className="muted small">
          Click a key, then press the key you want. Escape cancels. A modifier (Shift, Ctrl, Alt) works when you tap it on its own.
          Buttons in games show your keys.{" "}
          {isAuthenticated ? "Saved to your account." : "Kept in this browser. Sign in to keep them on every device."}
        </p>
        <table className="hotkeys">
          <tbody>
            {HOTKEY_ACTIONS.map((a) => (
              <tr key={a.id}>
                <th scope="row">
                  {a.label}
                  <span className="muted small">{a.hint}</span>
                </th>
                <td>
                  <button className={`hotkey${listening === a.id ? " listening" : ""}`} onClick={() => setListening(listening === a.id ? null : a.id)} aria-label={`${a.label}: ${keyLabel(keys[a.id])}. Click to change.`}>
                    {listening === a.id ? "Press a key…" : <kbd>{keyLabel(keys[a.id])}</kbd>}
                  </button>
                </td>
                <td className="hotkey-tools">
                  {keys[a.id] !== a.key && (
                    <button className="btn small ghost" onClick={() => assign(a.id, a.key)} title={`Back to ${keyLabel(a.key)}`}>Default</button>
                  )}
                  {keys[a.id] && (
                    <button className="btn small ghost" onClick={() => void apply({ ...keys, [a.id]: "" })}>Clear</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="btn small" onClick={() => void apply(DEFAULT_HOTKEYS)} disabled={HOTKEY_ACTIONS.every((a) => keys[a.id] === a.key)}>
          Reset all to defaults
        </button>
        <p className="muted small">Escape always closes an enlarged board or dialog.</p>
      </section>
      <DeleteAccountSection />
    </div>
  );
}

/** The name other players see in games. Signed-in only; stored on the account. */
function UsernameSection() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const me = useQuery(api.users.me, isAuthenticated ? {} : "skip");
  const setUsername = useMutation(api.users.setUsername);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const value = draft ?? me?.username ?? "";

  if (isLoading || (isAuthenticated && me === undefined)) {
    return (
      <section className="card settings-section" id="username">
        <h2>Username</h2>
        <p><Waiting text="Loading your account…" /></p>
      </section>
    );
  }
  if (!isAuthenticated) {
    return (
      <section className="card settings-section" id="username">
        <h2>Username</h2>
        <p className="muted small"><a href="#/signin">Sign in</a> to choose the name other players see in games.</p>
      </section>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const check = checkUsername(value);
    if (!check.ok) return setError(check.error);
    setSaving(true);
    try {
      const saved = await setUsername({ username: check.username });
      setDraft(null);
      setError("");
      toast(`Your username is now ${saved}.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const unchanged = me != null && value.trim() === (me.username ?? "");
  return (
    <section className="card settings-section" id="username">
      <h2>Username</h2>
      <p className="muted small">
        The name other players see in games.{me && !me.hasUsername && <> Until you choose one you're shown as “{me.name}”.</>}{" "}
        3–20 letters, numbers, spaces, hyphens or underscores.
      </p>
      <form className="username-form" onSubmit={(e) => void submit(e)}>
        <input
          aria-label="Username"
          value={value}
          maxLength={USERNAME_MAX + 10}
          placeholder="Choose a username"
          autoComplete="nickname"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby="username-error"
          onChange={(e) => {
            setDraft(e.target.value);
            setError("");
          }}
        />
        <button className="btn small" type="submit" disabled={saving || unchanged || !value.trim()}>
          <BusyLabel busy={saving} working="Saving…">{me?.hasUsername ? "Change" : "Save"}</BusyLabel>
        </button>
      </form>
      <p className="form-error small" id="username-error" role="alert">{error}</p>
    </section>
  );
}

/** Scryfall syntax added to every deck search. Signed-in only; stored on the account. */
function SearchAdditionsSection() {
  const { isAuthenticated } = useConvexAuth();
  const settings = useQuery(api.settings.get, isAuthenticated ? {} : "skip");
  const save = useMutation(api.settings.saveSearchAdditions);
  const [text, setText] = useState<string | null>(null);
  const saved = settings?.searchAdditions ?? "";
  const value = text ?? saved;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await save({ additions: value });
      setText(null);
      toast(value.trim() ? "Search additions saved" : "Search additions cleared");
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  return (
    <section className="card settings-section" id="search-additions">
      <h2>Deck search additions</h2>
      <p className="muted small">
        Scryfall search syntax added to every search in the deck editor, for example <code>game:paper</code>, <code>-is:digital</code>,{" "}
        <code>order:cmc</code> or <code>prefer:newest</code>. You can turn it off for one search from the results.
      </p>
      {isAuthenticated ? (
        <form className="additions-form" onSubmit={(e) => void submit(e)}>
          <input
            type="text"
            aria-label="Search additions"
            placeholder={settings === undefined ? "Loading…" : "e.g. game:paper order:cmc"}
            disabled={settings === undefined}
            maxLength={MAX_ADDITIONS}
            value={value}
            onChange={(e) => setText(e.target.value)}
          />
          <button className="btn small" type="submit" disabled={value.trim() === saved}>Save</button>
        </form>
      ) : (
        <p className="muted small">Sign in to set search additions.</p>
      )}
    </section>
  );
}

/** Which printing cards get when you don't pick one. Kept in this browser, and on the account when signed in. */
function PrintingSection() {
  const { isAuthenticated } = useConvexAuth();
  const pref = usePrintingPref();
  const save = useMutation(api.settings.savePrintingPref);

  async function choose(value: string) {
    if (!isPrintingPref(value)) return;
    setPrintingPref(value);
    if (!isAuthenticated) return;
    try {
      await save({ pref: value });
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  return (
    <section className="card settings-section" id="default-printing">
      <h2>Default printing</h2>
      <p className="muted small">
        The printing a card gets when you add it from search or import a list line that doesn't name a set. Printings you pick
        yourself, and sets named in an import, are kept. To change a whole deck, use Printings in the deck editor.{" "}
        {isAuthenticated ? "Saved to your account." : "Kept in this browser. Sign in to keep it on every device."}
      </p>
      <div className="printing-prefs" role="radiogroup" aria-label="Default printing">
        {PRINTING_PREFS.map((p) => (
          <label key={p.id} className="printing-pref">
            <input type="radio" name="printing-pref" value={p.id} checked={pref === p.id} onChange={(e) => void choose(e.target.value)} />
            <span>
              {p.label}
              <span className="muted small"> {p.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </section>
  );
}

/** Deletes the account and everything in it (convex/account.ts), after typing "delete" to confirm. */
function DeleteAccountSection() {
  const { isAuthenticated } = useConvexAuth();
  const [open, setOpen] = useState(false);
  if (!isAuthenticated) return null;
  return (
    <section className="card settings-section" id="delete-account">
      <h2>Delete account</h2>
      <p className="muted small">
        Deletes your account, decks, folders, packages, settings, presets, combos and replays, and leaves any table you're at.
        This can't be undone.
      </p>
      <button className="btn ghost danger" onClick={() => setOpen(true)}>Delete account…</button>
      {open && <DeleteAccountDialog onClose={() => setOpen(false)} />}
    </section>
  );
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

function DeleteAccountDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const summary = useQuery(api.account.summary);
  const deleteAccount = useMutation(api.account.deleteAccount);
  const { signOut } = useAuthActions();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => ref.current?.showModal(), []);

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!confirmsDeletion(typed)) return;
    setBusy(true);
    setError("");
    try {
      await deleteAccount({ confirm: typed });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
      return;
    }
    await signOut();
    navigate("/");
    toast("Your account was deleted.");
  }

  return (
    <dialog ref={ref} className="new-deck folder-dialog" onClose={onClose} onClick={(e) => busy || closeOnBackdrop(e.nativeEvent, ref.current)}>
      <form onSubmit={confirm}>
        <h3>Delete your account?</h3>
        <p className="muted small" style={{ margin: 0 }}>
          {summary
            ? `Your ${plural(summary.decks, "deck")}, ${plural(summary.packages, "package")} and ${plural(summary.replays, "replay")} go with it. `
            : "All your decks, packages and replays go with it. "}
          Export any deck you want to keep first.
        </p>
        <label>
          Type <strong>{DELETE_WORD}</strong> to confirm
          <input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus autoComplete="off" spellCheck={false} disabled={busy} />
        </label>
        <p className="form-error" role="alert">{error}</p>
        <div className="actions new-deck-actions">
          <button type="button" className="btn ghost" disabled={busy} onClick={() => ref.current?.close()}>Cancel</button>
          <button className="btn delete-account" disabled={busy || !confirmsDeletion(typed)}>
            <BusyLabel busy={busy} working="Deleting…">Delete account</BusyLabel>
          </button>
        </div>
      </form>
    </dialog>
  );
}
