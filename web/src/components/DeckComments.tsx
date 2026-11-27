// Comments on a shared deck, with replies threaded under the comment they answer (convex/social.ts).
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useMemo, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { MAX_COMMENT, MAX_COMMENT_DEPTH, threads, type CommentNode } from "../../convex/model/sharing";
import { errorMessage } from "../app/errors";
import { useRoute } from "../app/router";
import { longAgo } from "../pages/DeckTable";
import { toast } from "../dom";
import { BusyLabel, Spinner } from "./Spinner";

type Comment = NonNullable<ReturnType<typeof useComments>>[number];
const useComments = (key: string) => useQuery(api.social.comments, { key });

function Composer({ shareKey, parentId, autoFocus, placeholder, onDone }: { shareKey: string; parentId?: string; autoFocus?: boolean; placeholder: string; onDone?: () => void }) {
  const add = useMutation(api.social.addComment);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  async function post(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    try {
      await add({ key: shareKey, body, parentId: parentId as Id<"deckComments"> | undefined });
      setBody("");
      onDone?.();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="comment-form" onSubmit={(e) => void post(e)}>
      <textarea
        value={body}
        maxLength={MAX_COMMENT}
        rows={parentId ? 2 : 3}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-label={placeholder}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void post(e);
          if (e.key === "Escape" && onDone) onDone();
        }}
      />
      <div className="comment-form-actions">
        {onDone && <button type="button" className="btn ghost small" onClick={onDone}>Cancel</button>}
        <button className="btn small" disabled={busy || !body.trim()}><BusyLabel busy={busy} working="Posting…">{parentId ? "Reply" : "Post"}</BusyLabel></button>
      </div>
    </form>
  );
}

function Thread({ node, depth, shareKey, canWrite }: { node: CommentNode<Comment>; depth: number; shareKey: string; canWrite: boolean }) {
  const c = node.comment;
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const remove = useMutation(api.social.deleteComment);
  const edit = useMutation(api.social.editComment);
  const count = (n: CommentNode<Comment>): number => n.replies.reduce((t, r) => t + 1 + count(r), 0);

  async function del() {
    if (!confirm("Delete this comment?")) return;
    try {
      await remove({ id: c._id as Id<"deckComments"> });
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }
  async function saveEdit() {
    try {
      await edit({ id: c._id as Id<"deckComments">, body: editing ?? "" });
      setEditing(null);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  return (
    <li className="comment" id={`comment-${c._id}`}>
      <div className="comment-head">
        {node.replies.length > 0 && (
          <button className="comment-fold" aria-expanded={!collapsed} aria-label={collapsed ? "Show replies" : "Hide replies"} onClick={() => setCollapsed((x) => !x)}>
            {collapsed ? "+" : "−"}
          </button>
        )}
        {c.deleted ? <span className="muted">deleted</span> : <b className="comment-author">{c.author}</b>}
        {c.byDeckOwner && <span className="pill tiny">author</span>}
        <span className="muted small">
          · <time dateTime={new Date(c.createdAt).toISOString()} title={new Date(c.createdAt).toLocaleString()}>{longAgo(c.createdAt)}</time>
          {c.editedAt ? " · edited" : ""}
        </span>
        {collapsed && <span className="muted small"> · {count(node)} repl{count(node) === 1 ? "y" : "ies"} hidden</span>}
      </div>
      {editing !== null ? (
        <div className="comment-form">
          <textarea value={editing} maxLength={MAX_COMMENT} rows={3} autoFocus aria-label="Edit comment" onChange={(e) => setEditing(e.target.value)} />
          <div className="comment-form-actions">
            <button className="btn ghost small" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn small" disabled={!editing.trim()} onClick={() => void saveEdit()}>Save</button>
          </div>
        </div>
      ) : (
        !collapsed && <p className={`comment-body${c.deleted ? " muted" : ""}`}>{c.deleted ? "This comment was deleted." : c.body}</p>
      )}
      {!collapsed && !c.deleted && editing === null && (
        <div className="comment-actions">
          {canWrite && <button className="link-btn" onClick={() => setReplying((r) => !r)}>Reply</button>}
          {c.mine && <button className="link-btn" onClick={() => setEditing(c.body)}>Edit</button>}
          {c.canDelete && <button className="link-btn danger" onClick={() => void del()}>Delete</button>}
        </div>
      )}
      {replying && <Composer shareKey={shareKey} parentId={c._id} autoFocus placeholder={`Reply to ${c.author ?? "this comment"}`} onDone={() => setReplying(false)} />}
      {!collapsed && node.replies.length > 0 && (
        <ol className={`comment-replies${depth + 1 >= MAX_COMMENT_DEPTH - 1 ? " flat" : ""}`}>
          {node.replies.map((r) => <Thread key={r.comment._id} node={r} depth={depth + 1} shareKey={shareKey} canWrite={canWrite} />)}
        </ol>
      )}
    </li>
  );
}

export function DeckComments({ shareKey, commentsOff, owner }: { shareKey: string; commentsOff: boolean; owner: boolean }) {
  const comments = useComments(shareKey);
  const { isAuthenticated } = useConvexAuth();
  const me = useQuery(api.users.me, isAuthenticated ? {} : "skip");
  const route = useRoute();
  const tree = useMemo(() => threads(comments ?? []), [comments]);
  if (commentsOff) {
    return (
      <section className="deck-comments">
        <h2>Comments</h2>
        <p className="muted">{owner ? "Comments are off for this deck. Turn them on in Share." : "The author turned comments off for this deck."}</p>
      </section>
    );
  }
  const here = route.path;
  const canWrite = isAuthenticated && !!me?.hasUsername;
  return (
    <section className="deck-comments">
      <h2>Comments{comments ? <span className="muted"> {comments.filter((c) => !c.deleted).length}</span> : null}</h2>
      {!isAuthenticated ? (
        <p className="muted"><a href={`#/signin?next=${encodeURIComponent(here)}`}>Sign in</a> to comment.</p>
      ) : me && !me.hasUsername ? (
        <p className="muted"><a href="#/settings">Pick a username</a> to comment.</p>
      ) : (
        <Composer shareKey={shareKey} placeholder="Write a comment…" />
      )}
      {comments === undefined ? (
        <Spinner />
      ) : !tree.length ? (
        <p className="muted small">No comments yet.</p>
      ) : (
        <ol className="comment-list">
          {tree.map((n) => <Thread key={n.comment._id} node={n} depth={0} shareKey={shareKey} canWrite={canWrite} />)}
        </ol>
      )}
    </section>
  );
}
