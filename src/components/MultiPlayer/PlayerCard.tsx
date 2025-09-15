const PlayerCard = ({ username, profilePhoto, role, rank, points }) => {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        background: "#1f1f1f", // dark card background
        padding: "0.8rem",
        borderRadius: "10px",
        boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
        minWidth: "120px",
        maxWidth: "150px",
      }}
      
    >
      {/* Profile Photo */}
      <img
        src={profilePhoto || "/src/assets/default.png"}
        alt={username}
        style={{
          width: 60,
          height: 60,
          borderRadius: "50%",
          objectFit: "cover",
          marginBottom: "0.4rem",
        }}
      />

      {/* Username */}
      <p
        style={{
          margin: 0,
          fontWeight: "bold",
          fontSize: "0.95rem",
          color: "#fff",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          overflow: "hidden",
          maxWidth: "100%",
        }}
      >
        {username || "Guest"}
      </p>

      {/* Role */}
      <p
        style={{
          margin: "0.2rem 0",
          fontSize: "0.75rem",
          color: "#aaa",
        }}
      >
        {role}
      </p>

      {/* Rank & Points Row */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          width: "100%",
          fontSize: "0.75rem",
          color: "#bbb",
          marginTop: "0.3rem",
        }}
      >
        <span>🏆 {rank}</span>
        <span>⭐ {points}</span>
      </div>
    </div>
  );
};

export default PlayerCard;
