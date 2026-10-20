/**
 * Charts for the admin Users tab. Same rules and palette as the Feedback tab (FeedbackCharts):
 * every chart is ONE series in the validated brand orange, so no legend and no categorical
 * palette is needed; measures with different scales (players, hours, games) are separate charts,
 * never a second y-axis. Horizontal bars carry visible value labels.
 */
import { useMemo } from "react";
import { Bar } from "react-chartjs-2";
import { BarElement, CategoryScale, Chart as ChartJS, LinearScale, Tooltip, type ChartOptions, type Plugin } from "chart.js";
import { ChartFrame } from "./FeedbackCharts";
import { VIZ, VIZ_FONT } from "./vizPalette";

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip);

const tooltip = {
  backgroundColor: VIZ.tooltipBg,
  borderColor: VIZ.tooltipBorder,
  borderWidth: 1,
  titleColor: VIZ.ink,
  bodyColor: VIZ.muted,
  padding: 10,
  cornerRadius: 8,
  displayColors: false,
  titleFont: { ...VIZ_FONT, size: 12, weight: 700 as const },
  bodyFont: VIZ_FONT,
};
const ticks = { color: VIZ.muted, font: VIZ_FONT };
/** Module-level so the default never changes identity: a new formatter would rebuild the chart. */
const fmtCount = (v: number) => v.toLocaleString();

/** Value at the end of each horizontal bar, formatted by the chart's own formatter. */
function endLabels(format: (v: number) => string): Plugin<"bar"> {
  return {
    id: "usersEndLabels",
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      const meta = chart.getDatasetMeta(0);
      const values = chart.data.datasets[0].data as number[];
      ctx.save();
      ctx.font = `600 11px ${VIZ_FONT.family}`;
      ctx.fillStyle = VIZ.muted;
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      meta.data.forEach((bar, i) => {
        if (values[i] != null) ctx.fillText(format(values[i]), bar.x + 8, bar.y);
      });
      ctx.restore();
    },
  };
}

/** One measure over time (sign-ups, active players, hours, games). */
export function TimeBars({
  title,
  hint,
  labels,
  values,
  format = fmtCount,
  unit,
}: {
  title: string;
  hint?: string;
  labels: string[];
  values: number[];
  format?: (v: number) => string;
  unit: string;
}) {
  const data = useMemo(
    () => ({
      labels,
      datasets: [
        {
          label: title,
          data: values,
          backgroundColor: VIZ.series,
          hoverBackgroundColor: VIZ.seriesHover,
          borderRadius: 4,
          borderSkipped: "start" as const,
          barPercentage: 0.72,
          categoryPercentage: 0.86,
          maxBarThickness: 40,
        },
      ],
    }),
    [labels, values, title],
  );
  const options = useMemo<ChartOptions<"bar">>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { ...tooltip, callbacks: { label: (ctx) => `${format(ctx.parsed.y ?? 0)} ${unit}` } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { ...ticks, maxRotation: 0, autoSkipPadding: 12 } },
        y: {
          beginAtZero: true,
          grid: { color: VIZ.grid },
          ticks: { ...ticks, precision: 0, callback: (v) => format(Number(v)) },
          border: { display: false },
        },
      },
    }),
    [format, unit],
  );
  return (
    <ChartFrame title={title} hint={hint} height={220}>
      <Bar data={data} options={options} />
    </ChartFrame>
  );
}

/** A ranked list as horizontal bars (ranks, countries, games). */
export function ListBars({
  title,
  hint,
  items,
  format = fmtCount,
  unit,
  onPick,
}: {
  title: string;
  hint?: string;
  items: { label: string; value: number; key: string }[];
  format?: (v: number) => string;
  unit: string;
  onPick?: (key: string) => void;
}) {
  const data = useMemo(
    () => ({
      labels: items.map((i) => i.label),
      datasets: [
        {
          label: title,
          data: items.map((i) => i.value),
          backgroundColor: VIZ.series,
          hoverBackgroundColor: VIZ.seriesHover,
          borderRadius: 4,
          borderSkipped: "start" as const,
          barPercentage: 0.7,
          categoryPercentage: 0.86,
          maxBarThickness: 22,
        },
      ],
    }),
    [items, title],
  );
  const plugins = useMemo(() => [endLabels(format)], [format]);
  const max = Math.max(1, ...items.map((i) => i.value));
  const options = useMemo<ChartOptions<"bar">>(
    () => ({
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      // Room on the right for the end labels.
      layout: { padding: { right: 56 } },
      onClick: (_e, els) => {
        const hit = els[0];
        if (hit && onPick) onPick(items[hit.index].key);
      },
      onHover: (event, els) => {
        const target = event.native?.target as HTMLElement | undefined;
        if (target) target.style.cursor = els.length && onPick ? "pointer" : "default";
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...tooltip,
          callbacks: {
            label: (ctx) => `${format(ctx.parsed.x ?? 0)} ${unit}`,
            afterBody: () => (onPick ? "Click to filter the list" : ""),
          },
        },
      },
      scales: {
        x: { display: false, beginAtZero: true, max },
        y: { grid: { display: false }, ticks: { ...ticks, autoSkip: false }, border: { display: false } },
      },
    }),
    [items, format, unit, onPick, max],
  );
  const height = Math.max(120, items.length * 28 + 24);
  return (
    <ChartFrame title={title} hint={hint} height={height}>
      {items.length ? (
        <Bar data={data} options={options} plugins={plugins} />
      ) : (
        <div className="au-chart-empty admin-muted">No data in this period yet.</div>
      )}
    </ChartFrame>
  );
}
