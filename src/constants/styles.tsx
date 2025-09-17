// styles.tsx
// styles.tsx
import type { CSSProperties } from "react";

export const inputStyle: CSSProperties = {
  padding: "0.75rem 1.25rem",
  borderRadius: "8px",
  fontSize: "1rem",
  width: "clamp(180px, 30vw, 300px)", // min 180px, max 300px, scales with viewport
  border: "1px solid #ea750e",
  outline: "none",
  transition: "border-color 0.3s",
};

export const inputFocusStyle: CSSProperties = {
  borderColor: "#a14c07",
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

export const suggestionsStyles: CSSProperties = {
  position: "absolute",
  top: "100%", // directly under the input
                  left: "0.5%",
                  width: "112%",
                  maxHeight: "200px", // limit height
                  overflowY: "auto",  // make it scrollable
                  backgroundColor: "#303030ff",
                  listStyle: "none",
                  padding: 0,
                  margin: 0,
                  zIndex: 1000,
                  boxShadow: "0 2px 8px rgba(0,0,0,0.3)", // optional: add shadow
                  borderRadius: "4px" // optional: round corners
}

export const suggestionBoxStyle = { 
  position: "absolute", 
  top: "100%", 
  left: "0", 
  width: "100%", 
  maxHeight: "200px", 
  overflowY: "auto", 
  backgroundColor: "#303030ff", 
  listStyle: "none", 
  padding: 0, 
  margin: 0, 
  zIndex: 1000, 
  boxShadow: "0 2px 8px rgba(0,0,0,0.3)", 
  borderRadius: "4px", };

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

export const buttonStyle = {
  padding: "0.7rem 1.5rem",
  backgroundColor: "#ea750e",
  color: "#fff",
  borderRadius: "10px",
  fontWeight: "bold",
  border: "none",
  transition: "background 0.3s ease, transform 0.2s ease",
};

export const introTextStyle = {
  fontSize: "0.9rem",
  color: "#ba620fff",
  fontWeight: "bold",
  marginTop: "14rem",
  opacity: 0.7,
};

export const sideCardStyle: React.CSSProperties = {
  backgroundColor: "#1e1e1e",
  padding: "1.5rem",
  borderRadius: "10px",
  boxShadow: "0 4px 10px rgba(42, 41, 41, 0.4)",
  textAlign: "center"
};

export const sideTextStyle = {
  fontSize: "0.8rem",
  color: "#ba620fff",
  fontWeight: "bold",
};

export const buttonTeamStyle = {
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

