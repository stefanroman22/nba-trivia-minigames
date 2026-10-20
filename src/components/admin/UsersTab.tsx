/**
 * Admin panel → Users tab.
 *
 * Top: the whole player base for one period (totals, who is active, time on the site, games,
 * multiplayer, ranks, countries). Below: every account, searchable and sortable; opening one shows
 * its full usage picture and the admin's actions on it — email, a friend request from the admin's
 * own account, ban/unban. Clicking a rank or country bar filters the list to it.
 *
 * Time on the site comes from the browser's activity reports (hooks/useActivityTracker), so it
 * starts counting from the day that shipped; "tracked since" says from when.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Avatar, Button, CourtLoader, Field, Select } from "../ui";
import Modal from "../ui/Modal";
import AutoHeight from "../motion/AutoHeight";
import SwapText from "../motion/SwapText";
import { friendPhotoUrl } from "../../hooks/useFriends";
import { games as gameCatalog } from "../../utils/GameUtils";
import { ListBars, TimeBars } from "./UsersCharts";
import {
  EMPTY_QUERY,
  acceptFriendRequest,
  cancelFriendRequest,
  countryName,
  fetchOverview,
  fetchUserDetail,
  fetchUsers,
  fmtDuration,
  sendFriendRequest,
  setBanned,
  type Relationship,
  type UserDetail,
  type UserRow,
  type UsersOverview,
  type UsersPeriod,
  type UsersQuery,
} from "./usersApi";

const PAGE_SIZE = 25;

const PERIODS: { key: UsersPeriod; label: string }[] = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
  { key: "12m", label: "12 months" },
  { key: "all", label: "All time" },
];

const SORTS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "last_seen", label: "Last seen" },
  { value: "time", label: "Most time on site" },
  { value: "games", label: "Most games" },
  { value: "online", label: "Most online games" },
  { value: "points", label: "Most points" },
  { value: "name", label: "Name A–Z" },
];

const FILTERS = [
  { value: "all", label: "Everyone" },
  { value: "active_7d", label: "Active 7 days" },
  { value: "inactive_30d", label: "Inactive 30 days" },
  { value: "new_7d", label: "Joined 7 days" },
  { value: "online", label: "Played online" },
  { value: "never_played", label: "Never played" },
  { value: "google", label: "Google sign-in" },
  { value: "banned", label: "Banned" },
  { value: "admins", label: "Admins" },
];

const MODE_LABEL: Record<string, string> = { single: "Solo", match: "Online 1v1", friend: "Friend room" };

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
const fmt = (n: number) => n.toLocaleString();
const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "—");
const gameName = (id: string) => gameCatalog.find((g) => g.id === id)?.name ?? id;
const hours = (s: number) => Math.round((s / 3600) * 10) / 10;
const fmtHours = (h: number) => `${h.toLocaleString(undefined, { maximumFractionDigits: 1 })}h`;
const fmtMinutes = (m: number) => `${Math.round(m)}m`;

function fmtDate(iso: string | null | undefined) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";
}

function fmtDateTime(iso: string | null | undefined) {
  return iso
    ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "—";
}

function ago(iso: string | null | undefined) {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 120) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 60) return `${Math.floor(s / 86400)}d ago`;
  return fmtDate(iso);
}

function Country({ code }: { code: string }) {
  if (!code) return <span className="admin-muted">—</span>;
  return (
    <span className="au-country" title={countryName(code)}>
      {code}
    </span>
  );
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className="surface fb-stat">
      <span className="fb-stat-label">{label}</span>
      <span className="fb-stat-value font-display">{value}</span>
      {sub && <span className="fb-stat-sub">{sub}</span>}
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="fb-detail-label">{label}</span>
      <span className="fb-detail-value">{children}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Email compose — opens the admin's own mail app, nothing is sent    */
