
import { useNavigate } from 'react-router-dom';
import Swal from 'sweetalert2';
import type { Game } from '../types/types';
import "../styles/GameCard.css";
import { useEffect, useRef } from 'react';


interface GameCardProps {
  game: Game;
  gameStarted?: boolean;
  customStyle?: React.CSSProperties;
  index: number;
}
export const GameCard = ({ game, gameStarted = false, customStyle = {}, index }: GameCardProps) => {
  const navigate = useNavigate();
  const wrapperRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          observer.unobserve(entry.target);
        }
      });
    }, {
      threshold: 0.5
    });

    if (wrapperRef.current) {
      observer.observe(wrapperRef.current);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <div
    ref={wrapperRef}
    className="game-card-wrapper"
    style={{ "--delay": `${index * 0.15 + 0.1}s` } as React.CSSProperties}
  >
    <div
      style={{
        "--delay": `${index * 0.15}s`,
        ...customStyle,
        backgroundImage: `linear-gradient(rgba(0,0,0,0.8), rgba(0,0,0,0.8)), ${game.backgroundImage}`,
      } as React.CSSProperties}

      className="game-card"
      onClick={handleClick}
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
        <h3 style={{ margin: '0 0 10px 0', fontWeight: "bold" }}>{game.name}</h3>
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
    </div>
  );
};

