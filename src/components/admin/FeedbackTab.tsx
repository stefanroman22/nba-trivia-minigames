/**
 * Admin panel → Feedback tab.
 *
 * One filter object drives the stats and the list together, so the charts and
 * the table underneath can never describe different sets of rows. Drilling into
 * a bar is just a filter change with a breadcrumb kept so it can be undone.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { CourtLoader, Field } from "../ui";
import { games as gameCatalog } from "../../utils/GameUtils";
import {
  AvgRatingChart,
  ByGameChart,
  DistributionChart,
  SeriesTable,
  VolumeChart,
} from "./FeedbackCharts";
import {
  EMPTY_FILTERS,
  NO_GAME,
  fetchPage,
  fetchStats,
  updateFeedback,
  type Bucket,
  type FeedbackFilters,
  type FeedbackRow,
  type FeedbackStats,
  type FeedbackStatus,
  type Granularity,
} from "./feedbackApi";

const PAGE_SIZE = 25;

const PERIODS: { key: string; label: string }[] = [
  { key: "all", label: "All time" },
  { key: "12m", label: "12 months" },
  { key: "90d", label: "90 days" },
  { key: "30d", label: "30 days" },
  { key: "7d", label: "7 days" },
];

const SORTS: { key: string; label: string }[] = [
  { key: "newest", label: "Newest first" },
  { key: "oldest", label: "Oldest first" },
  { key: "rating_low", label: "Lowest rated" },
  { key: "rating_high", label: "Highest rated" },
  { key: "usage_high", label: "Most active players" },
];

const STATUSES: FeedbackStatus[] = ["new", "read", "resolved"];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
const fmt = (n: number) => n.toLocaleString();
const plural = (n: number, word: string) => `${fmt(n)} ${word}${n === 1 ? "" : "s"}`;

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

/** `to` is inclusive server-side, so a bucket's exclusive end steps back 1ms. */
const inclusiveEnd = (iso: string) => new Date(new Date(iso).getTime() - 1).toISOString();

