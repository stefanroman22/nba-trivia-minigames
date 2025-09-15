import { faCopy } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { buttonStyle, handleMouseEnter, handleMouseLeave } from '../../constants/styles';
import socket from '../../socket';
import { useEffect, useState } from 'react';
import type { RoomState } from '../../types/types';
import MatchupDisplay from './MatchupDisplay';
import type { RootState } from '../../store';
import { useSelector } from 'react-redux';
import Swal from 'sweetalert2';

interface GenerateMultiplayerCodeProps {
  handleCopyClick: () => void;
  copied: boolean;
  roomState: RoomState;
  setRoomState: React.Dispatch<React.SetStateAction<RoomState>>;
}

function GenerateMultiplayerCode({ handleCopyClick, copied, roomState, setRoomState }: GenerateMultiplayerCodeProps) {
  const [errorMatchup, setErrorMatchup] = useState(false);
  const [lookingForOpponent, setLookingForOpponent] = useState(false);
  const [opponent, setOpponent] = useState<{ username: string, profile_photo: string, rank: string, points: number} | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { isLoggedIn, user} = useSelector((state: RootState) => state.user);
  

  useEffect(() => {
    socket.on("matchupTimeout", (data) => {
      console.log("Timeout:", data.message);
      setLookingForOpponent(false);
      setErrorMatchup(true);
      setRoomState(prev => ({ ...prev, status: "ready" }));
    });

    socket.on("opponentJoined", (data) => {
      console.log("Opponent joined:", data);
      setOpponent({
        username: data.username,
        profile_photo: data.profile_photo,
        rank: data.rank,
        points: data.points

      });
      setLookingForOpponent(false);
      setRoomState(prev => ({ ...prev, status: "complete" }));
    });

    socket.on("opponentLeft", (data) => {
      console.log("Opponent Left: ", data);
      Swal.fire({
              icon: "warning",
              title: "Opponent left",
              text: "The current connection will be closed",
              confirmButtonText: "OK",
              confirmButtonColor: "#EA750E",
              background: "#1f1f1f",
              color: "#ffffff",
            });
      setOpponent(null)
      setRoomState(prev => ({ ...prev, status: "ready" }));
    })

    return () => {
      socket.off("matchupTimeout");
      socket.off("opponentJoined");
      socket.off("opponentLeft");
    };
  }, [setRoomState]);

  return (
    <>
      {/* Waiting for opponent */}
      {lookingForOpponent && !opponent && (
        <div style={{ marginTop: "150px", textAlign: "center" }}>
          <div className="loader" />
          <p>Searching for opponent...</p>
          <button
            style={buttonStyle}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onClick={() => {
              socket.emit("deactivateRoom", roomState.code, (response) => {
                if (response.ok) {
                  setLookingForOpponent(false);
                  setRoomState({ ...roomState, status: "ready" });
                }
              });
            }}
          >
            Cancel Matchup
          </button>
        </div>
      )}

      {/* Matchup complete - show host + opponent */}
      {roomState.status === "complete" && opponent && <MatchupDisplay hostInfo={user} opponent={opponent}/>}

      {/* Ready state - before host clicks start */}
      {!lookingForOpponent && !opponent && roomState.status === "ready" && (
        <div style={{ textAlign: "center", marginTop: "20px" }}>
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', paddingBottom: "10px" }}>
            <p style={{ color: 'white', margin: 0 }}>
              Share this code with your friend: <strong style={{ color: '#ba620fff' }}>{roomState.code}</strong>
            </p>
            <div style={{ position: "relative", display: "inline-block", paddingRight: "10px" }}>
              <FontAwesomeIcon icon={faCopy} style={{ cursor: 'pointer', color: '#ba620fff' }} onClick={handleCopyClick} title="Copy code" />
              {copied && <div className="copy-overlay">Copied!</div>}
            </div>
            <button
              style={buttonStyle}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
              onClick={() => {
                setErrorMatchup(false);
                setLookingForOpponent(true);
                socket.emit("activateRoom", roomState.code, (response) => {
                  if (response.ok) {
                    setRoomState({ ...roomState, status: "active" });
                  } else {
                    setLookingForOpponent(false);
                    setErrorMatchup(true);
                  }
                });
              }}
            >
              Start Matchup
            </button>
          </div>

          {errorMatchup && <p style={{ color: "red", marginTop: "10px", fontWeight: "bold" }}>No opponent joined within 30 seconds. Try again!</p>}
          {!errorMatchup && 
          <> 
            <p style={{ color: "#ea750e" }}> Share the code with your friend. Click "Start Matchup" and then ask your friend to start it too! 
            </p> <p style={{ fontSize: "0.8rem", opacity: "0.6" }}> Both of you will receive the same questions and after submission you will see who did better. </p> 
          </> }
        </div>
      )}
    </>
  );
}

export default GenerateMultiplayerCode;
