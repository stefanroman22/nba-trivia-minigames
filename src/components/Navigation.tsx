import React from "react";
import logo from "../assets/basketballLogo.webp";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faUserCircle } from "@fortawesome/free-solid-svg-icons";
import { handleHoverEnter, handleHoverLeave, linkStyle} from "../constants/styles";
import "../styles/Navigation.css";

interface NavigationProps {
  type?: "full" | "back";
  navItems?: string[];
  user?: any;
}

function Navigation({type, navItems, user} : NavigationProps){

  const navigate = useNavigate();

  return (
    <div id="navigation-container" className="navigation-container">
      <img src={logo} alt="Logo" id="logo-img" className="logo-img" onClick={() => navigate("/")}/>

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
