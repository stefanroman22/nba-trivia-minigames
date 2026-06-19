
import { useNavigate } from 'react-router-dom';
import Swal from 'sweetalert2';
import { motion, useReducedMotion } from 'framer-motion';
import type { Game } from '../types/types';
import "../styles/GameCard.css";


interface GameCardProps {
  game: Game;
  gameStarted?: boolean;
  customStyle?: React.CSSProperties;
  index?: number;
}
export const GameCard = ({ game, gameStarted = false, customStyle = {}, index = 0 }: GameCardProps) => {
  const navigate = useNavigate();
  const reduce = useReducedMotion();

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
    <motion.div
      className="game-card-wrapper"
      initial={reduce ? false : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: Math.min(index * 0.08, 0.4) }}
    >
      <motion.div
        role="button"
        tabIndex={0}
        aria-label={`Play ${game.name}`}
        style={{
          ...customStyle,
          backgroundImage: `linear-gradient(rgba(0,0,0,0.82), rgba(0,0,0,0.55)), ${game.backgroundImage}`,
        }}
        className="game-card"
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleClick();
          }
        }}
        whileHover={reduce ? undefined : { scale: 1.04, y: -4 }}
        whileTap={reduce ? undefined : { scale: 0.98 }}
        transition={{ type: "spring", stiffness: 300, damping: 22 }}
      >
        <div
          style={{
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            height: '100%',
            padding: '20px',
            gap: '0.4rem',
          }}
        >
          <h3 className="font-display" style={{ margin: 0, fontSize: '1.05rem', color: '#fff' }}>{game.name}</h3>
          <p style={{
            fontSize: "0.8rem",
            color: "#ffae57",
            fontWeight: 'bold',
            margin: 0,
            lineHeight: 1.35,
          }}>
            {game.description}
          </p>
        </div>
      </motion.div>
    </motion.div>
  );
};
