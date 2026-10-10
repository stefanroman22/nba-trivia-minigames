"use client";
import { useState } from "react";
import { LEGAL } from "../configurations/legal";
import { SITE_NAME, SITE_URL } from "../configurations/site";
import { Button } from "./ui";
import SwapText from "./motion/SwapText";
import { showErrorAlert } from "../utils/Alerts";

type Block =
  | { k: "h"; t: string }
  | { k: "p"; t: string; bold?: boolean }
  | { k: "li"; t: string }
  | { k: "table"; head: string[]; rows: string[][] };

// The PDF's standard fonts cover Windows-1252 only; map the few other characters the policies use.
const WIN_EXTRAS = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");
const SUBST: Record<string, string> = { "→": "->", "←": "<-", "≤": "<=", "≥": ">=", "ă": "a", "Ă": "A", "ș": "s", "Ș": "S", "ț": "t", "Ț": "T", " ": " " };
const pdfText = (s: string) =>
  [...s].map((c) => SUBST[c] ?? (c.charCodeAt(0) <= 255 || WIN_EXTRAS.has(c) ? c : "?")).join("");
const flat = (s: string) => pdfText(s.replace(/\s+/g, " ").trim());

/** Read the rendered policy (the page is the single source of truth, so the PDF can't drift). */
function readBlocks(root: Element): Block[] {
  const out: Block[] = [];
  const walk = (el: Element) => {
    for (const child of Array.from(el.children)) {
      const tag = child.tagName;
      if (/^H[1-4]$/.test(tag)) out.push({ k: "h", t: flat(child.textContent || "") });
      else if (tag === "P") {
        const t = flat((child as HTMLElement).innerText);
        // A paragraph that is only a <strong> (e.g. "The short version.") stays bold in the PDF.
        const bold = child.children.length === 1 && child.firstElementChild?.tagName === "STRONG" && flat(child.firstElementChild.textContent || "") === t;
        if (t) out.push({ k: "p", t, bold });
      }
      else if (tag === "UL" || tag === "OL") {
        for (const li of Array.from(child.children)) out.push({ k: "li", t: flat((li as HTMLElement).innerText) });
      } else if (tag === "TABLE") {
        const head = Array.from(child.querySelectorAll("thead th")).map((th) => flat(th.textContent || ""));
        const rows = Array.from(child.querySelectorAll("tbody tr")).map((tr) =>
          Array.from(tr.children).map((td) => flat(td.textContent || "")));
        out.push({ k: "table", head, rows });
      } else if (tag === "ADDRESS") {
        const lines = (child as HTMLElement).innerText.split("\n").map(flat).filter(Boolean);
        out.push({ k: "p", t: lines.join("\n") });
      } else if (child.children.length) walk(child);
      else { const t = flat(child.textContent || ""); if (t) out.push({ k: "p", t }); }
    }
  };
  walk(root);
  return out;
}

