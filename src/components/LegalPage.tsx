import type { ReactNode } from "react";

/** Plain long-form page for the privacy policy and terms: one readable column on the site's dark theme. */
export default function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <main style={{ background: "var(--bg)", color: "var(--text)", minHeight: "100vh", padding: "4rem 1.25rem 5rem" }}>
      <article style={{ maxWidth: 760, margin: "0 auto", lineHeight: 1.7 }}>
        <a href="/" style={{ color: "var(--brand)", fontWeight: 700, textDecoration: "none" }}>← Swish Quest</a>
        <h1 style={{ fontSize: "2.25rem", fontWeight: 800, margin: "1.25rem 0 0.25rem" }}>{title}</h1>
        <p style={{ color: "var(--muted)", marginBottom: "2rem" }}>Last updated {updated}</p>
        <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>{children}</div>
      </article>
    </main>
  );
}

export const LegalHeading = ({ children }: { children: ReactNode }) => (
  <h2 style={{ fontSize: "1.25rem", fontWeight: 700, marginTop: "1.25rem", color: "var(--text)" }}>{children}</h2>
);

export const LegalList = ({ children }: { children: ReactNode }) => (
  <ul style={{ paddingLeft: "1.25rem", display: "flex", flexDirection: "column", gap: "0.5rem", listStyle: "disc" }}>{children}</ul>
);

export const MailLink = () => (
  <a href="mailto:stefanromanpers@gmail.com" style={{ color: "var(--brand)" }}>stefanromanpers@gmail.com</a>
);
