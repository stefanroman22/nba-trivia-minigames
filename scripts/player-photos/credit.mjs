// What /credits shows for a Commons file, from its extmetadata (Artist, Credit, Attribution, AttributionRequired).
// CC licences need the author (or the attribution the licensor asks for) and a link; when Commons names no author
// for a file that requires attribution, the source it gives is credited instead.

/** Plain text of a Commons HTML snippet; Commons' hidden duplicates (display: none) are dropped. */
export const stripHtml = (s) =>
  (s ?? "")
    .replace(/<span[^>]*display:\s*none[^>]*>[\s\S]*?<\/span>/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/** { artist, attribution?, source? } for one file's extmetadata; `override.artist` (credit-overrides.json) is an
 *  author Commons states only in the page text. */
export function creditFields(meta, override = {}) {
  const artist = override.artist || stripHtml(meta.Artist?.value) || "Unknown author";
  const attribution = stripHtml(meta.Attribution?.value);
  if (attribution) return { artist, attribution };
  const source = stripHtml(meta.Credit?.value);
  if (artist === "Unknown author" && meta.AttributionRequired?.value === "true" && source) return { artist, source };
  return { artist };
}
