
import logo from "../assets/basketballLogo.webp";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faUserCircle } from "@fortawesome/free-solid-svg-icons";
import { animationStyle, handleHoverEnter, handleHoverLeave, linkStyle } from "../constants/styles";
import "../styles/Navigation.css";
import type { RootState } from "../store";
import { useSelector } from "react-redux";
import socket from "../socket";
import type { RoomState } from "../types/types";
import { leaveMultiplayer } from "../utils/LeaveMultiplayer";

interface NavigationProps {
  type?: "full" | "back";
  navItemsLeft?: string[];
  navItemsRight?: string[];
  setRoomState?: React.Dispatch<React.SetStateAction<RoomState>>;
}

function Navigation({ type, navItemsLeft, navItemsRight, setRoomState }: NavigationProps) {

  const navigate = useNavigate();
  const { user } = useSelector((state: RootState) => state.user)

  return (
    <div
  id="navigation-container"
  className="navigation-container flex justify-between  w-full px-4"
>
  {/* Left side: Logo + Left nav items */}
  <div className="flex items-center">
    <img
      src={logo}
      alt="Logo"
      id="logo-img"
      className="logo-img cursor-pointer mr-6"
      onClick={() => {
        if (type !== "full")
          leaveMultiplayer({ socket, user, setRoomState });
        navigate("/");
      }}
    />

    {type === "full" && (
      <ul className="flex list-none p-0 m-0">
        {navItemsLeft?.map((item) => (
          <li
            key={item}
            className="mx-2 transition-transform duration-200 hover:scale-110"
            style={animationStyle}
          >
            <a
              href={`#${item.toLowerCase().replace(" ", "")}`}
              style={linkStyle}
              className="text-white transition-colors duration-300"
              onMouseEnter={handleHoverEnter}
              onMouseLeave={handleHoverLeave}
            >
              {item === "Log in" && user ? (
                <FontAwesomeIcon
                  icon={faUserCircle}
                  className="h-6 w-6 text-white cursor-pointer transition-colors duration-300"
                  onMouseEnter={handleHoverEnter}
                  onMouseLeave={handleHoverLeave}
                  onClick={() => (window.location.href = "#profile")}
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

  {/* Right side: navItemsRight */}
  <div>
    <ul className="flex list-none p-0 m-0">
      {navItemsRight?.map((item) => (
        <li
          key={item}
          className="mx-2 transition-transform duration-200 hover:scale-110"
          style={animationStyle}
        >
          <a
            href={`#${item.toLowerCase().replace(" ", "")}`}
            style={linkStyle}
            className="h-8 w-8 text-white transition-colors duration-300"
            onMouseEnter={handleHoverEnter}
            onMouseLeave={handleHoverLeave}
          >
            {item === "Log in" && user ? (
              <FontAwesomeIcon
                icon={faUserCircle}
                onMouseEnter={handleHoverEnter}
                onMouseLeave={handleHoverLeave}
                onClick={() => (window.location.href = "#profile")}
              />
            ) : (
              item
            )}
          </a>
        </li>
      ))}
    </ul>
  </div>
</div>


  );
};

export default Navigation;
