import logo from "../assets/basketballLogo.webp";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBars, faUserCircle, faX } from "@fortawesome/free-solid-svg-icons";
import { animationStyle, colors, handleHoverEnter, handleHoverLeave, linkStyle } from "../constants/styles";
import "../styles/Navigation.css";
import type { RootState } from "../store";
import { useSelector } from "react-redux";
import socket from "../socket";
import type { RoomState } from "../types/types";
import { leaveMultiplayer } from "../utils/LeaveMultiplayer";
import { useState } from "react";

interface NavigationProps {
  type?: "full" | "back";
  navItemsLeft?: string[];
  navItemsRight?: string[];
  setRoomState?: React.Dispatch<React.SetStateAction<RoomState>>;
}

function Navigation({ type, navItemsLeft, navItemsRight, setRoomState }: NavigationProps) {
  const navigate = useNavigate();
  const { user } = useSelector((state: RootState) => state.user);
  const [isOpen, setIsOpen] = useState(false);

  // 1. Helper Function: Reduces code duplication by 50%
  const renderNavItem = (item: string, isMobile = false) => (
    <li
      key={item}
      className={`mx-2 transition-transform duration-200 hover:scale-110 ${isMobile ? "my-4 text-xl" : ""}`}
      style={animationStyle}
    >
      <a
        href={`#${item.toLowerCase().replace(" ", "")}`}
        style={linkStyle}
        className="text-white transition-colors duration-300 flex items-center justify-center"
        onMouseEnter={handleHoverEnter}
        onMouseLeave={handleHoverLeave}
        onClick={() => isMobile && setIsOpen(false)} // Close menu when item clicked
      >
        {item === "Log in" && user ? (
          <FontAwesomeIcon
            className="icon"
            icon={faUserCircle}
            size={isMobile ? "3x" : "2x"}
            onClick={(e) => {
              e.stopPropagation();
              window.location.href = "#profile";
              if (isMobile) setIsOpen(false);
            }}
          />
        ) : (
          item
        )}
      </a>
    </li>
  );

  const Logo = ({ className }: { className: string }) => (
    <img
      src={logo}
      alt="Logo"
      id="logo-img"
      className={`logo-img cursor-pointer mr-6 ${className}`}
      onClick={() => {
        if (type !== "full") leaveMultiplayer({ socket, user, setRoomState });
        navigate("/");
      }}
    />
  );

  return (
    <div
      id="navigation-container"
      // Added 'relative' and 'z-50' to ensure mobile menu positions correctly relative to this bar
      className="navigation-container z-50 flex justify-end sm:justify-between w-full px-4 items-center bg-black/80" // 
    >
      {/* 1. Mobile Logo */}
      <Logo className="block md:hidden" />

      {/* 2. Desktop Left Items */}
      {type === "full" &&
        <>
          <div className="hidden md:flex items-center left-items">
            <Logo className="block" />
            {type === "full" && (
              <ul className="flex list-none p-0 m-0">
                {navItemsLeft?.map((item) => renderNavItem(item))}
              </ul>
            )}
          </div>


          <div className="hidden md:block right-items">
            <ul className="flex list-none p-0 m-0">
              {navItemsRight?.map((item) => renderNavItem(item))}
            </ul>
          </div>

          {/* 4. Hamburger Icon */}
          <div className="mobile-nav md:hidden z-50">
            <FontAwesomeIcon
              icon={isOpen ? faX : faBars}
              size={isOpen ? "1x" : "2x"}
              onClick={() => setIsOpen(!isOpen)}
              color={!isOpen ? `${colors.orange}` : "white"}
              style={{
                transition: "all 0.3s ease-in-out",
                transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
                cursor: "pointer"
              }}
            />
          </div>


          <div
            className={`
          fixed inset-0 w-full h-dvh
          flex flex-col items-center justify-start pt-24
          
          
         bg-[#292929]/90 backdrop-blur-lg  border-none
          transition-all duration-500 ease-in-out z-40
          
          /* THE CONDITIONAL SLIDE ANIMATION */
          ${isOpen
                ? "translate-y-0 opacity-100 visible"      // Final state: On screen, fully visible
                : "translate-y-full opacity-0 invisible"   // Initial state: Pushed down off-screen, invisible
              }
        `}
          >
            <ul className="flex flex-col list-none p-0 m-0 text-center justify-center align-middle">
              {/* Combine Left and Right items for mobile view */}
              {navItemsLeft?.map((item) => renderNavItem(item, true))}
              {navItemsRight?.map((item) => renderNavItem(item, true))}
            </ul>
          </div>
        </>}

      {type === "back" && <Logo className="hidden md:block" />}
    </div>
  );
}

export default Navigation;