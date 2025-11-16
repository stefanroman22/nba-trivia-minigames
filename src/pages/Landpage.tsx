import { useState } from "react";
import "../styles/LandPage.css";
import Swal from 'sweetalert2';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faGoogle } from "@fortawesome/free-brands-svg-icons";
import { GameCard } from "../components/GameCard";
import { games } from "../utils/GameUtils";
import Navigation from "../components/Navigation";
import { useGoogleLogin } from '@react-oauth/google';
import { showErrorAlert } from "../utils/Alerts";
import UserProfile from "../components/UserProfile";
import { buttonStyle, handleMouseEnter, handleMouseLeave } from "../constants/styles";
import "../styles/GlobalStyles.css";
import Leaderboard from "../components/Leaderboard";
import socket from "../socket";
import { useDispatch, useSelector } from "react-redux";
import type { RootState, AppDispatch } from "../store";
import { login, logout } from "../store/userSlice";
import { setTokens } from "../utils/Api";
import { colors } from "../constants/styles";
import { faEye, faEyeSlash } from "@fortawesome/free-solid-svg-icons";
import Footer from "../components/Footer";
import { navItemsLeft } from "../constants/navigation";
import { navItemsRight } from "../constants/navigation";
import { BACKEND_URL } from "../configurations/backend";


