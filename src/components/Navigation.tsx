
import logo from "../assets/basketballLogo.webp";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faUserCircle } from "@fortawesome/free-solid-svg-icons";
import { handleHoverEnter, handleHoverLeave, linkStyle } from "../constants/styles";
import "../styles/Navigation.css";
import type { RootState } from "../store";
import { useSelector } from "react-redux";
import socket from "../socket";
import type { RoomState } from "../types/types";
import { leaveMultiplayer } from "../utils/LeaveMultiplayer";

interface NavigationProps {
  type?: "full" | "back";
  navItems?: string[];
  setRoomState?: React.Dispatch<React.SetStateAction<RoomState>>;
}

function Navigation({ type, navItems, setRoomState }: NavigationProps) {

  const navigate = useNavigate();
  const {user } = useSelector((state: RootState) => state.user)

  return (
    <div id="navigation-container" className="navigation-container">
      <img
        src={logo}
        alt="Logo"
        id="logo-img"
        className="logo-img"
        onClick={() => {
          if(type !== "full")
            leaveMultiplayer({ socket, user, setRoomState}); 
          
          navigate('/');
        }}
      />


      {type === "full" && (
        <ul style={{ display: "flex", listStyle: "none", padding: 0, margin: 0 }}>
          {navItems?.map((item) => (
            <li key={item} style={{ margin: "0 10px" }}>
              <a
                href={`#${item.toLowerCase().replace(" ", "")}`}
                style={{ ...linkStyle, color: "white", transition: "color 0.3s ease" }}
                onMouseEnter={handleHoverEnter}
                onMouseLeave={handleHoverLeave}
              >
                {item === "Log in" && user ? (
                  <FontAwesomeIcon
                    icon={faUserCircle}
                    style={{
                      height: "25px",
                      width: "25px",
                      color: "white",
                      cursor: "pointer",
                      transition: "color 0.3s ease",
                    }}
                    onMouseEnter={handleHoverEnter}
                    onMouseLeave={handleHoverLeave}
                    onClick={() => {
                      window.location.href = "#profile";
                    }}
                  />
                ) : (
                  item
                )}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default Navigation;
