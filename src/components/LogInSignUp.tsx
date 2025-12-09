import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React, { useState } from 'react'
import { showErrorAlert, showNewUserAlert } from '../utils/Alerts';
import { useDispatch } from "react-redux";
import type { AppDispatch } from "../store";
import { setTokens } from "../utils/Api";
import { login } from "../store/userSlice";
import { BACKEND_URL } from "../configurations/backend";
import { faEye, faEyeSlash } from '@fortawesome/free-solid-svg-icons';
import { buttonStyle, colors, handleMouseEnter, handleMouseLeave } from '../constants/styles';
import { faGoogle } from '@fortawesome/free-brands-svg-icons';
import { useGoogleLogin } from '@react-oauth/google';
import { scrollToSection } from '../utils/ScrolllToSection';

function LogInSignUp() {
  const [isSignup, setIsSignup] = useState(false);
  const [userId, setUserId] = useState("");
  const [userPassword, setUserPassword] = useState("");
  const [signupUsername, setSignupUsername] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMatchError, setPasswordMatchError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const dispatch = useDispatch<AppDispatch>();

  

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);
    const response = await fetch(`${BACKEND_URL}/login/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: userId, password: userPassword }),
    });
    const data = await response.json();
    if (data.error) {
      showErrorAlert(data.error, "Authentication Failed");
      setIsSubmitting(false);
    } else {
      scrollToSection("login");
      setIsLoading(true);

      setTimeout(() => {
        dispatch(login(data.user));
        setTokens(data.access, data.refresh);
        setIsLoading(false);
        setIsSubmitting(false);
      }, 2000);

      
    }
   
  }

  const handleSignUp = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);

    if (!signupUsername || !signupEmail || !userPassword || !confirmPassword) {
      showErrorAlert("Please fill in all required fields.", "Missing Fields");
      setIsSubmitting(false);
      return;
    }

    if (userPassword !== confirmPassword) {
      showErrorAlert("Passwords do not match. Please try again.", "Password Mismatch");
      setIsSubmitting(false);
      return;
    }

    try {
      const response = await fetch(`${BACKEND_URL}/signup/`, {
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
      

      if (!response.ok || data.error) {
        showErrorAlert(data.error || "Signup failed", "Authentication Failed");
        setIsSubmitting(false);
      } else {
        // Save tokens in localStorage
        localStorage.setItem("accessToken", data.access);
        localStorage.setItem("refreshToken", data.refresh);

        // Update Redux state
        scrollToSection("login");
        setIsLoading(true);
        setTimeout(() => {
          dispatch(login(data.user));
          showNewUserAlert(data.user.username);
          setIsLoading(false);
          setIsSubmitting(false);
        }, 2000);
      }
    } catch (err) {
      console.error("Signup error:", err);
      showErrorAlert("Unable to contact the server. Please try again later.", "Network Error");
    }
  };

  const googleLogin = useGoogleLogin({
    flow: 'auth-code',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onSuccess: async (codeResponse: { code: any; }) => {
      

      try {
        const response = await fetch(`${BACKEND_URL}/login/google/`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: codeResponse.code }),
        });
        setIsSubmitting(true);
        const data = await response.json();
        

        if (!response.ok || data.error) {
          showErrorAlert(data.error || "Google Authentication Failed", "Login Failed");
          setIsSubmitting(false);
          return;

        }

        // Save tokens like normal login
        localStorage.setItem("accessToken", data.access);
        localStorage.setItem("refreshToken", data.refresh);

        scrollToSection("login");
        setIsLoading(true);
        setTimeout(() => {
          dispatch(login(data.user));
          
          if (data.new_account === true) {
            showNewUserAlert(data.user.username);
          }
          setIsLoading(false);
          setIsSubmitting(false);
        }, 2000);

      } catch (err) {
        console.error("Unexpected error during Google login:", err);
      }
    },
    onError: () => {
      console.error("Google login failed");
    }
  });



  return (
    <>
      {isLoading ? <div className='loader self-center'></div> : <div className="login-signup-box flex flex-col items-center justify-center" id='login-signup-box'>

        <h2 className="text-2xl font-extrabold">
          {isSignup ? "Sign Up" : "Log In"}
        </h2>

        <form className="mt-4 flex flex-col gap-4 items-center justify-center" onSubmit={isSignup ? handleSignUp : handleLogin}>
          <input
            type={isSignup ? "email" : "text"}
            className="basketball-input"
            required
            value={isSignup ? signupEmail : userId}
            onChange={(e) => isSignup ? setSignupEmail(e.target.value) : setUserId(e.target.value)}
            placeholder={isSignup ? "Email" : "Username or Email"}
          />
          {isSignup && (
            <input
              type="text"
              className="basketball-input"
              required
              pattern="[A-Za-z]{3,}[0-9]{2,}"
              title="Username must start with at least 3 letters followed by at least 2 numbers (e.g., 'Baller23')"
              placeholder="Username"
              value={signupUsername}
              onChange={(e) => setSignupUsername(e.target.value)}
            />
          )}
          <div style={{ position: "relative" }}>
            <input
              type={showPassword ? "text" : "password"}
              className="basketball-input password"
              placeholder="Password"
              required
              style={{ paddingRight: "40px" }}
              value={userPassword}
              onChange={(e) => {
                setUserPassword(e.target.value);
                if (isSignup && confirmPassword && e.target.value !== confirmPassword) {
                  setPasswordMatchError("Passwords do not match");
                } else {
                  setPasswordMatchError("");
                }
              }}
            />
            <FontAwesomeIcon
              icon={showPassword ? faEyeSlash : faEye}
              style={{ position: "absolute", top: "15px", right: "20px" }}
              onClick={() => setShowPassword(!showPassword)}
            />
          </div>

          {isSignup && (
            <div style={{ width: "100%" }}>
              <input
                type="password"
                className="basketball-input"
                placeholder="Confirm Password"
                required
                minLength={6}
                pattern=".*\d.*"
                title="Password must be at least 6 characters long and contain at least one number."
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  if (e.target.value !== userPassword) {
                    setPasswordMatchError("Passwords do not match");
                  } else {
                    setPasswordMatchError("");
                  }
                }}
                style={{
                  border: passwordMatchError ? "2px solid #ff4d4d" : undefined,
                }}
              />

              {passwordMatchError && (
                <p style={{ color: "#ff4d4d", marginTop: "20px", fontSize: "1rem", font: "bold" }}>
                  {passwordMatchError}
                </p>
              )}
            </div>
          )}


          <button type="submit" id="submit-button" style={{ ...buttonStyle }} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} disabled={isSubmitting}
          >
            {isSignup ? "Sign Up" : "Log In"}
          </button>
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
      </div>}

    </>
  )
}

export default LogInSignUp;