const Landpage = () => {
  const [isSignup, setIsSignup] = useState(false);
  const [userId, setUserId] = useState("");
  const [userPassword, setUserPassword] = useState("");
  const [signupUsername, setSignupUsername] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMatchError, setPasswordMatchError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const dispatch = useDispatch<AppDispatch>();
  const { user } = useSelector((state: RootState) => state.user);



  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const response = await fetch(`${BACKEND_URL}/api/login/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: userId, password: userPassword }),
    });
    const data = await response.json();
    if (data.error) {
      showErrorAlert(data.error, "Authentication Failed");
    } else {
      setIsLoading(true);
      setTimeout(() => {
        dispatch(login(data.user));
        setTokens(data.access, data.refresh);
        setIsLoading(false);
      }, 2000);
      console.log(data.user);
    }
    console.log(data);
  }

  const handleSignUp = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!signupUsername || !signupEmail || !userPassword || !confirmPassword) {
      showErrorAlert("Please fill in all required fields.", "Missing Fields");
      return;
    }

    if (userPassword !== confirmPassword) {
      showErrorAlert("Passwords do not match. Please try again.", "Password Mismatch");
      return;
    }

    try {
      const response = await fetch("http://localhost:8000/api/signup/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: signupUsername,
          email: signupEmail,
          password: userPassword,
        }),
      });

      const data = await response.json();
      console.log("Signup response:", data);

      if (!response.ok || data.error) {
        showErrorAlert(data.error || "Signup failed", "Authentication Failed");
      } else {
        // Save tokens in localStorage
        localStorage.setItem("accessToken", data.access);
        localStorage.setItem("refreshToken", data.refresh);

        // Update Redux state
        setIsLoading(true);
        setTimeout(() => {
          dispatch(login(data.user));

          Swal.fire({
            icon: 'success',
            title: 'Account Created!',
            text: `Welcome, ${data.user.username}! Glad to have you here!`,
            background: '#1f1f1f',
            color: '#ffffff',
            confirmButtonColor: '#EA750E',
            timer: 1500,
            showConfirmButton: false,
          });

          setIsLoading(false);
        }, 2000);
      }
    } catch (err) {
      console.error("Signup error:", err);
      showErrorAlert("Unable to contact the server. Please try again later.", "Network Error");
    }
  };

  const googleLogin = useGoogleLogin({
    flow: 'auth-code',
    onSuccess: async (codeResponse) => {
      console.log("Google codeResponse:", codeResponse);

      try {
        const response = await fetch("http://localhost:8000/api/login/google/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: codeResponse.code }),
        });

        const data = await response.json();
        console.log("Backend response:", data);

        if (!response.ok || data.error) {
          showErrorAlert(data.error || "Google Authentication Failed", "Login Failed");
          return;
        }

        // Save tokens like normal login
        localStorage.setItem("accessToken", data.access);
        localStorage.setItem("refreshToken", data.refresh);

        setIsLoading(true);
        setTimeout(() => {
          dispatch(login(data.user));
          setIsLoading(false);
        }, 2000);

      } catch (err) {
        console.error("Unexpected error during Google login:", err);
      }
    },
    onError: () => {
      console.error("Google login failed");
    }
  });

  const togglePasswordVisibility = () => {
    setShowPassword((prev) => !prev);
  };


  return (
    <div id="main-container" className="main-container">

      {/* Navigation */}
      <Navigation type="full" navItemsLeft={navItemsLeft} navItemsRight={navItemsRight} />

      {/* Play Section */}
      <div id="play" className="play-section">
        <h1 className="text-3xl font-extrabold mb-8 text-center text-transparent bg-clip-text bg-gradient-to-r from-orange-500 via-amber-500 to-yellow-400 tracking-wide drop-shadow-lg">
          NBA Trivia Minigames
        </h1>
        <div className="games-grid">
          {games.map((game, index) => (
            <GameCard key={index} game={game} />
          ))}
        </div>
      </div>

      {/* Login Section */}
      <div
        id="login"
        className="login-section"
      > {isLoading ?
        (<div className="loader"></div>) :
        (user ? (
          <>

            <UserProfile />
            <button

              style={buttonStyle}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
              onClick={async () => {
                const refreshToken = localStorage.getItem("refreshToken");
                console.log("Logging out with refresh token:", refreshToken);

                // Immediately clear local tokens to prevent accidental reuse
                localStorage.removeItem("accessToken");
                localStorage.removeItem("refreshToken");

                const res = await fetch("http://localhost:8000/api/logout/", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({ refresh: refreshToken }),
                });

                const data = await res.json();

                if (data.error) {
                  showErrorAlert(data.error, "Unable to Log Out!");
                } else {
                  setIsLoading(true);

                  if (socket.connected) {
                    socket.emit("setUserInfo", null);
                    console.log("Logout emit sent");
                  }

                  setTimeout(() => {
                    dispatch(logout()); // Clear Redux state
                    setIsLoading(false);
                  }, 2000);
                }
              }}

            >
              Log Out
            </button>
          </>
        ) :
          (
            <div className="login-signup-box flex flex-col items-center justify-center">
              <h2 className="text-2xl font-extrabold">
                {isSignup ? "Sign Up" : "Log In"}
              </h2>

              <form className="mt-4 flex flex-col gap-4 items-center justify-center">
                <input
                  type="email"
                  className="basketball-input"
                  placeholder={isSignup ? "Email" : "Username or Email"}
                />

                {isSignup && (
                  <input type="text" className="basketball-input" placeholder="Username" />
                )}

                <div style={{position:"relative"}}>
                <input
                  type={showPassword ? "text" : "password"}
                  className="basketball-input password"
                  placeholder="Password"
                  style={{paddingRight: "40px"}}
                />

                <FontAwesomeIcon
                icon={showPassword ? faEyeSlash : faEye}
                style={{position: "absolute", top: "15px", right: "20px"}}
                
                onClick={() => setShowPassword(!showPassword)}
                />
                </div>

                {isSignup && (
                  <input
                    type="password"
                    className="basketball-input"
                    placeholder="Confirm Password"
                  />
                )}
              </form>


              <p style={{ marginTop: "1rem", fontSize: "1rem" }}>
                {isSignup ? "Already have an account?" : "Don't have an account?"}{" "}
                <span
                  style={{ color: colors.orange, cursor: "pointer", fontWeight: "bold", transition: 'color 0.3s ease', }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = "white";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = "#ff7400";
                  }}
                  onClick={() => setIsSignup(!isSignup)}
                >
                  {isSignup ? "Log In" : "Sign Up"}
                </span>
              </p>
              <p className="mt-2 opacity-75">Or use</p>
              <FontAwesomeIcon
                icon={faGoogle}
                onClick={googleLogin}
                size="2x"
                cursor="pointer"
                onMouseEnter={(e) => (e.currentTarget.style.color = "#ea750e")} // orange
                onMouseLeave={(e) => (e.currentTarget.style.color = "")} // reset
                className="mt-2 transition-transform duration-300 hover:scale-110"
              />
            </div>))}
      </div>

      {/* Leaderboard Section */}
      <div id="leaderboard" className="leaderboard-section">
        <Leaderboard />
      </div>

      {/* Contact Section */}
      <section id="contact">
              <Footer/>
      </section>

    </div>
  );
};




export default Landpage;
