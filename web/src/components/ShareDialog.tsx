// Share a deck: public, unlisted or private, its link, and whether it takes comments (src/sharing.ts).
import { useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { VISIBILITIES, type Visibility } from "../../convex/model/sharing";
import { errorMessage } from "../app/errors";
import { closeOnBackdrop } from "../carddetails";
import { toast } from "../dom";
import { copyText, shareLink, VISIBILITY } from "../sharing";

export function ShareDialog({ deck, colors, onClose }: {
  deck: { _id: Id<"decks">; name: string; visibility: Visibility; shareKey?: string; commentsOff?: boolean };
  /** The deck's colors if they're known here, for the deck search's color filter. */
  colors?: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const setVisibility = useMutation(api.sharing.setVisibility);
  const setCommentsOff = useMutation(api.sharing.setCommentsOff);
  const [vis, setVis] = useState(deck.visibility);
  const [key, setKey] = useState(deck.shareKey);
  const [commentsOff, setOff] = useState(!!deck.commentsOff);
  const [busy, setBusy] = useState(false);
  useEffect(() => ref.current?.showModal(), []);

  async function pick(v: Visibility) {
    const was = vis;
    setVis(v);
    setBusy(true);
    try {
      setKey(await setVisibility({ id: deck._id, visibility: v, colors }));
    } catch (e) {
      setVis(was);
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function toggleComments(off: boolean) {
    setOff(off);
    try {
      await setCommentsOff({ id: deck._id, off });
    } catch (e) {
      setOff(!off);
      toast(errorMessage(e), "error");
    }
  }

  const link = key ? shareLink(key) : "";
  return (
    <dialog ref={ref} className="new-deck share-dialog" onClose={onClose} onClick={(e) => closeOnBackdrop(e.nativeEvent, ref.current)}>
      <button className="dialog-close" aria-label="Close" onClick={() => ref.current?.close()}>×</button>
      <h3>Share “{deck.name}”</h3>
      <div className="share-options" role="radiogroup" aria-label="Who can see this deck">
        {VISIBILITIES.map((v) => (
          <label key={v} className={`share-option${vis === v ? " on" : ""}`}>
            <input type="radio" name="visibility" checked={vis === v} disabled={busy} onChange={() => void pick(v)} />
            <span>
              <b><span aria-hidden="true">{VISIBILITY[v].icon}</span> {VISIBILITY[v].label}</b>
              <span className="muted small">{VISIBILITY[v].hint}</span>
            </span>
          </label>
        ))}
      </div>
      {vis !== "private" && link && (
        <div className="share-link">
          <input readOnly value={link} aria-label="Share link" onFocus={(e) => e.currentTarget.select()} />
          <button className="btn small" onClick={() => void copyText(link).then((ok) => toast(ok ? "Link copied" : "Couldn't copy: select the link and copy it yourself", ok ? "info" : "error"))}>Copy link</button>
          <a className="btn ghost small" href={`#/d/${key}`} onClick={() => ref.current?.close()}>Open</a>
        </div>
      )}
      <label className="inline share-comments">
        <input type="checkbox" checked={!commentsOff} onChange={(e) => void toggleComments(!e.target.checked)} /> Allow comments
      </label>
      <p className="muted small share-note">
        Shared decks show your username (not your sign-in name), the cards, tags, bracket and changelog. Game settings saved with the
        deck (auto-yields, use later) and its folder stay private.
      </p>
    </dialog>
  );
}
