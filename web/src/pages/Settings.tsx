// Settings (#/settings): your username and the game hotkeys. Changes apply right away, are kept in this browser, and
// are saved to your account when you're signed in, so they follow you to other devices.
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import { errorMessage } from "../app/errors";
import { toast } from "../dom";
import { bind, changedKeys, DEFAULT_HOTKEYS, HOTKEY_ACTIONS, keyLabel, keyName, MODIFIER_KEYS, RESERVED_KEYS, type HotkeyAction, type Hotkeys } from "../game/hotkeys";
import { setHotkeys, useHotkeyMap } from "../game/useHotkeys";
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

  if (isLoading) return null;
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
          {me?.hasUsername ? "Change" : "Save"}
        </button>
      </form>
      <p className="form-error small" id="username-error" role="alert">{error}</p>
    </section>
  );
}
