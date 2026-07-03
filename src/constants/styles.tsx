// styles.tsx
// styles.tsx
import type { CSSProperties } from "react";


export const colors = {
  orange: "#ff7400"
}
export const inputStyle: CSSProperties = {
  width: "clamp(200px, 30vw, 320px)",
  maxWidth: "100%",
  height: "46px",
  padding: "0 16px",
  borderRadius: "10px",
  border: "1px solid var(--line2)",
  background: "var(--surface2)",
  color: "var(--text)",
  fontSize: "0.95rem",
  fontWeight: 500,
  outline: "none",
  transition: "border-color 0.2s ease, box-shadow 0.2s ease",
  letterSpacing: "0.3px",
};

export const suggestionItemStyle: CSSProperties = {
  padding: "0.65rem 0.9rem",
  cursor: "pointer",
  borderBottom: "1px solid var(--line)",
  fontSize: "0.9rem",
  transition: "background-color 0.2s",
};

export const suggestionItemHoverStyle = {
  backgroundColor: "var(--brand-soft)",
};

export const suggestionBoxStyle: CSSProperties = {
  position: "absolute",
  top: "100%",
  left: "0",
  width: "100%",
  maxHeight: "200px",            // Restrict height for scrollability
  overflowY: "auto",             // Enable vertical scrolling
  WebkitOverflowScrolling: "touch", // Smooth momentum scrolling on iOS

  backgroundColor: "var(--surface2)",
  border: "1px solid var(--line2)",
  color: "var(--text)",
  listStyle: "none",
  padding: 0,
  margin: "6px 0 0",
  zIndex: 1000,

  boxShadow: "var(--shadow)",
  borderRadius: "10px",

  /* Prevent scrolling from affecting the whole page */
  overscrollBehavior: "contain",
};

export const handleMouseEnter = (e: { currentTarget: { style: { filter: string; transform: string; }; }; }) => {
  e.currentTarget.style.filter = "brightness(1.08)";
  e.currentTarget.style.transform = "translateY(-2px)";
};

export const handleMouseLeave = (e: { currentTarget: { style: { filter: string; transform: string; }; }; }) => {
  e.currentTarget.style.filter = "none";
  e.currentTarget.style.transform = "translateY(0)";
};

export const handleHoverEnter = (
  e: React.MouseEvent<HTMLAnchorElement | SVGSVGElement>
) => {
  e.currentTarget.style.color = "#ea750e"; // orange on hover
};

export const handleHoverLeave = (
  e: React.MouseEvent<HTMLAnchorElement | SVGSVGElement>
) => {
  e.currentTarget.style.color = "white"; // white by default
};

export const buttonStyle: CSSProperties = {
  padding: "0.7rem 1.5rem",
  backgroundColor: "var(--brand)",
  color: "#fff",
  borderRadius: "10px",
  fontWeight: "bold",
  border: "none",
  boxShadow: "0 12px 30px -12px var(--brand)",
  transition: "filter 0.2s ease, transform 0.2s ease",
};

export const sideCardStyle: React.CSSProperties = {
  backgroundColor: "#1e1e1e",
  padding: "1.5rem",
  borderRadius: "10px",
  boxShadow: "0 4px 10px rgba(42, 41, 41, 0.4)",
  textAlign: "center"
};

export const buttonTeamStyle: CSSProperties = {
  padding: "0.7rem 1.5rem",
  backgroundColor: "#2f1805ff",
  color: "#fff",
  borderRadius: "10px",
  fontWeight: "bold",
  border: "none",
  transition: "background 0.3s ease, transform 0.2s ease",
};

export const linkStyle: React.CSSProperties = {
  color: "white",
  textDecoration: "none",
  cursor: "pointer",
  fontWeight: "bold",
  transition: "color 0.3s ease",
};

export const animationStyle = {
  transition: "all 0.3s ease-in-out",
  transformOrigin: "center",
};


