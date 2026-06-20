import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React, { useState } from 'react'
import { showErrorAlert, showNewUserAlert } from '../utils/Alerts';
import { useDispatch } from "react-redux";
import type { AppDispatch } from "../store";
import { setTokens } from "../utils/Api";
import { login } from "../store/userSlice";
import { BACKEND_URL } from "../configurations/backend";
import { faEye, faEyeSlash } from '@fortawesome/free-solid-svg-icons';
import { faGoogle } from '@fortawesome/free-brands-svg-icons';
import { useGoogleLogin } from '@react-oauth/google';
import { AnimatePresence, motion } from 'framer-motion';

interface LogInSignUpProps {
  mode: "login" | "signup";
  onModeChange: (mode: "login" | "signup") => void;
  /** Called after a successful auth so the host can dismiss the modal. */
  onClose: () => void;
}

/** Auth form rendered inside the modal — segmented Log in / Sign up tabs. */
function LogInSignUp({ mode, onModeChange, onClose }: LogInSignUpProps) {
  const isSignup = mode === "signup";
  const [userId, setUserId] = useState("");
  const [userPassword, setUserPassword] = useState("");
  const [signupUsername, setSignupUsername] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMatchError, setPasswordMatchError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const dispatch = useDispatch<AppDispatch>();

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
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
        dispatch(login(data.user));
        setTokens(data.access, data.refresh);
        onClose();
      }
    } catch (err) {
      console.error("Login error:", err);
      showErrorAlert("Unable to contact the server. Please try again later.", "Network Error");
      setIsSubmitting(false);
    }
  };

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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: signupUsername, email: signupEmail, password: userPassword }),
      });
      const data = await response.json();

      if (!response.ok || data.error) {
        showErrorAlert(data.error || "Signup failed", "Authentication Failed");
        setIsSubmitting(false);
      } else {
        localStorage.setItem("accessToken", data.access);
        localStorage.setItem("refreshToken", data.refresh);
        dispatch(login(data.user));
        showNewUserAlert(data.user.username);
        onClose();
      }
    } catch (err) {
      console.error("Signup error:", err);
      showErrorAlert("Unable to contact the server. Please try again later.", "Network Error");
      setIsSubmitting(false);
    }
  };

  const googleLogin = useGoogleLogin({
    flow: 'auth-code',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onSuccess: async (codeResponse: { code: any; }) => {
      setIsSubmitting(true);
      try {
        const response = await fetch(`${BACKEND_URL}/login/google/`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: codeResponse.code }),
        });
        const data = await response.json();

        if (!response.ok || data.error) {
          showErrorAlert(data.error || "Google Authentication Failed", "Login Failed");
          setIsSubmitting(false);
          return;
        }

        localStorage.setItem("accessToken", data.access);
        localStorage.setItem("refreshToken", data.refresh);
        dispatch(login(data.user));
        if (data.new_account === true) showNewUserAlert(data.user.username);
        onClose();
      } catch (err) {
        console.error("Unexpected error during Google login:", err);
        showErrorAlert("Unable to contact the server. Please try again later.", "Network Error");
        setIsSubmitting(false);
      }
    },
    onError: () => {
      console.error("Google login failed");
      setIsSubmitting(false);
    }
  });

  return (
    <div className="auth-stack">
      <div className="auth-tabs">
        <button type="button" className={`auth-tab${!isSignup ? " is-active" : ""}`} onClick={() => onModeChange("login")}>Log in</button>
        <button type="button" className={`auth-tab${isSignup ? " is-active" : ""}`} onClick={() => onModeChange("signup")}>Sign up</button>
      </div>

      <form className="auth-stack" onSubmit={isSignup ? handleSignUp : handleLogin}>
        {isSignup ? (
          <>
            <input
              type="email"
              className="modal-input"
              required
              placeholder="Email"
              value={signupEmail}
              onChange={(e) => setSignupEmail(e.target.value)}
            />
            <AnimatePresence>
              <motion.input
                key="signup-username"
                type="text"
                className="modal-input"
                required
                pattern="[A-Za-z]{3,}[0-9]{2,}"
                title="Username must start with at least 3 letters followed by at least 2 numbers (e.g., 'Baller23')"
                placeholder="Username"
                value={signupUsername}
                onChange={(e) => setSignupUsername(e.target.value)}
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25 }}
              />
            </AnimatePresence>
          </>
        ) : (
          <input
            type="text"
            className="modal-input"
            required
            placeholder="Username or email"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          />
        )}

        <div className="auth-pw-wrap">
          <input
            type={showPassword ? "text" : "password"}
            className="modal-input"
            placeholder="Password"
            required
            style={{ paddingRight: 44 }}
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
          <button type="button" className="auth-pw-toggle" aria-label="Toggle password visibility" onClick={() => setShowPassword(!showPassword)}>
            <FontAwesomeIcon icon={showPassword ? faEyeSlash : faEye} />
          </button>
        </div>

        <AnimatePresence>
          {isSignup && (
            <motion.div
              key="signup-confirm"
              style={{ width: "100%" }}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
            >
              <input
                type="password"
                className="modal-input"
                placeholder="Confirm password"
                required
                minLength={6}
                pattern=".*\d.*"
                title="Password must be at least 6 characters long and contain at least one number."
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  setPasswordMatchError(e.target.value !== userPassword ? "Passwords do not match" : "");
                }}
                style={{ borderColor: passwordMatchError ? "var(--bad)" : undefined }}
              />
              {passwordMatchError && <p className="auth-error" style={{ marginTop: 8 }}>{passwordMatchError}</p>}
            </motion.div>
          )}
        </AnimatePresence>

        <button type="submit" className="modal-primary-btn" disabled={isSubmitting}>
          {isSubmitting ? (isSignup ? "Creating…" : "Logging in…") : (isSignup ? "Create account" : "Log in")}
        </button>
      </form>

      <div className="auth-divider"><span /> or <span /></div>

      <button type="button" className="auth-google" onClick={() => googleLogin()} disabled={isSubmitting}>
        <FontAwesomeIcon icon={faGoogle} />
        Continue with Google
      </button>

      <p className="auth-note">
        {isSignup ? "Already have an account? " : "Don't have an account? "}
        <button
          type="button"
          style={{ color: "var(--brand)", cursor: "pointer", fontWeight: 700, background: "none", border: "none", padding: 0, font: "inherit" }}
          onClick={() => onModeChange(isSignup ? "login" : "signup")}
        >
          {isSignup ? "Log in" : "Sign up"}
        </button>
      </p>
    </div>
  );
}

export default LogInSignUp;
