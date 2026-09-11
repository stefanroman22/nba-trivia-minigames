/**
 * Charts for the admin Feedback tab.
 *
 * Palette note: the 1★→5★ ramp below is an ORDINAL ramp (one hue, monotone
 * lightness, even steps) and was validated against the panel's own dark surface
 * — it deliberately encodes the ordered star axis and nothing else. It does not
 * pass as a categorical palette, so it must never be used for five independent
 * stacked series; that is why sentiment-over-time is drawn as an average line
 * rather than a five-way stack.
 *
 * There is no dual-axis chart here on purpose: volume and average rating have
 * unrelated scales, so aligning them on one plot would invent a correlation.
 * They are two charts sharing one x-axis instead.
 */
import { useMemo } from "react";
import { Bar, Line } from "react-chartjs-2";
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
  type ChartOptions,
  type Plugin,
} from "chart.js";
import type { Bucket, FeedbackStats } from "./feedbackApi";
import { VIZ, VIZ_FONT } from "./vizPalette";

ChartJS.register(BarElement, LineElement, PointElement, CategoryScale, LinearScale, Tooltip);

const FONT = VIZ_FONT;

/** Shared tooltip skin — the panel's surface, not Chart.js's default black. */
const tooltip = {
  backgroundColor: VIZ.tooltipBg,
  borderColor: VIZ.tooltipBorder,
  borderWidth: 1,
  titleColor: VIZ.ink,
  bodyColor: VIZ.muted,
  padding: 10,
  cornerRadius: 8,
  displayColors: false,
  titleFont: { ...FONT, size: 12, weight: 700 as const },
  bodyFont: FONT,
};

const gridX = { display: false };
const gridY = { color: VIZ.grid, drawTicks: false };
const ticks = { color: VIZ.muted, font: FONT };

/** Draws the value at each bar's end. The two darkest ramp steps sit below 3:1
 *  on this surface, so the numbers are the required relief — never colour alone. */
const valueLabels: Plugin<"bar"> = {
  id: "valueLabels",
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    const meta = chart.getDatasetMeta(0);
    const values = chart.data.datasets[0].data as number[];
    ctx.save();
    ctx.font = `600 11px ${FONT.family}`;
    ctx.fillStyle = VIZ.muted;
    ctx.textBaseline = "middle";
    meta.data.forEach((bar, i) => {
      const v = values[i];
      if (v == null) return;
      ctx.textAlign = "left";
      ctx.fillText(String(v), bar.x + 8, bar.y);
    });
    ctx.restore();
  },
};

function ChartFrame({
  title,
  hint,
  children,
  height = 240,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  height?: number;
}) {
  return (
    <div className="surface fb-chart-card">
      <div className="fb-chart-head">
        <span className="fb-chart-title">{title}</span>
        {hint && <span className="fb-chart-hint">{hint}</span>}
      </div>
      <div className="fb-chart-body" style={{ height }}>
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Volume over time — the headline, and the drill-down entry point     */
/* ------------------------------------------------------------------ */
export function VolumeChart({
  buckets,
  granularity,
  onDrill,
}: {
  buckets: Bucket[];
  granularity: string;
  onDrill?: (bucket: Bucket) => void;
}) {
  const data = useMemo(
    () => ({
      labels: buckets.map((b) => b.label),
      datasets: [
        {
          label: "Feedback",
          data: buckets.map((b) => b.count),
          backgroundColor: VIZ.series,
          hoverBackgroundColor: VIZ.seriesHover,
          borderRadius: 4,
          borderSkipped: "start" as const,
          barPercentage: 0.72,
          categoryPercentage: 0.86,
          // Without a cap, a single bucket's bar widens to the whole plot and
          // reads as a block of colour rather than a bar. Thin marks always.
          maxBarThickness: 46,
        },
      ],
    }),
    [buckets],
  );

  const options = useMemo<ChartOptions<"bar">>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      onClick: (_e, elements) => {
        const hit = elements[0];
        if (hit && onDrill) onDrill(buckets[hit.index]);
      },
      onHover: (event, elements) => {
        const target = event.native?.target as HTMLElement | undefined;
        if (target) target.style.cursor = elements.length && onDrill ? "pointer" : "default";
      },
      plugins: {
        legend: { display: false }, // one series — the card title names it
        tooltip: {
          ...tooltip,
          callbacks: {
            label: (ctx) => {
              const b = buckets[ctx.dataIndex];
              const avg = b.avg_rating ? ` · avg ${b.avg_rating.toFixed(2)}★` : "";
              return `${b.count} response${b.count === 1 ? "" : "s"}${avg}`;
            },
            afterBody: () => (onDrill ? "Click to drill in" : ""),
          },
        },
      },
      scales: {
        x: { grid: gridX, ticks: { ...ticks, maxRotation: 0, autoSkipPadding: 12 } },
        y: { beginAtZero: true, grid: gridY, ticks: { ...ticks, precision: 0 }, border: { display: false } },
      },
    }),
    [buckets, onDrill],
  );

  return (
    <ChartFrame
      title="Feedback over time"
      hint={onDrill ? `By ${granularity} · click a bar to go deeper` : `By ${granularity}`}
      height={260}
    >
      <Bar data={data} options={options} />
    </ChartFrame>
  );
}

