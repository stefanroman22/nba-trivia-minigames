import { useCallback, useEffect, useRef, useState } from "react";
import "../../styles/Friends.css";
import { Avatar, CourtLoader } from "../ui";
import SwapText from "../motion/SwapText";
import {
  useFriends,
  searchUsers,
  searchFriends,
  type FriendUser,
  type FriendSearchResult,
} from "../../hooks/useFriends";
import { useModal } from "../../context/ModalContext";

type Tab = "friends" | "requests" | "find" | "blocked";

const TABS: { key: Tab; label: string }[] = [
  { key: "friends", label: "Friends" },
  { key: "requests", label: "Requests" },
  { key: "find", label: "Find" },
  { key: "blocked", label: "Blocked" },
];

function initials(name: string): string {
  const letters = (name || "?").replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase();
  return letters || "?";
}

/** Friend search + add, incoming/outgoing requests, friend list, and blocked
 * players — everything the "no messaging, just add/search/block" ask needs,
 * in one modal reached from the profile card. */
export default function FriendsModal() {
  const [tab, setTab] = useState<Tab>("friends");
  const {
    incoming, outgoing, blocked, loading, error, refresh,
    acceptRequest, declineRequest, cancelRequest, removeFriend, blockUser, unblockUser, sendRequest,
  } = useFriends();

  // The modal host doesn't actually unmount/remount on close+reopen (framer
  // motion's AnimatePresence holds the exiting element under the same key),
  // so a mount-only fetch would show stale data the second time this is
  // opened in the same page session. `kind` from context, unlike this
  // component's own lifecycle, reliably flips back to "friends" on every
  // reopen — use that as the "just became visible" signal instead.
  const { kind } = useModal();
  useEffect(() => {
    if (kind === "friends") refresh();
  }, [kind, refresh]);

  // Per-row "this action is in flight" flag, keyed by public id / request id,
  // so a click can't double-fire while its request is still out.
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const withBusy = async (key: string, action: () => Promise<void>) => {
    if (busy.has(key)) return;
    setBusy((s) => new Set(s).add(key));
    try {
      await action();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy((s) => { const next = new Set(s); next.delete(key); return next; });
    }
  };
  const [actionError, setActionError] = useState<string | null>(null);

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "2rem 0" }}>
        <CourtLoader label="Loading your friends…" scale={0.7} />
      </div>
    );
  }

  if (error) {
    return <p style={{ textAlign: "center", color: "var(--muted)", padding: "1rem 0" }}>{error}</p>;
  }

  return (
    <div className="fr-stack">
      <div className="fr-tabs" role="tablist" aria-label="Friends">
        {TABS.map((t) => {
          const count = t.key === "requests" ? incoming.length : t.key === "blocked" ? blocked.length : null;
          return (
            <button
              key={t.key}
              className={`fr-tab${tab === t.key ? " is-active" : ""}`}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
            >
              {t.label}{count ? ` (${count})` : ""}
            </button>
          );
        })}
      </div>

      {actionError && <p role="alert" className="fr-error">{actionError}</p>}

      {tab === "friends" && (
        <FriendsTab removeFriend={removeFriend} blockUser={blockUser} onError={setActionError} />
      )}

      {tab === "requests" && (
        <div className="fr-req-groups">
          <div>
            <span className="fr-group-label">Incoming</span>
            {incoming.length === 0 ? (
              <p className="fr-empty">No incoming requests.</p>
            ) : (
              <div className="fr-list">
                {incoming.map((r) => (
                  <div key={r.request_id} className="fr-row">
                    <Avatar initials={initials(r.username)} size={30} />
                    <div className="fr-row-info">
                      <span className="fr-name">{r.username}</span>
                      <span className="tnum fr-sub">#{r.id}</span>
                    </div>
                    <div className="fr-actions">
                      <button
                        className="fr-btn fr-btn-primary"
                        disabled={busy.has(`req-${r.request_id}`)}
                        onClick={() => withBusy(`req-${r.request_id}`, () => acceptRequest(r.request_id))}
                      >
                        Accept
                      </button>
                      <button
                        className="fr-btn"
                        disabled={busy.has(`req-${r.request_id}`)}
                        onClick={() => withBusy(`req-${r.request_id}`, () => declineRequest(r.request_id))}
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <span className="fr-group-label">Sent</span>
            {outgoing.length === 0 ? (
              <p className="fr-empty">No sent requests.</p>
            ) : (
              <div className="fr-list">
                {outgoing.map((r) => (
                  <div key={r.request_id} className="fr-row">
                    <Avatar initials={initials(r.username)} size={30} />
                    <div className="fr-row-info">
                      <span className="fr-name">{r.username}</span>
                      <span className="tnum fr-sub">#{r.id}</span>
                    </div>
                    <div className="fr-actions">
                      <button
                        className="fr-btn"
                        disabled={busy.has(`req-${r.request_id}`)}
                        onClick={() => withBusy(`req-${r.request_id}`, () => cancelRequest(r.request_id))}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "find" && <FindTab sendRequest={sendRequest} onError={setActionError} />}

      {tab === "blocked" && (
        blocked.length === 0 ? (
          <p className="fr-empty">You haven't blocked anyone.</p>
        ) : (
          <div className="fr-list">
            {blocked.map((b) => (
              <div key={b.id} className="fr-row">
                <Avatar initials={initials(b.username)} size={30} />
                <div className="fr-row-info">
                  <span className="fr-name">{b.username}</span>
                  <span className="tnum fr-sub">#{b.id}</span>
                </div>
                <div className="fr-actions">
                  <button
                    className="fr-btn"
                    disabled={busy.has(b.id)}
                    onClick={() => withBusy(b.id, () => unblockUser(b.id))}
                  >
                    Unblock
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}

const SEARCH_DEBOUNCE_MS = 350;
const FRIENDS_PAGE_SIZE = 30;
const RELATIONSHIP_LABEL: Record<Exclude<FriendSearchResult["relationship"], "none">, string> = {
  friend: "Friends",
  pending_outgoing: "Request sent",
  pending_incoming: "Sent you a request",
};

/** Your own friend list — searchable by name or player ID, one box, server
 * paginated. Loads a page at a time instead of the whole list up front, so
 * this stays fast whether you have 5 friends or 5,000. */
function FriendsTab({
  removeFriend,
  blockUser,
  onError,
}: {
  removeFriend: (publicId: string) => Promise<void>;
  blockUser: (publicId: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FriendUser[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);
  const queryRef = useRef(query);
  queryRef.current = query;

  const loadPage = useCallback(async (q: string, offset: number, append: boolean) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    try {
      const page = await searchFriends(q, FRIENDS_PAGE_SIZE, offset);
      // A slower earlier request can resolve after a newer one if the person
      // kept typing — only apply a response that still matches the live query.
      if (q !== queryRef.current) return;
      setResults((prev) => (append ? [...prev, ...page.results] : page.results));
      setTotal(page.total);
    } catch {
      if (q === queryRef.current) onError("Could not load your friends.");
    } finally {
      if (append) setLoadingMore(false);
      else setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    const q = query.trim();
    debounceRef.current = window.setTimeout(() => loadPage(q, 0, false), SEARCH_DEBOUNCE_MS);
    return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const handleAction = async (id: string, action: (publicId: string) => Promise<void>) => {
    if (busyId) return;
    setBusyId(id);
    try {
      await action(id);
      await loadPage(query.trim(), 0, false);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="fr-find">
      <input
        className="modal-input"
        placeholder="Search your friends by name or player ID…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {loading ? (
        <p className="fr-empty">Loading…</p>
      ) : results.length === 0 ? (
        <p className="fr-empty">
          {query.trim() ? "No friends match that search." : "No friends yet — try the Find tab."}
        </p>
      ) : (
        <>
          <div className="fr-list">
            {results.map((f) => (
              <div key={f.id} className="fr-row">
                <Avatar initials={initials(f.username)} size={30} />
                <div className="fr-row-info">
                  <span className="fr-name">{f.username}</span>
                  <span className="tnum fr-sub">#{f.id} · {f.rank}</span>
                </div>
                <span className="tnum fr-pts">{f.points.toLocaleString()}</span>
                <div className="fr-actions">
                  <button
                    className="fr-btn fr-btn-danger"
                    disabled={busyId === f.id}
                    onClick={() => handleAction(f.id, removeFriend)}
                  >
                    <SwapText>Remove</SwapText>
                  </button>
                  <button
                    className="fr-btn fr-btn-danger"
                    disabled={busyId === f.id}
                    onClick={() => handleAction(f.id, blockUser)}
                  >
                    Block
                  </button>
                </div>
              </div>
            ))}
          </div>
          {results.length < total && (
            <button
              className="fr-btn"
              style={{ alignSelf: "center" }}
              disabled={loadingMore}
              onClick={() => loadPage(query.trim(), results.length, true)}
            >
              <SwapText>{loadingMore ? "Loading…" : `Load more (${total - results.length} left)`}</SwapText>
            </button>
          )}
        </>
      )}
    </div>
  );
}

function FindTab({
  sendRequest,
  onError,
}: {
  sendRequest: (publicId: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FriendSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);

  const handleAdd = async (id: string) => {
    if (sendingId) return;
    setSendingId(id);
    try {
      await sendRequest(id);
      // Optimistic: the request-sent state on this row is now stale until the
      // next search, so reflect it immediately rather than leaving "Add" up.
      setResults((rows) => rows.map((r) => (r.id === id ? { ...r, relationship: "pending_outgoing" } : r)));
    } catch (e) {
      onError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSendingId(null);
    }
  };

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = window.setTimeout(async () => {
      try {
        const rows = await searchUsers(q);
        setResults(rows);
      } finally {
        setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current); };
  }, [query]);

  return (
    <div className="fr-find">
      <input
        className="modal-input"
        placeholder="Search by name or player ID…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />
      {searching ? (
        <p className="fr-empty">Searching…</p>
      ) : query.trim().length < 2 ? (
        <p className="fr-empty">Type at least 2 characters to search.</p>
      ) : results.length === 0 ? (
        <p className="fr-empty">No players found.</p>
      ) : (
        <div className="fr-list">
          {results.map((r) => (
            <div key={r.id} className="fr-row">
              <Avatar initials={initials(r.username)} size={30} />
              <div className="fr-row-info">
                <span className="fr-name">{r.username}</span>
                <span className="tnum fr-sub">#{r.id} · {r.rank}</span>
              </div>
              <div className="fr-actions">
                {r.relationship === "none" ? (
                  <button
                    className="fr-btn fr-btn-primary"
                    disabled={sendingId === r.id}
                    onClick={() => handleAdd(r.id)}
                  >
                    <SwapText>{sendingId === r.id ? "Sending…" : "Add"}</SwapText>
                  </button>
                ) : (
                  <span className="fr-status">{RELATIONSHIP_LABEL[r.relationship]}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
