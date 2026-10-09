import type { ReactNode } from "react";
import { LEGAL } from "../configurations/legal";

/** Long-form page for the privacy policy and terms: one readable column on the site's dark theme. */
export default function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main style={{ background: "var(--bg)", color: "var(--text)", minHeight: "100vh", padding: "4rem 1.25rem 5rem" }}>
      <article style={{ maxWidth: 820, margin: "0 auto", lineHeight: 1.7 }}>
        <a href="/" style={{ color: "var(--brand)", fontWeight: 700, textDecoration: "none" }}>← {LEGAL.service}</a>
        <h1 style={{ fontSize: "2.25rem", fontWeight: 800, margin: "1.25rem 0 0.25rem" }}>{title}</h1>
        <p style={{ color: "var(--muted)", marginBottom: "2rem" }}>Last updated {LEGAL.updated}</p>
        <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>{children}</div>
      </article>
    </main>
  );
}

export const LegalHeading = ({ children, id }: { children: ReactNode; id?: string }) => (
  <h2 id={id} style={{ fontSize: "1.3rem", fontWeight: 700, marginTop: "1.5rem", color: "var(--text)" }}>{children}</h2>
);

export const LegalList = ({ children }: { children: ReactNode }) => (
  <ul style={{ paddingLeft: "1.25rem", display: "flex", flexDirection: "column", gap: "0.5rem", listStyle: "disc" }}>{children}</ul>
);

export const MailLink = () => (
  <a href={`mailto:${LEGAL.contactEmail}`} style={{ color: "var(--brand)" }}>{LEGAL.contactEmail}</a>
);

/** The "short version" box at the top of a page. */
export const LegalSummary = ({ children }: { children: ReactNode }) => (
  <div style={{ background: "var(--surface)", border: "1px solid var(--line2)", borderRadius: "var(--radius)", padding: "1rem 1.25rem" }}>
    {children}
  </div>
);

/** Who is behind the service: only the facts that are filled in, plus the contact address. */
export const OperatorBlock = () => (
  <address style={{ fontStyle: "normal", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "1rem 1.25rem" }}>
    <strong>{LEGAL.service}</strong>
    {LEGAL.operatorName && <><br />Operated by {LEGAL.operatorName}</>}
    {LEGAL.operatorAddress && <><br />{LEGAL.operatorAddress}</>}
    <br />Email: <MailLink />
  </address>
);

/** A small responsive table: header cells, then rows of plain strings. */
export const LegalTable = ({ head, rows }: { head: string[]; rows: string[][] }) => (
  <div style={{ overflowX: "auto" }}>
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.92rem" }}>
      <thead>
        <tr>
          {head.map((h) => (
            <th key={h} style={{ textAlign: "left", padding: "0.5rem 0.75rem", borderBottom: "1px solid var(--line2)", color: "var(--muted)", fontWeight: 600 }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row[0]}>
            {row.map((cell, i) => (
              <td key={i} style={{ padding: "0.6rem 0.75rem", borderBottom: "1px solid var(--line)", verticalAlign: "top" }}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
