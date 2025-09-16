import { useState, useEffect } from "react";
import "../styles/LandPage.css";
import Swal from 'sweetalert2';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faEyeSlash, faEye } from '@fortawesome/free-solid-svg-icons';
import { faGoogle } from "@fortawesome/free-brands-svg-icons";
import { GameCard, games } from "../components/GameCard"; // adjust the path as necessary
import Navigation from "../components/Navigation";
import { useGoogleLogin } from '@react-oauth/google';
import { showErrorAlert } from "../utils/Alerts";
import UserProfile from "../components/UserProfile";
import { buttonStyle, handleMouseEnter, handleMouseLeave } from "../constants/styles";
import Leaderboard from "../components/Leaderboard";
import socket from "../socket";
import { useDispatch, useSelector } from "react-redux";
import type { RootState, AppDispatch } from "../store";
import { login, logout } from "../store/userSlice";

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
  const { isLoggedIn, user } = useSelector((state: RootState) => state.user);


  useEffect(() => {
    const checkLogin = async () => {
      const res = await fetch("http://localhost:8000/api/me/", {
        method: "GET",
        credentials: "include",  // <-- REQUIRED to send cookies
        headers: {
          "Content-Type": "application/json",
        },
      })
      if (res.ok) {
        const data = await res.json();
        dispatch(login(data.user));
      }
    };

    checkLogin();
  }, []);

  const handleLogin = async (e: React.FormEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const response = await fetch("http://localhost:8000/api/login/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",  //  very important here too
      body: JSON.stringify({ id: userId, password: userPassword }),
    });
    const data = await response.json();
    if (data.error) {
      showErrorAlert(data.error, "Authentication Failed");
    } else {
      setIsLoading(true);
      setTimeout(() => {
        dispatch(login(data.user));
        setIsLoading(false);
      }, 2000);
      console.log(data.user);
    }
    console.log(data);
  }

  const handleSignUp = async (e: React.FormEvent<HTMLButtonElement>) => {
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
        credentials: "include",
        body: JSON.stringify({
          username: signupUsername,
          email: signupEmail,
          password: userPassword,
        }),
      });

      const data = await response.json();
      console.log(data);

      if (!response.ok || data.error) {
        showErrorAlert(data.error, "Authentication Failed");
      } else {
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
          })
          setIsLoading(false);
        }, 2000)
      }
      console.log(data);
    } catch (err) {
      console.error("Signup error:", err);
      showErrorAlert("Unable to contact the server. Please try again later.", "Network error");
    }
  };

  const googleLogin = useGoogleLogin({
    flow: 'auth-code', // 👈 important
    onSuccess: async (codeResponse) => {
      console.log("Google codeResponse:", codeResponse);

      try {
        const response = await fetch("http://localhost:8000/api/login/google/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ code: codeResponse.code }) // send auth code
        });

        const data = await response.json();
        console.log("Backend response:", data);

        if (!response.ok) {
          showErrorAlert(data.error, "Google Authentication Failed");
          return;
        } else {
          setIsLoading(true);
          setTimeout(() => {
            dispatch(login(data.user));
            setIsLoading(false);
          }, 2000);
          console.log(data.user);
        }

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
      <Navigation type="full" navItems={["Games", "Log in", "Leaderboard", "Contact",]} />

      {/* Play Section */}
      <div id="play" className="play-section">
        <h2 style={{ marginBottom: "2rem", fontWeight: "bold" }}>NBA Trivia Minigames</h2>
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
                const res = await fetch("http://localhost:8000/api/logout/", {
                  method: "POST",
                  credentials: "include",
                });
                const data = await res.json();
                if (data.error) {
                  showErrorAlert(data.error, "Unable to Log Out!")
                } else {
                  setIsLoading(true);
                  if (socket.connected) {
                    socket.emit("setUserInfo", null);
                    console.log("Logout emit sent");
                  }
                  setTimeout(() => {
                    dispatch(logout())
                    setIsLoading(false);
                  }, 2000)
                }
              }}
            >
              Log Out
            </button>
          </>
        ) :
          (
            <div className="login-signup-box">
              <h2>{isSignup ? "Sign Up" : "Log In"}</h2>
              <form id="auth-from" className="auth-form" onSubmit={(e) => isSignup ? handleSignUp(e) : handleLogin(e)}>
                <input
                  type="text"
                  placeholder={isSignup ? "Username" : "Username or email"}

                  value={isSignup ? signupUsername : userId}
                  onChange={(e) =>
                    isSignup ? setSignupUsername(e.target.value) : setUserId(e.target.value)
                  }
                  required
                  {...(isSignup && {
                    pattern: "^(?=(?:.*[a-zA-Z]){3,})(?=(?:.*\\d){2,})[a-zA-Z0-9_]{5,}$",
                    title:
                      "Username must contain at least 3 letters and 2 digits, and only letters, digits, or underscores",
                  })}
                />
                {isSignup && (
                  <input
                    type="email"
                    placeholder="Email"

                    value={signupEmail}
                    onChange={(e) => setSignupEmail(e.target.value)}
                    required
                  />
                )}
                <div style={{ position: "relative" }}>
                  <input
                    type={showPassword ? "text" : "password"}
                    name="password"
                    placeholder="Password"
                    value={userPassword}
                    onChange={(e) => setUserPassword(e.target.value)}
                    required
                    minLength={isSignup ? 8 : undefined}
                    pattern={isSignup ? "(?=.*\\d)(?=.*[a-z])(?=.*[A-Z])(?=.*[\\W_]).{8,}" : undefined}
                    title={
                      isSignup
                        ? "Password must be at least 8 characters and include one uppercase letter, one lowercase letter, one number, and one special character."
                        : undefined
                    }
                  />
                  <FontAwesomeIcon icon={showPassword ? faEye : faEyeSlash} onClick={togglePasswordVisibility} className="password-toggle-icon" />
                </div>

                {isSignup && (
                  <input
                    type="password"
                    placeholder="Confirm Password"

                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      if (userPassword && e.target.value !== userPassword) {
                        setPasswordMatchError("Passwords do not match");

                      } else {
                        setPasswordMatchError("");
                      }
                    }}
                    required
                  />
                )}
                {isSignup && passwordMatchError && (
                  <p style={{ color: "red", fontSize: "0.9em", fontWeight: "bold" }}>{passwordMatchError}</p>
                )}
                <button
                  type="submit"
                  style={{
                    ...inputStyle,
                    backgroundColor: isSignup && passwordMatchError
                      ? "#999999"  // gray color when disabled
                      : "rgba(234, 117, 14, 0.78)", // orange when enabled
                    color: "white",
                    cursor: isSignup && passwordMatchError ? "not-allowed" : "pointer",
                    fontWeight: "bold",
                    border: "none",
                    borderRadius: "8px",
                    transition: "background-color 0.4s ease, transform 0.2s ease",
                  }}
                  onMouseEnter={(e) => {
                    if (!(isSignup && passwordMatchError)) {
                      e.currentTarget.style.backgroundColor = "rgba(95, 48, 7, 0.88)";
                      e.currentTarget.style.transform = "scale(1.02)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = isSignup && passwordMatchError
                      ? "#999999"
                      : "rgba(234, 117, 14, 0.78)";
                    e.currentTarget.style.transform = "scale(1)";
                  }}
                  disabled={isSignup && passwordMatchError !== ""}
                >
                  {isSignup ? "Create Account" : "Log In"}
                </button>


              </form>

              <p style={{ marginTop: "1rem", fontSize: "0.9rem" }}>
                {isSignup ? "Already have an account?" : "Don't have an account?"}{" "}
                <span
                  style={{ color: "#ff7400", cursor: "pointer", fontWeight: "bold", transition: 'color 0.3s ease', }}
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
              <FontAwesomeIcon
                icon={faGoogle}
                onClick={googleLogin}
                style={{
                  transition: 'color 0.3s ease',
                  cursor: "pointer",
                }}
                size="2x"
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "white";
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "#ff7400";
                }}
              />
            </div>))}
      </div>

      {/* Leaderboard Section */}
      <div id="leaderboard" className="leaderboard-section">
        <Leaderboard />
      </div>

      {/* Contact Section */}
      <div id="contact" className="contact-section">
        <h2>Contact Us</h2>
        <p style={{ color: "#aaa", marginTop: "1rem" }}>
          Need help or have feedback? Email us at <a href="mailto:stefanromanpers@gmail.com" style={{ color: 'inherit' }}>
            stefanromanpers@gmail.com</a>
        </p>

        <p className="logos-info" style={{
          marginTop: "1rem",
          fontSize: "0.75rem",       // smaller font
          color: "#aaaaaa",          // light gray
          fontWeight: "normal",      // de-emphasized
          opacity: 0.7,              // subtle fade
        }}>

          All logos and brands are property of their respective owners and are used for identification purposes only.
        </p>
      </div>

    </div>
  );
};

// Shared input styling
const inputStyle = {
  padding: "0.75rem 1rem",
  borderRadius: "8px",
  border: "none",
  outline: "none",
  fontSize: "1rem",
};


export default Landpage;
