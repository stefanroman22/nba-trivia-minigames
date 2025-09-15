import { useEffect, useState } from 'react';
import "../../styles/EnterMultiplayerCode.css";
import { buttonStyle, handleMouseEnter, handleMouseLeave } from '../../constants/styles';
import socket from '../../socket';
import MatchupDisplay from './MatchupDisplay';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store';
import Swal from 'sweetalert2';
import type { RoomState } from '../../types/types';

const CODE_LENGTH = 6;

interface EnterMultiplayerCodeProps {
  roomState: RoomState;
  setRoomState: React.Dispatch<React.SetStateAction<RoomState>>;
}

function EnterMultiplayerCode({roomState, setRoomState} : EnterMultiplayerCodeProps) {

  const { isLoggedIn, user } = useSelector((state: RootState) => state.user);

  const [enteredCode, setEnteredCode] = useState<(number | null)[]>(Array(CODE_LENGTH).fill(null));
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [matchFound, setMatchFound] = useState(false);
  const [opponent, setOpponent] = useState<{ username: string, profile_photo: string, rank: string, points: number } | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const { key } = event;
      if (/^[0-9]$/.test(key)) {
        const newCode = [...enteredCode];
        const firstNullIndex = newCode.findIndex((d) => d == null);
        if (firstNullIndex !== -1) {
          newCode[firstNullIndex] = Number(key);
          setEnteredCode(newCode);
        }
      } else if (key === "Backspace") {
        const newCode = [...enteredCode];
        const lastFilledIndex = newCode
          .map((v, i) => (v !== null ? i : -1))
          .filter((i) => i !== -1)
          .pop();
        if (lastFilledIndex !== undefined) {
          newCode[lastFilledIndex] = null;
          setEnteredCode(newCode);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enteredCode]);

  useEffect(() => {
    socket.on("hostInfo", (data) => {
      console.log("Host Joined:", data);
      setOpponent({
        username: data.username,
        profile_photo: data.profile_photo,
        rank: data.rank,
        points: data.points
      });
      setWaiting(false);
      setMatchFound(true);
    });

    socket.on("matchupTimeout", (data) => {
      console.log("Timeout:", data.message);
      setError(data.message);
      setWaiting(false);
    });
    socket.on("hostLeft", ({ code, message }) => {
      console.warn(`Room ${code}: ${message}`);
      Swal.fire({
        icon: "warning",
        title: "Host cancelled the room",
        text: "The current connection will be closed",
        confirmButtonText: "OK",
        confirmButtonColor: "#EA750E",
        background: "#1f1f1f",
        color: "#ffffff",
      });
      setOpponent(null);
      setWaiting(false);
      setMatchFound(false);
      setRoomState({status: "idle", code: null, isHost: false});
    });
    return () => {
      socket.off("opponentJoined");
      socket.off("matchupTimeout");
      socket.off("hostLeft");
    };
  }, []);

  const handleStartMatchup = () => {
    setError(null);
    const codeNumber = Number(enteredCode.join(""));
    if (isNaN(codeNumber) || enteredCode.includes(null)) {
      setError("Please enter a valid 6-digit code");
      return;
    }

    setWaiting(true);
    socket.emit("joinRoom", codeNumber, (response) => {
      if (!response.ok) {
        setError(response.error || "Failed to join room");
        setWaiting(false);
      }else{
        setRoomState({status: "complete", code: codeNumber, isHost: false});
      }
    });
  };

  return (
    <>
    {!matchFound && <div className="enter-multiplayer-container">
      <p className="enter-multiplayer-title">Enter the matchup code to begin playing</p>

      <div className="code-boxes">
        {enteredCode.map((_, index) => (
          <div key={index} className="code-tile">
            {enteredCode[index]}
          </div>
        ))}
      </div>

      {error && <p style={{ color: "red", marginTop: "10px" }}>{error}</p>}

      {!matchFound && (
        <button
          className="start-button"
          style={buttonStyle}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onClick={handleStartMatchup}
        >
          {waiting ? "Waiting for opponent..." : "Start Matchup"}
        </button>
      )}

      <p style={{ color: "#ea750e", marginTop: "20px" }}>
        Ask your friend to start the matchup with their code first. Once they’ve done that, you can click "Start Matchup".
      </p>
      <p style={{ fontSize: "0.8rem", opacity: "0.6" }}>
        Both of you will receive the same questions and after submission you will see who did better.
      </p>
    </div>}

      {matchFound && opponent && (
        <MatchupDisplay hostInfo={opponent} opponent={user} />
      )}
    </>
  );
}

export default EnterMultiplayerCode;