async function logoDataUrl(): Promise<string | null> {
  try {
    const blob = await (await fetch("/icon-192.png")).blob();
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(typeof r.result === "string" ? r.result : null);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

const BRAND: [number, number, number] = [255, 106, 26];
const INK: [number, number, number] = [26, 23, 20];
const MUTED: [number, number, number] = [108, 104, 95];

/** Build a branded, text-based A4 PDF of the policy on this page and download it. */
async function buildPdf(title: string, path: string) {
  const root = document.querySelector("[data-legal-content]");
  if (!root) throw new Error("no legal content on the page");
  const blocks = readBlocks(root);
  const [{ jsPDF }, { default: autoTable }, logo] = await Promise.all([import("jspdf"), import("jspdf-autotable"), logoDataUrl()]);

  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const L = 18, R = W - 18, TOP = 30, BOTTOM = H - 18, TW = R - L;
  const url = `${SITE_URL}${path}`;
  const downloaded = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const lh = (pt: number) => pt * 0.3528 * 1.42;
  let y = TOP;

  const ensure = (h: number) => { if (y + h > BOTTOM) { doc.addPage(); y = TOP; } };
  const write = (text: string, pt: number, opts: { bold?: boolean; color?: [number, number, number]; x?: number; width?: number; after?: number } = {}) => {
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(pt);
    doc.setTextColor(...(opts.color ?? INK));
    const lines: string[] = doc.splitTextToSize(text, opts.width ?? TW);
    for (const line of lines) {
      ensure(lh(pt));
      doc.text(line, opts.x ?? L, y + lh(pt) * 0.72);
      y += lh(pt);
    }
    y += opts.after ?? 0;
  };

  // Title block: what this document is, whose it is, which version, and where the live copy lives.
  write(pdfText(title), 21, { bold: true, after: 2 });
  write(pdfText(`Version ${LEGAL.version}  ·  Last updated ${LEGAL.updated}`), 9.5, { color: MUTED, after: 3 });
  const operator = [LEGAL.operatorName, LEGAL.operatorAddress].filter(Boolean).join(", ");
  if (operator) write(pdfText(`Operator: ${operator}`), 9.5, { after: 0.5 });
  write(pdfText(`Contact: ${LEGAL.contactEmail}`), 9.5, { after: 0.5 });
  write(pdfText(`Official copy of ${url}, downloaded ${downloaded}. The online version is the current one.`), 8.5, { color: MUTED, after: 4 });
  doc.setDrawColor(225, 222, 216);
  doc.setLineWidth(0.3);
  doc.line(L, y, R, y);
  y += 5;

  for (const b of blocks) {
    if (b.k === "h") {
      ensure(lh(12.5) + lh(9.8) * 2);
      y += 2.5;
      write(b.t, 12.5, { bold: true, after: 1.5 });
    } else if (b.k === "p") {
      write(b.t, 9.8, { bold: b.bold, after: 2.4 });
    } else if (b.k === "li") {
      ensure(lh(9.8));
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.8);
      doc.setTextColor(...BRAND);
      doc.text("•", L + 1, y + lh(9.8) * 0.72);
      write(b.t, 9.8, { x: L + 5, width: TW - 5, after: 1.4 });
    } else {
      autoTable(doc, {
        head: b.head.length ? [b.head] : undefined,
        body: b.rows,
        startY: y,
        margin: { left: L, right: W - R, top: TOP, bottom: H - BOTTOM },
        theme: "grid",
        styles: { font: "helvetica", fontSize: 8.4, cellPadding: 1.8, textColor: INK, lineColor: [225, 222, 216], lineWidth: 0.2, valign: "top", overflow: "linebreak" },
        headStyles: { fillColor: BRAND, textColor: 255, fontStyle: "bold" },
        alternateRowStyles: { fillColor: [250, 248, 245] },
      });
      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;
    }
  }

  // Letterhead and footer on every page, once the page count is known.
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    if (logo) doc.addImage(logo, "PNG", L, 9, 10, 10);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11.5);
    doc.setTextColor(...INK);
    doc.text(SITE_NAME, L + (logo ? 13 : 0), 14.2);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text("NBA trivia games", L + (logo ? 13 : 0), 18);
    doc.setFontSize(9);
    doc.text(pdfText(title), R, 15, { align: "right" });
    doc.setDrawColor(...BRAND);
    doc.setLineWidth(0.6);
    doc.line(L, 22, R, 22);

    doc.setDrawColor(225, 222, 216);
    doc.setLineWidth(0.2);
    doc.line(L, H - 12.5, R, H - 12.5);
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(pdfText(`${url.replace(/^https?:\/\//, "")}  ·  Version ${LEGAL.version}  ·  Downloaded ${downloaded}`), L, H - 8);
    doc.text(`Page ${i} of ${pages}`, R, H - 8, { align: "right" });
  }

  doc.setProperties({
    title: `${title} | ${SITE_NAME}`,
    subject: `${SITE_NAME} ${title}, version ${LEGAL.version} (last updated ${LEGAL.updated})`,
    author: LEGAL.operatorName || SITE_NAME,
    keywords: `${SITE_NAME}, ${title}, ${url}`,
    creator: `${SITE_NAME} (${SITE_URL.replace(/^https?:\/\//, "")})`,
  });
  doc.setLanguage("en-GB");
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  doc.save(`swish-quest-${slug}-v${LEGAL.version}.pdf`);
}

/** "Download as PDF" at the end of a legal page. The PDF code loads only when clicked. */
export default function LegalPdfButton({ title, path }: { title: string; path: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const onClick = async () => {
    if (state === "busy") return;
    setState("busy");
    try {
      await buildPdf(title, path);
      setState("done");
      window.setTimeout(() => setState("idle"), 2200);
    } catch (err) {
      console.error("PDF export failed:", err);
      setState("idle");
      showErrorAlert("We couldn't build the PDF. Please try again.", "Download failed");
    }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.5rem", marginTop: "2.5rem", paddingTop: "1.5rem", borderTop: "1px solid var(--line)" }}>
      <Button variant="secondary" onClick={onClick} disabled={state === "busy"}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
        <SwapText reserveWidth={["Download as PDF", "Preparing PDF…", "Downloaded"]}>
          {state === "busy" ? "Preparing PDF…" : state === "done" ? "Downloaded" : "Download as PDF"}
        </SwapText>
      </Button>
      <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Version {LEGAL.version}, with the operator&apos;s details and the date of download.</span>
    </div>
  );
}