/* ------------------------------------------------------------------ */
/*  Average rating over time — its own chart, never a second y-axis     */
/* ------------------------------------------------------------------ */
export function AvgRatingChart({ buckets, granularity }: { buckets: Bucket[]; granularity: string }) {
  const data = useMemo(
    () => ({
      labels: buckets.map((b) => b.label),
      datasets: [
        {
          label: "Average rating",
          data: buckets.map((b) => b.avg_rating),
          borderColor: VIZ.series,
          borderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: VIZ.series,
          // A 2px surface ring keeps overlapping points readable.
          pointBorderColor: VIZ.surface,
          pointBorderWidth: 2,
          tension: 0.3,
          // No area fill: a filled region reads as magnitude accumulated from
          // zero, and this scale starts at 1 — the area would mean nothing.
          fill: false,
          spanGaps: true, // a quiet bucket has no average — bridge it, don't plot 0
        },
      ],
    }),
    [buckets],
  );

  const options = useMemo<ChartOptions<"line">>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...tooltip,
          callbacks: {
            label: (ctx) =>
              ctx.parsed.y == null ? "No feedback" : `${Number(ctx.parsed.y).toFixed(2)} ★ average`,
          },
        },
      },
      scales: {
        x: { grid: gridX, ticks: { ...ticks, maxRotation: 0, autoSkipPadding: 12 } },
        y: {
          min: 1,
          max: 5,
          ticks: { ...ticks, stepSize: 1, callback: (v) => `${v}★` },
          grid: gridY,
          border: { display: false },
        },
      },
    }),
    [],
  );

  return (
    <ChartFrame title="Average rating over time" hint={`By ${granularity} · scale 1–5`} height={260}>
      <Line data={data} options={options} />
    </ChartFrame>
  );
}

/* ------------------------------------------------------------------ */
/*  Rating distribution — the ordinal ramp's one legitimate home        */
/* ------------------------------------------------------------------ */
export function DistributionChart({
  distribution,
  total,
  onPick,
}: {
  distribution: { rating: number; count: number }[];
  total: number;
  onPick?: (rating: number) => void;
}) {
  const rows = useMemo(() => [...distribution].reverse(), [distribution]); // 5★ at the top
  const data = useMemo(
    () => ({
      labels: rows.map((r) => `${r.rating}★`),
      datasets: [
        {
          label: "Responses",
          data: rows.map((r) => r.count),
          backgroundColor: rows.map((r) => VIZ.stars[r.rating - 1]),
          borderRadius: 4,
          borderSkipped: "start" as const,
          barPercentage: 0.7,
          categoryPercentage: 0.88,
          maxBarThickness: 26,
        },
      ],
    }),
    [rows],
  );

  const options = useMemo<ChartOptions<"bar">>(
    () => ({
      indexAxis: "y" as const,
      responsive: true,
      maintainAspectRatio: false,
      // Headroom so the value label at the longest bar's end is never clipped.
      layout: { padding: { right: 34 } },
      onClick: (_e, elements) => {
        const hit = elements[0];
        if (hit && onPick) onPick(rows[hit.index].rating);
      },
      onHover: (event, elements) => {
        const target = event.native?.target as HTMLElement | undefined;
        if (target) target.style.cursor = elements.length && onPick ? "pointer" : "default";
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...tooltip,
          callbacks: {
            label: (ctx) => {
              const n = Number(ctx.parsed.x);
              const pct = total ? Math.round((n / total) * 100) : 0;
              return `${n} response${n === 1 ? "" : "s"} · ${pct}% of the total`;
            },
          },
        },
      },
      scales: {
        x: { display: false, beginAtZero: true, grid: { display: false } },
        y: { grid: { display: false }, ticks: { ...ticks, font: { ...FONT, size: 12 } }, border: { display: false } },
      },
    }),
    [rows, total, onPick],
  );

  return (
    <ChartFrame title="Rating breakdown" hint={onPick ? "Click a row to filter" : undefined} height={278}>
      <Bar data={data} options={options} plugins={[valueLabels]} />
    </ChartFrame>
  );
}

