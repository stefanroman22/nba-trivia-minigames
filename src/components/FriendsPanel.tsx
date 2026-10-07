import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import "../styles/Friends.css";
import { Avatar } from "./ui";
import SwapText from "./motion/SwapText";
import SegmentedTabs from "./motion/SegmentedTabs";
import { reducedFade, swap } from "../motion/variants";
import {
  useFriends,
  searchUsers,
  searchFriends,
  friendPhotoUrl,
  type FriendUser,
  type FriendSearchResult,
} from "../hooks/useFriends";

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

/** One state of a list's placeholder line: `key` names the state ("loading",
 * "empty", "no-match", …) so the text swap animates on a state change, not on
 * every re-render. */
type EmptyState = { key: string; text: string };

/** The muted placeholder line under a list. A single `.fr-empty` element across
 * all its states — only the text swaps (SwapText), so the box never changes
 * height between "Loading…" and the empty/no-match copy. */
function EmptyLine({ state }: { state: EmptyState }) {
  return (
    <p className="fr-empty">
      <SwapText swapKey={state.key}>{state.text}</SwapText>
    </p>
  );
}

/** Friend search + add, incoming/outgoing requests, friend list, and blocked
 * players — everything the "no messaging, just add/search/block" ask needs.
 * Mounted directly in the profile card (the default view there) rather than
 * behind a modal, so `useFriends`'s own mount-time fetch is all the
 * refresh-on-return-to-this-view a plain conditional render needs. */
export default function FriendsPanel() {
  const [tab, setTab] = useState<Tab>("friends");
  const swapVariants = useReducedMotion() ? reducedFade : swap;
  const {
    incoming, outgoing, blocked, loading, error,
    acceptRequest, declineRequest, cancelRequest, removeFriend, blockUser, unblockUser, sendRequest,
  } = useFriends();

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

  // One loading state, owned by each list's own placeholder line: the tabs and
  // the search box render at once, and only the line under the list swaps
  // "Loading…" → its empty copy. The requests/blocked lists come from the
  // overview fetch; the Friends list pages itself in (FriendsTab), so it never
  // waits on the overview — and a failed overview only affects the lists it feeds.
  const overviewLine = (key: string, text: string): EmptyState =>
    loading ? { key: "loading", text: "Loading…" } : error ? { key: "error", text: error } : { key, text };

  return (
    <div className="fr-stack">
      <SegmentedTabs
        className="fr-tabs"
        itemClassName="fr-tab"
        thumbRadius={8}
        aria-label="Friends"
        options={TABS.map((t) => {
          const count = t.key === "requests" ? incoming.length : t.key === "blocked" ? blocked.length : null;
          return {
            key: t.key,
            label: <SwapText swapKey={count ?? 0}>{`${t.label}${count ? ` (${count})` : ""}`}</SwapText>,
          };
        })}
        value={tab}
        onChange={setTab}
      />

      {actionError && <p role="alert" className="fr-error">{actionError}</p>}

      {/* One keyed pane per tab: the body cross-fades as the SegmentedTabs thumb slides.
          Opacity/transform only, the modal's height is never animated. */}
      <AnimatePresence mode="wait" initial={false}>
      <motion.div key={tab} variants={swapVariants} initial="hidden" animate="visible" exit="exit">
      {tab === "friends" && (
        <FriendsTab removeFriend={removeFriend} blockUser={blockUser} onError={setActionError} />
      )}

      {tab === "requests" && (
        <div className="fr-req-groups">
          <div>
            <span className="fr-group-label">Incoming</span>
            {incoming.length === 0 ? (
              <EmptyLine state={overviewLine("empty", "No incoming requests.")} />
            ) : (
              <div className="fr-list">
                {incoming.map((r) => (
                  <div key={r.request_id} className="fr-row">
                    <Avatar initials={initials(r.username)} size={30} src={friendPhotoUrl(r.id, r.photo_version)} />
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
              <EmptyLine state={overviewLine("empty", "No sent requests.")} />
            ) : (
              <div className="fr-list">
                {outgoing.map((r) => (
                  <div key={r.request_id} className="fr-row">
                    <Avatar initials={initials(r.username)} size={30} src={friendPhotoUrl(r.id, r.photo_version)} />
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
          <EmptyLine state={overviewLine("empty", "You haven't blocked anyone.")} />
        ) : (
          <div className="fr-list">
            {blocked.map((b) => (
              <div key={b.id} className="fr-row">
                <Avatar initials={initials(b.username)} size={30} src={friendPhotoUrl(b.id, b.photo_version)} />
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
      </motion.div>
      </AnimatePresence>
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
  // The first page loads at once — the debounce is for typing, and delaying the
  // opening fetch would only stretch the tab's single "Loading…" state.
  const firstLoadRef = useRef(true);
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
    const delay = firstLoadRef.current ? 0 : SEARCH_DEBOUNCE_MS;
    debounceRef.current = window.setTimeout(() => {
      firstLoadRef.current = false;
      loadPage(q, 0, false);
    }, delay);
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
      {loading || results.length === 0 ? (
        <EmptyLine
          state={
            loading
              ? { key: "loading", text: "Loading your friends…" }
              : query.trim()
                ? { key: "no-match", text: "No friends match that search." }
                : { key: "empty", text: "No friends yet — try the Find tab." }
          }
        />
      ) : (
        <>
          <div className="fr-list">
            {results.map((f) => (
              <div key={f.id} className="fr-row">
                <Avatar initials={initials(f.username)} size={30} src={friendPhotoUrl(f.id, f.photo_version)} />
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
                    Remove
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
              <SwapText
                swapKey={loadingMore ? "loading" : "more"}
                reserveWidth={["Loading…", `Load more (${total - results.length} left)`]}
              >
                {loadingMore ? "Loading…" : `Load more (${total - results.length} left)`}
              </SwapText>
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
      {searching || query.trim().length < 2 || results.length === 0 ? (
        <EmptyLine
          state={
            searching
              ? { key: "searching", text: "Searching…" }
              : query.trim().length < 2
                ? { key: "hint", text: "Type at least 2 characters to search." }
                : { key: "no-results", text: "No players found." }
          }
        />
      ) : (
        <div className="fr-list">
          {results.map((r) => (
            <div key={r.id} className="fr-row">
              <Avatar initials={initials(r.username)} size={30} src={friendPhotoUrl(r.id, r.photo_version)} />
              <div className="fr-row-info">
                <span className="fr-name">{r.username}</span>
                <span className="tnum fr-sub">#{r.id} · {r.rank}</span>
              </div>
              <div className="fr-actions">
                {/* The Add button handing over to its status label ("Request sent")
                    is one swap, keyed by the relationship. */}
                <SwapText swapKey={r.relationship}>
                  {r.relationship === "none" ? (
                    <button
                      className="fr-btn fr-btn-primary"
                      disabled={sendingId === r.id}
                      onClick={() => handleAdd(r.id)}
                    >
                      <SwapText swapKey={sendingId === r.id ? "sending" : "add"} reserveWidth={["Add", "Sending…"]}>
                        {sendingId === r.id ? "Sending…" : "Add"}
                      </SwapText>
                    </button>
                  ) : (
                    <span className="fr-status">{RELATIONSHIP_LABEL[r.relationship]}</span>
                  )}
                </SwapText>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
