
import { useNavigate } from 'react-router-dom';
import Swal from 'sweetalert2';
import type { Game } from '../types/types';


interface GameCardProps {
  game: Game;
  gameStarted?: boolean;
  customStyle?: React.CSSProperties;
}
export const GameCard = ({ game, gameStarted = false, customStyle = {} }: GameCardProps) => {
  const navigate = useNavigate();

  const handleClick = () => {
    if (gameStarted) {
      Swal.fire({
        icon: "warning",
        title: "Game already in progress",
        text: "Finish your current game before starting a new one.",
        confirmButtonText: "OK",
        confirmButtonColor: "#EA750E",
        background: "#1f1f1f",
        color: "#ffffff",
      });
      return; // prevent navigation
    }

    if (game.urlPath) {
      navigate(game.urlPath, { state: { id: game.id } });
    }
  };

  return (
    <div
      style={{
        width: "100%",             // fill available space
        maxWidth: "285px",         // optional max width
        aspectRatio: "4 / 2",      // width:height ratio (2:1 here)
        backgroundImage: `linear-gradient(rgba(0,0,0,0.8), rgba(0,0,0,0.8)), ${game.backgroundImage}`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        borderRadius: "12px",
        boxShadow: "0 4px 10px rgba(0,0,0,0.3)",
        cursor: "pointer",
        transition: "transform 0.2s ease",
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        ...customStyle,
      }}
      onMouseEnter={(e) => e.currentTarget.style.transform = "scale(1.03)"}
      onMouseLeave={(e) => e.currentTarget.style.transform = "scale(1)"}
      onClick={() => handleClick()

      }
    >
      <div
        style={{
          textAlign: 'center',       // Horizontal centering
          display: 'flex',           // Flexbox for vertical centering
          flexDirection: 'column',   // Stack children vertically
          justifyContent: 'center',  // Vertical centering
          alignItems: 'center',      // Horizontal centering (redundant with textAlign)
          height: '100%',            // Take full height of parent
          padding: '20px',           // Add breathing room
        }}
      >
        <h3 style={{ margin: '0 0 10px 0', fontWeight: "bold"}}>{game.name}</h3>
        <p style={{
          fontSize: "0.8rem",
          color: "#ba620fff",
          fontWeight: 'bold',
          margin: 0,                 // Remove default margins
        }}>
          {game.description}
        </p>
      </div>
    </div>
  );
};

