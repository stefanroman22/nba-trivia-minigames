/**
 * Admin question labeling for one game (Tic-Tac-Toe for now): every active question with its board, the answers
 * each cell accepts, the question factory's own difficulty and how players did, and an Easy / Medium / Hard switch
 * that saves at once. A question nobody labeled yet counts as Hard (the default) and shows "Not reviewed".
 * Keyboard: focus a board and press 1 / 2 / 3 (or E / M / H); the focus moves on to the next board.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Field, Select } from "../ui";
import AutoHeight from "../motion/AutoHeight";
import SegmentedTabs from "../motion/SegmentedTabs";
import SwapText from "../motion/SwapText";
import {
  DIFFICULTIES,
  DIFFICULTY_LABEL,
  fetchQuestions,
  setQuestionLabel,
  type AdminQuestion,
  type Difficulty,
  type QuestionCounts,
  type QuestionFilter,
  type QuestionSort,
} from "./questionsApi";
import "../../styles/AdminQuestions.css";

const PAGE_SIZE = 20;
const KEYS: Record<string, Difficulty> = { "1": "easy", "2": "medium", "3": "hard", e: "easy", m: "medium", h: "hard" };
const SORTS: { value: QuestionSort; label: string }[] = [
  { value: "qid", label: "Question number" },
  { value: "factory", label: "Factory difficulty (easiest first)" },
  { value: "accuracy", label: "Player accuracy (hardest first)" },
  { value: "updated", label: "Recently labeled" },
];

const pct = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)}%`);
const fmt = (n: number) => n.toLocaleString("en-US");
function without<T>(m: Record<number, T>, id: number): Record<number, T> {
  const next = { ...m };
  delete next[id];
  return next;
}

function Board({ q }: { q: AdminQuestion }) {
  const { rows, cols, cells, error } = q.board;
  return (
    <div className="aq-board" role="group" aria-label={`Board ${q.qid}`}>
      <div className="aq-corner" />
      {cols.map((c, i) => (
        <div key={`c${i}`} className="aq-head aq-head--col">{c}</div>
      ))}
      {rows.map((r, ri) => (
        <div key={`r${ri}`} className="aq-row">
          <div className="aq-head aq-head--row">{r}</div>
          {cols.map((c, ci) => {
            const cell = cells?.[ri * 3 + ci];
            return (
              <div key={ci} className="aq-cell" aria-label={`${r} × ${c}`}>
                {cell ? (
                  <>
                    <span className="aq-cell-count tnum">{fmt(cell.count)} answer{cell.count === 1 ? "" : "s"}</span>
                    <span className="aq-cell-top">{cell.top.join(" · ")}</span>
                    {cell.attempts > 0 && (
                      <span className="aq-cell-acc tnum">{pct(cell.accuracy)} right · {fmt(cell.attempts)} guess{cell.attempts === 1 ? "" : "es"}</span>
                    )}
                  </>
                ) : (
                  <span className="aq-cell-top">—</span>
                )}
              </div>
            );
          })}
        </div>
      ))}
      {error && <p className="aq-board-error">Cannot be built from today's player data: {error}</p>}
    </div>
  );
}

function QuestionCard({
  q,
  saving,
  error,
  onLabel,
  onKeyLabel,
}: {
  q: AdminQuestion;
  saving: boolean;
  error: string | null;
  onLabel: (q: AdminQuestion, d: Difficulty) => void;
  onKeyLabel: (e: KeyboardEvent<HTMLElement>, q: AdminQuestion) => void;
}) {
  const options = DIFFICULTIES.map((d) => ({ key: d, label: DIFFICULTY_LABEL[d] }));
  const status = saving ? "Saving…" : q.label.reviewed ? `Labeled ${DIFFICULTY_LABEL[q.label.difficulty]}` : "Not reviewed · Hard by default";
  return (
    <article className={`aq-card${q.label.reviewed ? "" : " is-unreviewed"}`} tabIndex={0} data-qid={q.qid} onKeyDown={(e) => onKeyLabel(e, q)}>
      <header className="aq-card-head">
        <span className="aq-qid tnum">{q.qid}</span>
        <span className="aq-meta">
          Factory: {q.factory.band ? DIFFICULTY_LABEL[q.factory.band] : "—"}
          {q.factory.difficulty != null && <span className="tnum"> ({q.factory.difficulty.toFixed(2)})</span>}
        </span>
        <span className="aq-meta tnum">
          {q.plays.attempts ? `${pct(q.plays.accuracy)} right · ${fmt(q.plays.attempts)} guesses` : "Not played yet"}
        </span>
        <div className="aq-label">
          <SegmentedTabs
            options={options}
            value={q.label.difficulty}
            onChange={(d) => onLabel(q, d)}
            className={`aq-seg aq-seg--${q.label.difficulty}${q.label.reviewed ? "" : " is-default"}`}
            itemClassName="aq-seg-item"
            thumbRadius={7}
            aria-label={`Difficulty of ${q.qid}`}
          />
          <span className={`aq-status${error ? " is-bad" : ""}`} aria-live="polite">
            <SwapText swapKey={error || status}>{error || status}</SwapText>
          </span>
        </div>
      </header>
      <Board q={q} />
    </article>
  );
}

export default function QuestionLabeler({ game, onCounts }: { game: string; onCounts: (c: QuestionCounts) => void }) {
  const [filter, setFilter] = useState<QuestionFilter>("all");
  const [sort, setSort] = useState<QuestionSort>("qid");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<AdminQuestion[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [counts, setCounts] = useState<QuestionCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<Record<number, boolean>>({});
  const [rowError, setRowError] = useState<Record<number, string>>({});
  const listRef = useRef<HTMLDivElement>(null);
  const reqRef = useRef<AbortController | null>(null);

  const applyCounts = useCallback((c: QuestionCounts) => { setCounts(c); onCounts(c); }, [onCounts]);

  const load = useCallback(
    async (offset: number, append: boolean) => {
      reqRef.current?.abort();
      const ctrl = new AbortController();
      reqRef.current = ctrl;
      setLoading(true);
      setError(null);
      try {
        const page = await fetchQuestions({ game, filter, sort, q: query, offset, limit: PAGE_SIZE }, ctrl.signal);
        setTotal(page.total);
        applyCounts(page.counts);
        setRows((prev) => (append ? [...prev, ...page.rows] : page.rows));
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError(e instanceof Error ? e.message : "Could not load the questions");
      } finally {
        if (reqRef.current === ctrl) setLoading(false);
      }
    },
    [game, filter, sort, query, applyCounts],
  );

  // First load, a filter / sort change and a (debounced) search share one effect.
  useEffect(() => {
    const t = window.setTimeout(() => load(0, false), query ? 350 : 0);
    return () => window.clearTimeout(t);
  }, [load, query]);
  useEffect(() => () => reqRef.current?.abort(), []);

  // A labeled board stays where it is (with its new label) until the list is reloaded, so nothing jumps while
  // working through a filtered view.
  const label = useCallback(
    async (q: AdminQuestion, d: Difficulty) => {
      if (saving[q.id] || (q.label.reviewed && q.label.difficulty === d)) return;
      const before = q.label;
      setRows((prev) => prev.map((r) => (r.id === q.id ? { ...r, label: { ...r.label, difficulty: d } } : r)));
      setSaving((s) => ({ ...s, [q.id]: true }));
      setRowError((m) => without(m, q.id));
      try {
        const res = await setQuestionLabel(q.id, d);
        setRows((prev) => prev.map((r) => (r.id === q.id ? { ...r, label: res.label } : r)));
        applyCounts(res.counts);
      } catch (e) {
        setRows((prev) => prev.map((r) => (r.id === q.id ? { ...r, label: before } : r)));
        setRowError((m) => ({ ...m, [q.id]: e instanceof Error ? e.message : "Could not save the label" }));
      } finally {
        setSaving((s) => without(s, q.id));
      }
    },
    [saving, applyCounts],
  );

  const onKeyLabel = useCallback(
    (e: KeyboardEvent<HTMLElement>, q: AdminQuestion) => {
      if (e.target !== e.currentTarget || e.altKey || e.ctrlKey || e.metaKey) return;
      const d = KEYS[e.key.toLowerCase()];
      if (!d) return;
      e.preventDefault();
      label(q, d);
      const cards = [...(listRef.current?.querySelectorAll<HTMLElement>(".aq-card") ?? [])];
      const next = cards[cards.indexOf(e.currentTarget) + 1];
      next?.focus();
      next?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    },
    [label],
  );

  const c = counts;
  const filterOptions: { key: QuestionFilter; label: string }[] = [
    { key: "all", label: `All${c ? ` ${fmt(c.total)}` : ""}` },
    { key: "unreviewed", label: `Not reviewed${c ? ` ${fmt(c.unreviewed)}` : ""}` },
    { key: "easy", label: `Easy${c ? ` ${fmt(c.easy)}` : ""}` },
    { key: "medium", label: `Medium${c ? ` ${fmt(c.medium)}` : ""}` },
    { key: "hard", label: `Hard${c ? ` ${fmt(c.hard)}` : ""}` },
  ];
  const reviewedPct = c && c.total ? (c.reviewed / c.total) * 100 : 0;

  return (
    <div className="aq">
      <div className="aq-progress" aria-label="Labeling progress">
        <div className="aq-progress-line tnum">
          <SwapText swapKey={c ? `${c.reviewed}/${c.total}` : "loading"}>
            {c ? `${fmt(c.reviewed)} of ${fmt(c.total)} questions reviewed` : "Loading questions…"}
          </SwapText>
        </div>
        <div className="aq-progress-track"><div className="aq-progress-fill" style={{ transform: `scaleX(${reviewedPct / 100})` }} /></div>
        <p className="aq-hint">Focus a board and press 1 Easy · 2 Medium · 3 Hard (or E / M / H): it saves and moves to the next board.</p>
      </div>

      <div className="aq-toolbar">
        <SegmentedTabs options={filterOptions} value={filter} onChange={setFilter} className="aq-filter" itemClassName="aq-filter-item" thumbRadius={8} aria-label="Show questions" />
        <div className="aq-toolbar-row">
          <div className="games-search aq-search">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4-4" />
            </svg>
            <Field search value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search a team, criterion or ttt-0042…" aria-label="Search questions" />
          </div>
          <Select value={sort} onChange={(v) => setSort(v as QuestionSort)} options={SORTS} aria-label="Sort questions" className="aq-sort" />
        </div>
      </div>

      <AutoHeight>
        {error ? (
          <div className="admin-error">{error}</div>
        ) : rows.length === 0 && !loading ? (
          <div className="admin-empty">No questions match.</div>
        ) : (
          <div className="aq-list" ref={listRef}>
            {rows.map((q) => (
              <QuestionCard key={q.id} q={q} saving={!!saving[q.id]} error={rowError[q.id] ?? null} onLabel={label} onKeyLabel={onKeyLabel} />
            ))}
          </div>
        )}
      </AutoHeight>

      <div className="admin-rows-foot">
        {loading && <span className="admin-muted">Loading…</span>}
        {!loading && total != null && rows.length < total && (
          <button className="btn btn-secondary btn-sm" onClick={() => load(rows.length, true)}>
            Load more ({fmt(total - rows.length)} left)
          </button>
        )}
      </div>
    </div>
  );
}
