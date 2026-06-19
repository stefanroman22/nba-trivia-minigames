// styles.tsx
// styles.tsx
import type { CSSProperties } from "react";


export const colors = {
  orange: "#ff7400"
}
export const inputStyle: CSSProperties = {
  width: "clamp(200px, 30vw, 320px)",
  maxWidth: "100%",
  padding: "12px 16px",
  borderRadius: "12px",
  border: "2px solid rgba(234, 117, 14, 0.4)", // bright orange border
  background: "linear-gradient(145deg, #1f1f1f 0%, #2a2a2a 100%)", // dark textured background
  color: "#f9f9f9", // light text
  fontSize: "1rem",
  fontWeight: 500,
  outline: "none",
  transition: "all 0.3s ease",
  boxShadow:
    "inset 0 2px 4px rgba(0,0,0,0.5), 0 2px 6px rgba(0,0,0,0.3)", // subtle 3D feel
  letterSpacing: "0.5px",
};

export const suggestionItemStyle: CSSProperties = {
  padding: "0.75rem 1rem",
  cursor: "pointer",
  borderBottom: "2px solid #000000ff",
  transition: "background-color 0.3s",
};

export const suggestionItemHoverStyle = {
  backgroundColor: "#b06617ff",
};

export const suggestionBoxStyle: CSSProperties = {
  position: "absolute",
  top: "100%",
  left: "0",
  width: "100%",
  maxHeight: "200px",            // Restrict height for scrollability
  overflowY: "auto",             // Enable vertical scrolling
  WebkitOverflowScrolling: "touch", // Smooth momentum scrolling on iOS

  backgroundColor: "#303030ff",
  listStyle: "none",
  padding: 0,
  margin: 0,
  zIndex: 1000,

  boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
  borderRadius: "4px",

  /* Prevent scrolling from affecting the whole page */
  overscrollBehavior: "contain",
};

export const handleMouseEnter = (e: { currentTarget: { style: { backgroundColor: string; transform: string; }; }; }) => {
  e.currentTarget.style.backgroundColor = "#a14c07";
  e.currentTarget.style.transform = "scale(1.03)";
};

export const handleMouseLeave = (e: { currentTarget: { style: { backgroundColor: string; transform: string; }; }; }) => {
  e.currentTarget.style.backgroundColor = "#ea750e";
  e.currentTarget.style.transform = "scale(1)";
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
  backgroundColor: "#ea750e",
  color: "#fff",
  borderRadius: "10px",
  fontWeight: "bold",
  border: "none",
  transition: "background 0.3s ease, transform 0.4s ease"
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