/*  from the server.                                                   */
/* ------------------------------------------------------------------ */
function EmailModal({ to, name, onClose }: { to: string; name: string; onClose: () => void }) {
  const [subject, setSubject] = useState("A message from Swish Quest");
  const [body, setBody] = useState(`Hi ${name},\n\n\n\n— Swish Quest`);
  const [copied, setCopied] = useState(false);

  const mailto = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const gmail =
    `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}` +
    `&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(to);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard refused: the address is on screen to copy by hand */
    }
  }

  return (
    <Modal title={`Email ${name}`} onClose={onClose}>
      <div className="au-compose">
        <label className="au-compose-label">
          To
          <Field value={to} readOnly aria-label="Recipient" />
        </label>
        <label className="au-compose-label">
          Subject
          <Field value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" />
        </label>
        <label className="au-compose-label">
          Message
          <textarea className="field au-compose-body" value={body} onChange={(e) => setBody(e.target.value)} rows={8} />
        </label>
        <p className="admin-muted au-compose-note">
          Opens in your own email app or Gmail, ready to send from your address.
        </p>
        <div className="au-compose-actions">
          <a className="btn btn-primary btn-sm" href={gmail} target="_blank" rel="noreferrer">
            Open in Gmail
          </a>
          <a className="btn btn-secondary btn-sm" href={mailto}>
            Open in email app
          </a>
          <button type="button" className="btn btn-ghost btn-sm" onClick={copy}>
            <SwapText reserveWidth={["Copy address", "Copied"]}>{copied ? "Copied" : "Copy address"}</SwapText>
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/*  Ban confirmation                                                   */
/* ------------------------------------------------------------------ */
function BanModal({
  name,
  banned,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  name: string;
  banned: boolean;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={banned ? `Unban ${name}?` : `Ban ${name}?`} onClose={onClose}>
      <div className="au-confirm">
        {banned ? (
          <p>The account is restored as it was: points, friends and history were never removed. Strikes are reset to 0.</p>
        ) : (
          <p>
            They are signed out everywhere, can&apos;t sign in or sign up again with this email, and disappear from the
            leaderboard, search and online play. Nothing is deleted, so you can unban them later. Their ban notice
            says a moderator banned the account, and how to appeal.
          </p>
        )}
        {error && <p className="admin-error">{error}</p>}
        <div className="au-compose-actions">
          <Button variant={banned ? "primary" : "danger"} size="sm" onClick={onConfirm} disabled={busy}>
            <SwapText reserveWidth={["Working…", "Unban account", "Ban account"]}>
              {busy ? "Working…" : banned ? "Unban account" : "Ban account"}
            </SwapText>
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/*  Friend-request button: one element, its label swaps (UI-22)        */
/* ------------------------------------------------------------------ */
const FRIEND_LABEL: Record<Relationship["status"], string> = {
  none: "Send friend request",
  pending_outgoing: "Cancel friend request",
  pending_incoming: "Accept their request",
  friend: "Friends ✓",
  blocked: "Blocked",
  self: "This is you",
};

function FriendButton({
  publicId,
  relationship,
  onChange,
}: {
  publicId: string;
  relationship: Relationship;
  onChange: (r: Relationship) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { status, request_id } = relationship;
  const inert = status === "friend" || status === "blocked" || status === "self";

  async function press() {
    setBusy(true);
    setError(null);
    try {
      if (status === "none") {
        const result = await sendFriendRequest(publicId);
        // A request already waiting from them is accepted instead of duplicated.
        onChange(result === "accepted" ? { status: "friend", request_id: null } : await refreshRelationship(publicId));
      } else if (status === "pending_outgoing" && request_id != null) {
        await cancelFriendRequest(request_id);
        onChange({ status: "none", request_id: null });
      } else if (status === "pending_incoming" && request_id != null) {
        await acceptFriendRequest(request_id);
        onChange({ status: "friend", request_id: null });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={`admin-browse au-action${status === "pending_outgoing" ? " is-current" : ""}`}
        onClick={press}
        disabled={busy || inert}
      >
        <SwapText reserveWidth={Object.values(FRIEND_LABEL)}>{busy ? "Working…" : FRIEND_LABEL[status]}</SwapText>
      </button>
      {error && <span className="admin-error au-inline-error">{error}</span>}
    </>
  );
}

/** The request id of a just-sent request comes back only through the detail payload. */
async function refreshRelationship(publicId: string): Promise<Relationship> {
  return (await fetchUserDetail(publicId)).relationship;
}

/* ------------------------------------------------------------------ */
/*  One account, opened                                                */
/* ------------------------------------------------------------------ */
function UserPanel({ row, onRowChange }: { row: UserRow; onRowChange: (r: UserRow) => void }) {
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [banOpen, setBanOpen] = useState(false);
  const [banBusy, setBanBusy] = useState(false);
  const [banError, setBanError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchUserDetail(row.public_id)
      .then((d) => !cancelled && setDetail(d))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Could not load this player"));
    return () => {
      cancelled = true;
    };
  }, [row.public_id]);

  async function toggleBan() {
    if (!detail) return;
    setBanBusy(true);
    setBanError(null);
    try {
      const account = await setBanned(row.public_id, !detail.account.banned_at);
      setDetail({ ...detail, account });
      onRowChange({ ...row, banned: !!account.banned_at });
      setBanOpen(false);
    } catch (e) {
      setBanError(e instanceof Error ? e.message : "Could not update the ban");
    } finally {
      setBanBusy(false);
    }
  }

  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(row.email);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* the address is shown in full right above */
    }
  }

  const minutesPerDay = useMemo(() => detail?.usage.daily.map((d) => d.seconds / 60) ?? [], [detail]);
  const dayLabels = useMemo(() => detail?.usage.daily.map((d) => d.label) ?? [], [detail]);

  if (error) return <div className="admin-error au-panel-msg">{error}</div>;
  if (!detail)
    return (
      <div className="au-panel-msg">
        <CourtLoader label="Loading player…" scale={0.5} />
      </div>
    );

  const { account: a, usage: u, games: g, social: s } = detail;
  const canBan = !a.is_admin && detail.relationship.status !== "self";

  return (
    <div className="au-panel">
      <div className="fb-row-actions au-actions">
        <button type="button" className="admin-browse au-action" onClick={() => setEmailOpen(true)}>
          Email player
        </button>
        <button type="button" className="admin-browse au-action" onClick={copyEmail}>
          <SwapText reserveWidth={["Copy email", "Copied"]}>{copied ? "Copied" : "Copy email"}</SwapText>
        </button>
        {detail.relationship.status !== "self" && (
          <FriendButton
            publicId={a.public_id}
            relationship={detail.relationship}
            onChange={(relationship) => setDetail((d) => (d ? { ...d, relationship } : d))}
          />
        )}
        {canBan && (
          <button
            type="button"
            className={`admin-browse au-action au-ban${a.banned_at ? "" : " is-danger"}`}
            onClick={() => {
              setBanError(null);
              setBanOpen(true);
            }}
          >
            <SwapText reserveWidth={["Unban account", "Ban account"]}>{a.banned_at ? "Unban account" : "Ban account"}</SwapText>
          </button>
        )}
      </div>

      <div className="fb-detail-grid">
        <Detail label="Email">{a.email}</Detail>
        <Detail label="Joined">{fmtDateTime(a.date_joined)}</Detail>
        <Detail label="Last seen">
          {fmtDateTime(u.last_seen)} <span className="admin-muted">({ago(u.last_seen)})</span>
        </Detail>
        <Detail label="Plays from">
          {u.country ? countryName(u.country) : <span className="admin-muted">Unknown</span>}
          {u.countries.length > 1 && (
            <span className="admin-muted"> · also {u.countries.filter((c) => c.country !== u.country).map((c) => c.country).join(", ")}</span>
          )}
        </Detail>
        <Detail label="Signs in with">
          {[a.google && "Google", a.has_password && "Password"].filter(Boolean).join(" + ") || "—"}
        </Detail>
        <Detail label="Rank">
          {a.rank} · {fmt(a.points)} pts{a.founding_member && <span className="admin-muted"> · founding member</span>}
        </Detail>
        <Detail label="Time on site">
          <span className="tnum">{fmtDuration(u.total_seconds)}</span>
          <span className="admin-muted"> · today {fmtDuration(u.seconds_today)} · 7d {fmtDuration(u.seconds_7d)} · 30d {fmtDuration(u.seconds_30d)}</span>
        </Detail>
        <Detail label="Visits">
          {fmt(u.days_active)} day{u.days_active === 1 ? "" : "s"} on site
          <span className="admin-muted"> · avg {fmtDuration(u.per_active_day)} a day</span>
        </Detail>
        <Detail label="Games played">
          {fmt(g.total)}
          <span className="admin-muted">
            {" "}
            · {Object.entries(g.by_mode).map(([m, n]) => `${MODE_LABEL[m] ?? m} ${fmt(n)}`).join(" · ") || "none yet"}
          </span>
        </Detail>
        <Detail label="Multiplayer">
          {g.online ? `Yes — ${fmt(g.online)} online game${g.online === 1 ? "" : "s"} (${pct(g.online, g.total)})` : "Never played online"}
        </Detail>
        <Detail label="Time in games">
          {fmtDuration(Math.round(g.game_ms / 1000))}
          <span className="admin-muted"> · last game {ago(g.last_at)}</span>
        </Detail>
        <Detail label="Streak">
          {fmt(a.streak_days)} day{a.streak_days === 1 ? "" : "s"}
          <span className="admin-muted"> · best {fmt(a.streak_best)} · {fmt(a.active_days)} scoring days</span>
        </Detail>
        <Detail label="Friends">
          {fmt(s.friends)}
          <span className="admin-muted"> · {fmt(s.requests_in)} in · {fmt(s.requests_out)} out · blocked {fmt(s.blocking)} · blocked by {fmt(s.blocked_by)}</span>
        </Detail>
        <Detail label="Feedback · reports">
          {fmt(detail.feedback)} · {fmt(detail.question_reports)}
        </Detail>
        <Detail label="Moderation">
          {/* One element whatever the state, so a ban/unban swaps the text instead of snapping (UI-22). */}
          <span className={a.banned_at ? "au-banned" : undefined}>
            <SwapText>
              {a.banned_at
                ? `Banned ${fmtDate(a.banned_at)} (${a.ban_reason || "—"})`
                : `${a.strike_count} strike${a.strike_count === 1 ? "" : "s"}`}
            </SwapText>
          </span>
        </Detail>
      </div>

      <div className="au-panel-chart">
        <TimeBars
          title="Time on site, last 30 days"
          hint="Minutes per day"
          labels={dayLabels}
          values={minutesPerDay}
          format={fmtMinutes}
          unit="on site"
        />
      </div>

      {g.by_game.length > 0 && (
        <>
          <div className="admin-section-label">Games</div>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Game</th>
                  <th>Plays</th>
                  <th>Online</th>
                  <th>Best</th>
                  <th>Average</th>
                  <th>Time</th>
                  <th>Last played</th>
                </tr>
              </thead>
              <tbody>
                {g.by_game.map((row) => (
                  <tr key={row.game}>
                    <td>{gameName(row.game)}</td>
                    <td className="tnum">{fmt(row.plays)}</td>
                    <td className="tnum">{fmt(row.online)}</td>
                    <td className="tnum">{fmt(row.best)}</td>
                    <td className="tnum">{fmt(row.avg)}</td>
                    <td className="tnum">{fmtDuration(Math.round(row.ms / 1000))}</td>
                    <td>{fmtDate(row.last)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="admin-section-label">Recent games</div>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Game</th>
                  <th>Mode</th>
                  <th>Score</th>
                  <th>Points</th>
                  <th>Length</th>
                </tr>
              </thead>
              <tbody>
                {g.recent.map((r, i) => (
                  <tr key={i}>
                    <td>{fmtDateTime(r.at)}</td>
                    <td>{gameName(r.game)}</td>
                    <td>{MODE_LABEL[r.mode] ?? r.mode}</td>
                    <td className="tnum">{fmt(r.score)}</td>
                    <td className="tnum">{fmt(r.awarded)}</td>
                    <td className="tnum">{fmtDuration(Math.round(r.ms / 1000))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {detail.moderation.length > 0 && (
        <>
          <div className="admin-section-label">Moderation history</div>
          <ul className="admin-config">
            {detail.moderation.map((e, i) => (
              <li key={i}>
                {fmtDateTime(e.at)} — {e.reason} ({e.kind}, {e.tier})
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Portalled: the card body animates with a transform, which would re-anchor a fixed overlay. */}
      {createPortal(
        <AnimatePresence>
          {emailOpen && <EmailModal key="email" to={a.email} name={a.username} onClose={() => setEmailOpen(false)} />}
          {banOpen && (
            <BanModal
              key="ban"
              name={a.username}
              banned={!!a.banned_at}
              busy={banBusy}
              error={banError}
              onConfirm={toggleBan}
              onClose={() => !banBusy && setBanOpen(false)}
            />
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  One row of the list                                                */
/* ------------------------------------------------------------------ */
function UserCard({ row, onRowChange }: { row: UserRow; onRowChange: (r: UserRow) => void }) {
  const [open, setOpen] = useState(false);
  const initials = row.username.slice(0, 2).toUpperCase();

  return (
    <div className={`admin-card surface au-row${open ? " is-open" : ""}`}>
      <button className="au-row-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="au-who">
          <Avatar initials={initials} size={30} src={friendPhotoUrl(row.public_id, row.photo_version)} />
          <span className="au-who-text">
            <span className="au-name">
              {row.username}
              {row.is_admin && <span className="chip au-chip">admin</span>}
              {row.banned && <span className="chip au-chip au-chip-bad">banned</span>}
            </span>
            <span className="fb-row-id">#{row.public_id}</span>
          </span>
        </span>
        <span className="au-cell au-rank">
          {row.rank}
          <span className="admin-muted tnum"> · {fmt(row.points)}</span>
        </span>
        <span className="au-cell tnum" title="Games played (online)">
          {fmt(row.games)}
          {row.online_games > 0 && <span className="admin-muted"> ({fmt(row.online_games)})</span>}
        </span>
        <span className="au-cell tnum" title="Time on site, all time">
          {fmtDuration(row.app_seconds)}
        </span>
        <span className="au-cell">
          <Country code={row.country} />
        </span>
        <span className="au-cell au-dim" title={`Joined ${fmtDateTime(row.date_joined)}`}>
          {fmtDate(row.date_joined)}
        </span>
        <span className="au-cell au-dim" title={fmtDateTime(row.last_seen)}>
          {ago(row.last_seen)}
        </span>
      </button>
      <AutoHeight>
        {open && (
          <motion.div
            className="fb-row-body"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <UserPanel row={row} onRowChange={onRowChange} />
          </motion.div>
        )}
      </AutoHeight>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab                                                                */
/* ------------------------------------------------------------------ */
export default function UsersTab() {
  const [period, setPeriod] = useState<UsersPeriod>("30d");
  const [overview, setOverview] = useState<UsersOverview | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);

  const [query, setQuery] = useState<UsersQuery>(EMPTY_QUERY);
  const [rows, setRows] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setOverviewLoading(true);
    fetchOverview(period, controller.signal)
      .then((o) => {
        setOverview(o);
        setOverviewError(null);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setOverviewError(e instanceof Error ? e.message : "Could not load the overview");
      })
      .finally(() => {
        if (!controller.signal.aborted) setOverviewLoading(false);
      });
    return () => controller.abort();
  }, [period]);

  // Bumped by every new query: a "Load more" page that lands after the query changed is dropped.
  const queryVersion = useRef(0);
  // The chart click handlers read the current filter from here, so they keep one identity and the
  // charts are not rebuilt on every keystroke.
  const queryRef = useRef(query);
  queryRef.current = query;

  useEffect(() => {
    const controller = new AbortController();
    queryVersion.current += 1;
    setListLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const page = await fetchUsers(query, 0, PAGE_SIZE, controller.signal);
        setRows(page.rows);
        setTotal(page.total);
        setListError(null);
      } catch (e) {
        if (!controller.signal.aborted) setListError(e instanceof Error ? e.message : "Could not load players");
      } finally {
        if (!controller.signal.aborted) setListLoading(false);
      }
    }, query.q ? 350 : 0);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  const patch = useCallback((next: Partial<UsersQuery>) => setQuery((q) => ({ ...q, ...next })), []);

  async function loadMore() {
    const version = queryVersion.current;
    setLoadingMore(true);
    try {
      const page = await fetchUsers(query, rows.length, PAGE_SIZE);
      if (version !== queryVersion.current) return;
      // Live sorts (time, last seen) can shift a row across the page boundary: never list it twice.
      setRows((prev) => {
        const seen = new Set(prev.map((r) => r.public_id));
        return [...prev, ...page.rows.filter((r) => !seen.has(r.public_id))];
      });
      setTotal(page.total);
    } catch {
      /* the button stays, so it can simply be pressed again */
    } finally {
      setLoadingMore(false);
    }
  }

  const pickRank = useCallback(
    (rank: string) => patch({ rank: queryRef.current.rank === rank ? "" : rank }),
    [patch],
  );
  const pickCountry = useCallback(
    (country: string) => country && patch({ country: queryRef.current.country === country ? "" : country }),
    [patch],
  );
  const pickPlayer = useCallback((id: string) => patch({ q: id }), [patch]);

  const replaceRow = useCallback((updated: UserRow) => {
    setRows((prev) => prev.map((r) => (r.public_id === updated.public_id ? updated : r)));
  }, []);

  const series = useMemo(() => overview?.series.buckets ?? [], [overview]);
  const labels = useMemo(() => series.map((b) => b.label), [series]);
  const activeValues = useMemo(() => series.map((b) => b.active_players), [series]);
  const hourValues = useMemo(() => series.map((b) => hours(b.seconds)), [series]);
  const signupValues = useMemo(() => series.map((b) => b.signups), [series]);
  const gameValues = useMemo(() => series.map((b) => b.games), [series]);
  const rankItems = useMemo(
    () => (overview?.ranks ?? []).map((r) => ({ key: r.rank, label: r.rank, value: r.count })),
    [overview],
  );
  const countryItems = useMemo(
    () =>
      (overview?.countries ?? []).slice(0, 12).map((c) => ({
        key: c.country,
        label: countryName(c.country),
        value: c.players,
      })),
    [overview],
  );
  const gameItems = useMemo(
    () => (overview?.by_game ?? []).slice(0, 12).map((g) => ({ key: g.game, label: gameName(g.game), value: g.plays })),
    [overview],
  );
  const topTimeItems = useMemo(
    () =>
      (overview?.top_time ?? []).map((t) => ({ key: t.public_id, label: `${t.username} #${t.public_id}`, value: hours(t.seconds) })),
    [overview],
  );

  const activeFilters = [
    query.rank && { key: "rank", label: `Rank: ${query.rank}`, clear: () => patch({ rank: "" }) },
    query.country && { key: "country", label: `Country: ${countryName(query.country)}`, clear: () => patch({ country: "" }) },
  ].filter(Boolean) as { key: string; label: string; clear: () => void }[];

  const gran = overview?.series.granularity ?? "day";
  const o = overview;

  return (
    <div className="fb-tab">
      <div className="fb-filters surface">
        <div className="fb-filter-main">
          <div className="fb-period" role="group" aria-label="Period">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                className={`fb-pill${period === p.key ? " is-active" : ""}`}
                onClick={() => setPeriod(p.key)}
              >
                {p.label}
              </button>
            ))}
          </div>
          {/* Always mounted: the note fades in once known rather than popping into the bar. */}
          <span className="admin-muted au-tracked">
            <SwapText>{o?.time.tracked_since ? `Time on site tracked since ${fmtDate(o.time.tracked_since)}` : " "}</SwapText>
          </span>
        </div>
      </div>

      {overviewError && <div className="admin-error">{overviewError}</div>}

      <AutoHeight>
        {!o ? (
          <div className="admin-loading">
            <CourtLoader label="Loading players…" scale={0.7} />
          </div>
        ) : (
          <div className={`fb-content${overviewLoading ? " is-stale" : ""}`}>
            <div className="fb-stats">
              <StatTile
                label="Players"
                value={fmt(o.users.total)}
                sub={<span className="admin-muted">+{fmt(o.users.new)} new in this period · {fmt(o.users.google)} via Google</span>}
              />
              <StatTile
                label="Active players"
                value={fmt(o.active.period)}
                sub={<span className="admin-muted">today {fmt(o.active.today)} · 7d {fmt(o.active.week)} · 30d {fmt(o.active.month)}</span>}
              />
              <StatTile
                label="Time on site"
                value={fmtDuration(o.time.period_seconds)}
                sub={<span className="admin-muted">all time {fmtDuration(o.time.all_time_seconds)}</span>}
              />
              <StatTile
                label="Per active player"
                value={fmtDuration(o.time.per_active_player)}
                sub={<span className="admin-muted">avg visit day {fmtDuration(o.time.per_active_day)}</span>}
              />
              <StatTile
                label="Games played"
                value={fmt(o.games.total)}
                sub={<span className="admin-muted">{fmt(o.games.signed_in)} signed in · {fmt(o.games.guests)} guests</span>}
              />
              <StatTile
                label="Multiplayer"
                value={pct(o.games.online_players, o.games.players)}
                sub={
                  <span className="admin-muted">
                    of players who played went online · {fmt(o.games.online)} online games
                  </span>
                }
              />
              <StatTile
                label="Banned"
                value={fmt(o.users.banned)}
                sub={<span className="admin-muted">{fmt(o.users.admins)} admin{o.users.admins === 1 ? "" : "s"}</span>}
              />
            </div>

            <div className="fb-charts">
              <TimeBars title="Active players" hint={`By ${gran}`} labels={labels} values={activeValues} unit="players" />
              <TimeBars
                title="Time on site"
                hint={`Hours by ${gran}`}
                labels={labels}
                values={hourValues}
                format={fmtHours}
                unit="on site"
              />
              <TimeBars title="Sign-ups" hint={`By ${gran}`} labels={labels} values={signupValues} unit="new players" />
              <TimeBars title="Games played" hint={`By ${gran}, guests included`} labels={labels} values={gameValues} unit="games" />
              <ListBars
                title="Players by rank"
                hint="Click a rank to list its players"
                items={rankItems}
                unit="players"
                onPick={pickRank}
              />
              <ListBars
                title="Where players play from"
                hint="Active players in this period · click to filter"
                items={countryItems}
                unit="players"
                onPick={pickCountry}
              />
              <ListBars title="Most played games" hint="Plays in this period" items={gameItems} unit="plays" />
              <ListBars
                title="Most time on site"
                hint="Hours in this period · click to find"
                items={topTimeItems}
                format={fmtHours}
                unit="on site"
                onPick={pickPlayer}
              />
            </div>
          </div>
        )}
      </AutoHeight>

      <div className="admin-section-label au-list-label">
        <SwapText swapKey={listLoading ? "loading" : total}>{listLoading ? "Loading players…" : `${fmt(total)} player${total === 1 ? "" : "s"}`}</SwapText>
      </div>

      <div className="fb-filters surface">
        <div className="fb-filter-main">
          <div className="fb-search">
            <Field
              search
              value={query.q}
              onChange={(e) => patch({ q: e.target.value })}
              placeholder="Search name, #ID or email…"
              aria-label="Search players"
            />
          </div>
          <Select
            className="fb-select"
            value={query.filter}
            onChange={(filter) => patch({ filter })}
            aria-label="Show"
            options={FILTERS}
          />
          <Select className="fb-select" value={query.sort} onChange={(sort) => patch({ sort })} aria-label="Sort" options={SORTS} />
          {activeFilters.map((f) => (
            <button key={f.key} className="fb-pill is-active" onClick={f.clear} aria-label={`Remove filter ${f.label}`}>
              {f.label} ✕
            </button>
          ))}
          {(query.q || query.filter !== "all" || activeFilters.length > 0) && (
            <button className="fb-pill fb-clear" onClick={() => setQuery({ ...EMPTY_QUERY, sort: query.sort })}>
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="au-list-head" aria-hidden="true">
        <span>Player</span>
        <span>Rank · pts</span>
        <span>Games (online)</span>
        <span>Time on site</span>
        <span>Country</span>
        <span>Joined</span>
        <span>Last seen</span>
      </div>

      {/* Filtering, Load more and the empty/error states resize the list smoothly (UI-23). */}
      <AutoHeight>
        {listError ? (
          <div className="admin-error">{listError}</div>
        ) : (
          <div className={`admin-list fb-content${listLoading ? " is-stale" : ""}`}>
            {rows.map((r) => (
              <UserCard key={r.public_id} row={r} onRowChange={replaceRow} />
            ))}
            {rows.length === 0 && !listLoading && <div className="admin-empty">No players match.</div>}
          </div>
        )}
      </AutoHeight>

      {rows.length < total && (
        <div className="admin-rows-foot">
          <button className="btn btn-secondary btn-sm" onClick={loadMore} disabled={loadingMore}>
            <SwapText
              swapKey={loadingMore ? "loading" : "more"}
              reserveWidth={["Loading…", `Load more (${fmt(total - rows.length)} left)`]}
            >
              {loadingMore ? "Loading…" : `Load more (${fmt(total - rows.length)} left)`}
            </SwapText>
          </button>
        </div>
      )}
    </div>
  );
}