/* ------------------------------------------------------------------ */
/*  By game — nominal categories, so one colour for every bar           */
/* ------------------------------------------------------------------ */
export function ByGameChart({
  byGame,
  onPick,
}: {
  byGame: FeedbackStats["by_game"];
  onPick?: (game: string) => void;
}) {
  const rows = useMemo(() => byGame.slice(0, 10), [byGame]);
  const data = useMemo(
    () => ({
      labels: rows.map((r) => r.label),
      datasets: [
        {
          label: "Responses",
          // Nominal categories have no order to encode, so they share one hue.
          data: rows.map((r) => r.count),
          backgroundColor: VIZ.series,
          hoverBackgroundColor: VIZ.seriesHover,
          borderRadius: 4,
          borderSkipped: "start" as const,
          barPercentage: 0.7,
          categoryPercentage: 0.88,
          maxBarThickness: 26,
        },
      ],
    }),
    [rows],
  );

  const options = useMemo<ChartOptions<"bar">>(
    () => ({
      indexAxis: "y" as const,
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { right: 34 } },
      onClick: (_e, elements) => {
        const hit = elements[0];
        if (hit && onPick) onPick(rows[hit.index].game);
      },
      onHover: (event, elements) => {
        const target = event.native?.target as HTMLElement | undefined;
        if (target) target.style.cursor = elements.length && onPick ? "pointer" : "default";
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...tooltip,
          callbacks: {
            label: (ctx) => {
              const r = rows[ctx.dataIndex];
              return `${r.count} response${r.count === 1 ? "" : "s"}${
                r.avg_rating ? ` · avg ${r.avg_rating.toFixed(2)}★` : ""
              }`;
            },
          },
        },
      },
      scales: {
        x: { display: false, beginAtZero: true, grid: { display: false } },
        y: { grid: { display: false }, ticks, border: { display: false } },
      },
    }),
    [rows, onPick],
  );

  return (
    <ChartFrame title="Where it comes from" hint="Feedback by game" height={278}>
      <Bar data={data} options={options} plugins={[valueLabels]} />
    </ChartFrame>
  );
}

/* ------------------------------------------------------------------ */
/*  Table twin — every chart value reachable without reading colour     */
/* ------------------------------------------------------------------ */
export function SeriesTable({ buckets }: { buckets: Bucket[] }) {
  return (
    <div className="surface fb-chart-card">
      <div className="fb-chart-head">
        <span className="fb-chart-title">Table view</span>
        <span className="fb-chart-hint">The same numbers the charts plot</span>
      </div>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Period</th>
              <th>Responses</th>
              <th>Average</th>
              <th>Promoters (4–5★)</th>
              <th>Detractors (1–2★)</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((b) => (
              <tr key={b.start}>
                <td>{b.label}</td>
                <td className="tnum">{b.count}</td>
                <td className="tnum">{b.avg_rating == null ? "—" : b.avg_rating.toFixed(2)}</td>
                <td className="tnum">{b.promoters}</td>
                <td className="tnum">{b.detractors}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
