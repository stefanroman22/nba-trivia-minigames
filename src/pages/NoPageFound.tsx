import { useNavigate } from "react-router-dom";

const NoPageFound = () => {
  const navigate = useNavigate();

  return (
    <div
      style={{
        fontFamily: "Inter, sans-serif",
        backgroundColor: "#1e1e1e",
        color: "#fff",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        padding: "2rem",
        textAlign: "center",
      }}
    >
      <h1 style={{ fontSize: "4rem", marginBottom: "1rem", color: "#EA750E" }}>404</h1>
      <h2 style={{ fontSize: "2rem", marginBottom: "1rem" }}>Page Not Found</h2>
      <p style={{ fontSize: "1rem", color: "#aaa", marginBottom: "2rem" }}>
        Oops! The page you're looking for doesn't exist or has been moved.
      </p>
      <button
        onClick={() => navigate("/")}
        style={{
          padding: "0.75rem 1.5rem",
          backgroundColor: "#EA750E",
          color: "#fff",
          border: "none",
          borderRadius: "10px",
          fontWeight: "bold",
          cursor: "pointer",
          fontSize: "1rem",
          transition: "background 0.3s ease, transform 0.2s ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = "#a14c07";
          e.currentTarget.style.transform = "scale(1.05)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = "#EA750E";
          e.currentTarget.style.transform = "scale(1)";
        }}
      >
        Go Home
      </button>
    </div>
  );
};

export default NoPageFound;