function Stars({ n, size = 13 }: { n: number; size?: number }) {
  return (
    <span className="fb-stars-inline" aria-label={`${n} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
          fill={i <= n ? "#f5b301" : "none"} stroke={i <= n ? "#f5b301" : "var(--line2)"}
          strokeWidth="1.8" strokeLinejoin="round">
          <path d="M12 2l2.9 6.3 6.9.7-5.1 4.6 1.4 6.8L12 17.8 5.9 20.4l1.4-6.8L2.2 9l6.9-.7z" />
        </svg>
      ))}
    </span>
  );
}

function Delta({ now, before, suffix = "" }: { now: number | null; before: number | null; suffix?: string }) {
  if (now == null || before == null || before === 0) return null;
  const diff = now - before;
  if (Math.abs(diff) < 0.005) return <span className="fb-delta is-flat">no change</span>;
  const up = diff > 0;
  return (
    <span className={`fb-delta ${up ? "is-up" : "is-down"}`}>
      {up ? "▲" : "▼"} {Math.abs(diff).toFixed(suffix ? 2 : 0)}
      {suffix} vs previous
    </span>
  );
}

function StatTile({
  label,
  value,
  sub,
  children,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="surface fb-stat">
      <span className="fb-stat-label">{label}</span>
      {/* Proportional figures on purpose — tabular digits read loose at this size. */}
      <span className="fb-stat-value font-display">{value}</span>
      {sub && <span className="fb-stat-sub">{sub}</span>}
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  One feedback entry                                                 */
/* ------------------------------------------------------------------ */
function FeedbackCard({ row, onChange }: { row: FeedbackRow; onChange: (r: FeedbackRow) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const email = row.account?.email || row.snapshot.email;
  const name = row.account?.username || row.snapshot.display_name;
  const publicId = row.account?.public_id || row.snapshot.public_id;

  async function setStatus(status: FeedbackStatus) {
    setBusy(true);
    setError(null);
    try {
      onChange(await updateFeedback(row.id, { status }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`admin-card surface fb-row${open ? " is-open" : ""}`}>
      <button className="fb-row-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Stars n={row.rating} />
        <span className="fb-row-msg">
          {row.message || <em className="admin-muted">Rating only — no message</em>}
        </span>
        <span className="fb-row-who">
          {row.is_guest ? (
            <span className="chip fb-chip-guest">Guest</span>
          ) : (
            <>
              <span className="fb-row-name">{name || "Player"}</span>
              {publicId && <span className="fb-row-id">#{publicId}</span>}
            </>
          )}
        </span>
        <span className="fb-row-date">{fmtDateTime(row.created_at)}</span>
        <span className={`fb-status is-${row.status}`}>{row.status}</span>
      </button>

      {open && (
        <motion.div
          className="fb-row-body"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        >
          {row.message && <p className="fb-row-full">{row.message}</p>}

          <div className="fb-detail-grid">
            <div>
              <span className="fb-detail-label">From</span>
              {row.account ? (
                <span className="fb-detail-value">
                  {row.account.username} <span className="fb-row-id">#{row.account.public_id}</span>
                  <span className="admin-muted"> · account #{row.account.id}</span>
                </span>
              ) : row.account_deleted ? (
                <span className="fb-detail-value">
                  {row.snapshot.display_name || "Former player"}{" "}
                  <span className="chip fb-chip-deleted">account deleted</span>
                </span>
              ) : (
                <span className="fb-detail-value admin-muted">Guest — not signed in</span>
              )}
            </div>
            <div>
              <span className="fb-detail-label">Contact</span>
              {email ? (
                <a className="fb-detail-value fb-mail" href={`mailto:${email}?subject=${encodeURIComponent("Your NBA 3VIA feedback")}`}>
                  {email}
                </a>
              ) : (
                <span className="fb-detail-value admin-muted">No address left</span>
              )}
            </div>
            <div>
              <span className="fb-detail-label">Usage</span>
              <span className="fb-detail-value tnum">
                {row.account
                  ? `${fmt(row.sessions)} games · ${fmt(row.account.points)} pts · ${row.account.rank}`
                  : "—"}
              </span>
            </div>
            <div>
              <span className="fb-detail-label">Sent from</span>
              <span className="fb-detail-value">{row.game || row.page || "—"}</span>
            </div>
          </div>

          {error && <p className="admin-error" style={{ marginTop: 10 }}>{error}</p>}

          <div className="fb-row-actions">
            {STATUSES.map((s) => (
              <button
                key={s}
                className={`admin-browse${row.status === s ? " is-current" : ""}`}
                disabled={busy || row.status === s}
                onClick={() => setStatus(s)}
              >
                Mark {s}
              </button>
            ))}
            {email && (
              <a className="admin-browse fb-reply" href={`mailto:${email}?subject=${encodeURIComponent("Your NBA 3VIA feedback")}`}>
                Reply by email
              </a>
            )}
          </div>
        </motion.div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab                                                                */
/* ------------------------------------------------------------------ */
export default function FeedbackTab({ onNewCount }: { onNewCount?: (n: number) => void }) {
  const [filters, setFilters] = useState<FeedbackFilters>(EMPTY_FILTERS);
  const [stats, setStats] = useState<FeedbackStats | null>(null);
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [showTable, setShowTable] = useState(false);
  /** Breadcrumb of the ranges drilled through, so each step can be undone. */
  const [trail, setTrail] = useState<{ label: string; filters: FeedbackFilters }[]>([]);

  // Held in a ref so an inline callback from the caller cannot re-trigger the
  // fetch effect on every render.
  const reportNewCount = useRef(onNewCount);
  reportNewCount.current = onNewCount;

  const patch = useCallback((next: Partial<FeedbackFilters>) => {
    setFilters((f) => ({ ...f, ...next }));
  }, []);

  // Stats + first page move together — one filter set, one view of the data.
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);
    // Debounced only for typing; every other filter applies at once.
    const delay = filters.q ? 350 : 0;
    const timer = window.setTimeout(async () => {
      try {
        const [s, p] = await Promise.all([
          fetchStats(filters, controller.signal),
          fetchPage(filters, 0, PAGE_SIZE, controller.signal),
        ]);
        if (cancelled) return;
        setStats(s);
        setRows(p.rows);
        setTotal(p.total);
        setError(null);
        reportNewCount.current?.(s.all_time.new);
      } catch (e) {
        if (cancelled || controller.signal.aborted) return;
        setError(e instanceof Error ? e.message : "Could not load feedback");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, delay);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [filters]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const p = await fetchPage(filters, rows.length, PAGE_SIZE);
      setRows((prev) => [...prev, ...p.rows]);
      setTotal(p.total);
    } catch {
      /* the foot keeps the previous rows; the button can simply be pressed again */
    } finally {
      setLoadingMore(false);
    }
  }

  const drillInto = useCallback(
    (bucket: Bucket) => {
      if (!stats) return;
      const label = stats.range.period === "custom" ? `${stats.series.granularity} view` : PERIODS.find((p) => p.key === stats.range.period)?.label || "Previous view";
      setTrail((t) => [...t, { label, filters }]);
      patch({
        period: "custom",
        from: bucket.start,
        to: inclusiveEnd(bucket.end),
        granularity: stats.series.drill_into,
      });
    },
    [stats, filters, patch],
  );

  function goBackTo(index: number) {
    const crumb = trail[index];
    setTrail((t) => t.slice(0, index));
    setFilters(crumb.filters);
  }

  function replaceRow(updated: FeedbackRow) {
    // The badge counts rows still sitting in "new", so only a transition into or
    // out of that state moves it — read -> resolved must not decrement it.
    const before = rows.find((r) => r.id === updated.id);
    const delta = Number(updated.status === "new") - Number(before?.status === "new");

    setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    if (delta !== 0) {
      setStats((s) => {
        if (!s) return s;
        const next = Math.max(0, s.all_time.new + delta);
        reportNewCount.current?.(next);
        return { ...s, all_time: { ...s.all_time, new: next } };
      });
    }
  }

  const activeCount = useMemo(() => {
    let n = 0;
    if (filters.ratings.length) n++;
    if (filters.hasMessage) n++;
    if (filters.audience !== "all") n++;
    if (filters.minSessions || filters.maxSessions) n++;
    if (filters.minPoints) n++;
    if (filters.game) n++;
    if (filters.statuses.length) n++;
    if (filters.q.trim()) n++;
    return n;
  }, [filters]);

  function toggleRating(r: number) {
    patch({ ratings: filters.ratings.includes(r) ? filters.ratings.filter((x) => x !== r) : [...filters.ratings, r] });
  }

  function toggleStatus(s: FeedbackStatus) {
    patch({ statuses: filters.statuses.includes(s) ? filters.statuses.filter((x) => x !== s) : [...filters.statuses, s] });
  }

  function reset() {
    setTrail([]);
    setFilters(EMPTY_FILTERS);
  }

  /* ---------------- render ---------------- */
  if (error) return <div className="admin-error">{error}</div>;

  if (!stats && loading)
    return (
      <div className="admin-loading">
        <CourtLoader label="Loading feedback…" scale={0.7} />
      </div>
    );

  if (!stats) return null;

  const t = stats.totals;
  const pct = (n: number) => (t.count ? Math.round((n / t.count) * 100) : 0);
  // "All time" has no preceding window to compare against, so no delta is shown.
  const showDelta = stats.range.period !== "all";

  // Nothing has ever been submitted — say so plainly rather than drawing five
  // empty charts, and confirm that collection is actually live.
  if (stats.all_time.count === 0) {
    return (
      <div className="surface admin-placeholder fb-empty">
        <span className="font-display admin-placeholder-title">No feedback yet</span>
        <p className="admin-muted" style={{ maxWidth: 460 }}>
          Ratings submitted from the in-app feedback form land here — with the sender's account
          and email attached whenever they were signed in. Charts and filters appear as soon as
          the first one arrives.
        </p>
        <span className="chip chip-brand">Collection is live</span>
      </div>
    );
  }

  return (
    <div className="fb-tab">
      {/* One filter row above everything it scopes. */}
      <div className="fb-filters surface">
        <div className="fb-filter-main">
          <div className="fb-period" role="group" aria-label="Period">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                className={`fb-pill${filters.period === p.key ? " is-active" : ""}`}
                onClick={() => {
                  setTrail([]);
                  patch({ period: p.key, from: undefined, to: undefined, granularity: undefined });
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="fb-search">
            <Field
              search
              value={filters.q}
              onChange={(e) => patch({ q: e.target.value })}
              placeholder="Search messages, names or emails…"
              aria-label="Search feedback"
            />
          </div>

          <select className="fb-select" value={filters.sort} onChange={(e) => patch({ sort: e.target.value })} aria-label="Sort">
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>

          <button className={`fb-pill${showFilters ? " is-active" : ""}`} onClick={() => setShowFilters((v) => !v)}>
            Filters{activeCount ? ` (${activeCount})` : ""}
          </button>
          {(activeCount > 0 || filters.period !== "all" || trail.length > 0) && (
            <button className="fb-pill fb-clear" onClick={reset}>Clear</button>
          )}
        </div>

        {showFilters && (
          <motion.div
            className="fb-filter-more"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
          >
            <div className="fb-filter-group is-wide">
              <span className="fb-filter-label">Rating</span>
              <div className="fb-inline">
                {[1, 2, 3, 4, 5].map((r) => (
                  <button
                    key={r}
                    className={`fb-pill fb-pill-sm${filters.ratings.includes(r) ? " is-active" : ""}`}
                    onClick={() => toggleRating(r)}
                  >
                    {r}★
                  </button>
                ))}
              </div>
            </div>

            <div className="fb-filter-group">
              <span className="fb-filter-label">Status</span>
              <div className="fb-inline">
                {STATUSES.map((s) => (
                  <button
                    key={s}
                    className={`fb-pill fb-pill-sm${filters.statuses.includes(s) ? " is-active" : ""}`}
                    onClick={() => toggleStatus(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div className="fb-filter-group">
              <span className="fb-filter-label">Sender</span>
              <select
                className="fb-select"
                value={filters.audience}
                onChange={(e) => patch({ audience: e.target.value as FeedbackFilters["audience"] })}
              >
                <option value="all">Everyone</option>
                <option value="registered">Signed-in players</option>
                <option value="guest">Guests</option>
              </select>
            </div>

            <div className="fb-filter-group">
              <span className="fb-filter-label">Message</span>
              <select
                className="fb-select"
                value={filters.hasMessage}
                onChange={(e) => patch({ hasMessage: e.target.value as FeedbackFilters["hasMessage"] })}
              >
                <option value="">Any</option>
                <option value="true">With a message</option>
                <option value="false">Rating only</option>
              </select>
            </div>

            <div className="fb-filter-group">
              <span className="fb-filter-label">Games played</span>
              <div className="fb-inline">
                <input
                  className="fb-num" type="number" min={0} placeholder="min"
                  value={filters.minSessions} onChange={(e) => patch({ minSessions: e.target.value })}
                  aria-label="Minimum games played"
                />
                <span className="admin-muted">–</span>
                <input
                  className="fb-num" type="number" min={0} placeholder="max"
                  value={filters.maxSessions} onChange={(e) => patch({ maxSessions: e.target.value })}
                  aria-label="Maximum games played"
                />
              </div>
            </div>

            <div className="fb-filter-group">
              <span className="fb-filter-label">Min points</span>
              <input
                className="fb-num" type="number" min={0} placeholder="any"
                value={filters.minPoints} onChange={(e) => patch({ minPoints: e.target.value })}
                aria-label="Minimum points"
              />
            </div>

            <div className="fb-filter-group">
              <span className="fb-filter-label">Game</span>
              <select className="fb-select" value={filters.game} onChange={(e) => patch({ game: e.target.value })}>
                <option value="">All games</option>
                <option value={NO_GAME}>(no game — sent from another screen)</option>
                {gameCatalog.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </div>

            <div className="fb-filter-group is-wide">
              <span className="fb-filter-label">Custom range</span>
              <div className="fb-inline">
                <input
                  className="fb-num fb-date" type="date"
                  value={(filters.from || "").slice(0, 10)}
                  onChange={(e) => patch({ period: "custom", from: e.target.value, granularity: undefined })}
                  aria-label="From date"
                />
                <span className="admin-muted">–</span>
                <input
                  className="fb-num fb-date" type="date"
                  value={(filters.to || "").slice(0, 10)}
                  onChange={(e) => patch({ period: "custom", to: e.target.value, granularity: undefined })}
                  aria-label="To date"
                />
              </div>
            </div>
          </motion.div>
        )}
      </div>

      {trail.length > 0 && (
        <div className="fb-trail">
          {trail.map((c, i) => (
            <button key={i} className="fb-crumb" onClick={() => goBackTo(i)}>
              ← {c.label}
            </button>
          ))}
          <span className="fb-crumb is-current">
            {stats.series.buckets.length} {stats.series.granularity} buckets
          </span>
        </div>
      )}

      {/* Previous render is held at reduced opacity on refetch — no skeleton flash. */}
      <div className={`fb-content${loading ? " is-stale" : ""}`}>
        <div className="fb-stats">
          <StatTile
            label="Total feedback"
            value={fmt(t.count)}
            sub={showDelta && <Delta now={t.count} before={stats.previous.count} />}
          />
          <StatTile
            label="Average rating"
            value={t.avg_rating == null ? "—" : t.avg_rating.toFixed(2)}
            sub={showDelta && <Delta now={t.avg_rating} before={stats.previous.avg_rating} suffix="★" />}
          >
            {t.avg_rating != null && <Stars n={Math.round(t.avg_rating)} size={12} />}
          </StatTile>
          <StatTile
            label="Left a message"
            value={`${pct(t.with_message)}%`}
            sub={<span className="admin-muted">{fmt(t.with_message)} of {fmt(t.count)}</span>}
          />
          <StatTile
            label="From signed-in players"
            value={`${pct(t.registered)}%`}
            sub={<span className="admin-muted">{plural(t.registered, "player")} · {plural(t.guests, "guest")}</span>}
          >
            <div className="fb-split" role="img" aria-label={`${pct(t.registered)}% from signed-in players`}>
              <span style={{ width: `${pct(t.registered)}%` }} />
            </div>
          </StatTile>
          <StatTile
            label="Needs attention"
            value={fmt(t.unresolved)}
            sub={<span className="admin-muted">{fmt(t.detractors)} rated 1–2★</span>}
          />
        </div>

        <div className="fb-charts">
          <VolumeChart
            buckets={stats.series.buckets}
            granularity={stats.series.granularity}
            onDrill={stats.series.granularity === "day" ? undefined : drillInto}
          />
          <AvgRatingChart buckets={stats.series.buckets} granularity={stats.series.granularity} />
          <DistributionChart
            distribution={stats.distribution}
            total={t.count}
            onPick={(r) => patch({ ratings: filters.ratings.includes(r) ? [] : [r] })}
          />
          {stats.by_game.length > 0 && (
            <ByGameChart byGame={stats.by_game} onPick={(g) => patch({ game: g === filters.game ? "" : g })} />
          )}
        </div>

        <div className="fb-granularity">
          <span className="admin-muted">Group by</span>
          {(["day", "week", "month", "year"] as Granularity[]).map((g) => (
            <button
              key={g}
              className={`fb-pill fb-pill-sm${stats.series.granularity === g ? " is-active" : ""}`}
              onClick={() => patch({ granularity: g })}
            >
              {g}
            </button>
          ))}
          <button className={`fb-pill fb-pill-sm${showTable ? " is-active" : ""}`} onClick={() => setShowTable((v) => !v)}>
            {showTable ? "Hide table" : "Table view"}
          </button>
        </div>

        {showTable && <SeriesTable buckets={stats.series.buckets} />}

        <div className="admin-section-label">
          {fmt(total)} response{total === 1 ? "" : "s"} in this view
        </div>

        <div className="admin-list">
          {rows.map((r) => (
            <FeedbackCard key={r.id} row={r} onChange={replaceRow} />
          ))}
          {rows.length === 0 && !loading && (
            <div className="admin-empty">
              No feedback matches these filters.{" "}
              <button className="fb-linkish" onClick={reset}>Clear them</button>
            </div>
          )}
        </div>

        {rows.length < total && (
          <div className="admin-rows-foot">
            <button className="btn btn-secondary btn-sm" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? "Loading…" : `Load more (${fmt(total - rows.length)} left)`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
