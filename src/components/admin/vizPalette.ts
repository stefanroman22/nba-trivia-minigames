/**
 * Chart palette for the admin Feedback tab.
 *
 * Lives in its own module (rather than beside the chart components) so the
 * components file exports only components — Fast Refresh needs that.
 *
 * `stars` is an ORDINAL ramp: one hue (~43°, the brand orange's own hue),
 * monotone lightness, even steps, validated against this panel's dark surface
 * (#1c1c1e). It encodes the ordered 1★→5★ axis and nothing else — it
 * deliberately does NOT pass as a categorical palette, so it must never be used
 * to colour independent series (five stacked rating bands, say). Its two
 * darkest steps sit below 3:1 against the surface, which is why every chart
 * using it also draws visible value labels.
 */
export const VIZ = {
  /** Single-series accent — the brand orange. */
  series: "#ff6a1a",
  seriesHover: "#ff8a3d",
  /** Validated ordinal ramp, 1★ → 5★: warm gray to brand orange. */
  stars: ["#58514e", "#7f5b4d", "#a86245", "#d36737", "#ff6a1a"],
  ink: "#f5f3ef",
  muted: "#9c9a95",
  grid: "rgba(255, 255, 255, 0.06)",
  surface: "#1c1c1e",
  tooltipBg: "#232327",
  tooltipBorder: "rgba(255, 255, 255, 0.17)",
} as const;

export const VIZ_FONT = { family: "'Chakra Petch', system-ui, sans-serif", size: 11 };
