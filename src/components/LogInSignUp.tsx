import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useDispatch } from "react-redux";
import type { AppDispatch } from "../store";
import { setTokens } from "../utils/Api";
import { isBanPayload, reportBan } from "../utils/ban";
import { nameNoteSlot, useNameCheck } from "../utils/nameCheck";
import { login } from "../store/userSlice";
import { BACKEND_URL } from "../configurations/backend";
import { isInAppBrowser } from "../utils/inAppBrowser";
import ConsentFields from "./ConsentFields";
import PasswordRules from "./PasswordRules";
import { passwordRules } from "../utils/passwordRules";
import { EMPTY_CONSENT, consentComplete, consentPayload, type ConsentValue } from "../utils/consent";
import { faEye, faEyeSlash } from '@fortawesome/free-solid-svg-icons';
import { faGoogle } from '@fortawesome/free-brands-svg-icons';
import { GoogleOAuthProvider, useGoogleLogin } from '@react-oauth/google';
import { AnimatePresence, animate, motion, useIsPresent, useMotionValue, useReducedMotion, type AnimationPlaybackControls } from 'framer-motion';
import SwapText from './motion/SwapText';
import SegmentedTabs from './motion/SegmentedTabs';
import SuccessBadge from './motion/SuccessBadge';
import { SHEET_QUERY } from './ui/Modal';
import { durations, easing } from '../motion/tokens';
import { errorIn, errorShake, fadeIn, fadeInUp, reducedFade, staggerContainer, swap } from '../motion/variants';

const AUTH_MODES: { key: "login" | "signup"; label: string }[] = [
  { key: "login", label: "Log in" },
  { key: "signup", label: "Sign up" },
];

/** The form's one state machine. Extend the union (e.g. a moderation state) rather than adding flags. */
export type AuthPhase = "idle" | "submitting" | "error" | "success";
type AuthField = "identifier" | "email" | "username" | "password";
interface AuthError { id: number; message: string; field?: AuthField }

const NETWORK_ERROR = "Unable to contact the server. Please try again later.";
const CONSENT_NEEDED = "Please enter your birth month and year and agree to the Terms and Privacy Policy.";
/** How long the success pane holds before the modal leaves (after the form's fade-out). The sheet
 *  (mobile) and reduced-motion holds are shorter; a tap skips once SKIP_AFTER_MS has passed. */
const SUCCESS_HOLD_MS = 800;
const SUCCESS_HOLD_SHORT_MS = 600;
const SKIP_AFTER_MS = 300;
/** The mode-switch height glide (the only animator of the stack's height). */
const HEIGHT_GLIDE = { duration: durations.base, ease: easing.inOut };

/** Best guess at which sign-up field a server message is about, so it can be marked. */
const fieldForMessage = (message: string): AuthField | undefined =>
  /e-?mail/i.test(message) ? "email" : /password/i.test(message) ? "password" : /user|name/i.test(message) ? "username" : undefined;

interface LogInSignUpProps {
  mode: "login" | "signup";
  onModeChange: (mode: "login" | "signup") => void;
  /** Called after a successful auth (once the success state has played) so the host can dismiss the modal. */
  onClose: () => void;
  /** Reports the form phase so the host can switch the modal shell into its success takeover. */
  onPhaseChange?: (phase: AuthPhase) => void;
}

/** Auth form rendered inside the modal — segmented Log in / Sign up tabs. */
function LogInSignUp({ mode, onModeChange, onClose, onPhaseChange }: LogInSignUpProps) {
  const isSignup = mode === "signup";
  const reduce = useReducedMotion();
  const isPresent = useIsPresent();
  const [userId, setUserId] = useState("");
  const [userPassword, setUserPassword] = useState("");
  const [signupUsername, setSignupUsername] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [phase, setPhase] = useState<AuthPhase>("idle");
  // Terms + age answers, and the signed token of a Google identity waiting for them (a new account).
  const [consent, setConsent] = useState<ConsentValue>(EMPTY_CONSENT);
  const [googleToken, setGoogleToken] = useState<string | null>(null);
  // `id` keys the alert and the field shake so a repeat of the same message replays both.
  const [error, setError] = useState<AuthError | null>(null);
  const [welcome, setWelcome] = useState<{ name: string; isNew: boolean; height: number } | null>(null);
  const [canSkip, setCanSkip] = useState(false);
  const errorSeq = useRef(0);
  const submittingRef = useRef(false);
  const closedRef = useRef(false);
  const presentRef = useRef(isPresent);
  const formRef = useRef<HTMLDivElement>(null);
  const fieldRefs = useRef<Partial<Record<AuthField, HTMLElement | null>>>({});
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const lastHeight = useRef(0);
  const glide = useRef<{ controls: AnimationPlaybackControls; to: number } | null>(null);
  // Rows that keep their place across a mode switch (password row; submit..footer block) and the
  // y offsets that make them ride the height glide on the SAME clock (see glideTo).
  const pwRowRef = useRef<HTMLDivElement>(null);
  const tailRef = useRef<HTMLDivElement>(null);
  const pwY = useMotionValue(0);
  const tailY = useMotionValue(0);
  const lastOffsets = useRef({ pw: 0, tail: 0 });

  const dispatch = useDispatch<AppDispatch>();
  // Live server check of the sign-up name (reserved / not allowed); the server re-checks on submit.
  const nameNote = useNameCheck(signupUsername, isSignup);

  // A mode switch drops the previous mode's error in the same commit as the field swap, so the
  // panel changes height once.
  const [prevMode, setPrevMode] = useState(mode);
  if (mode !== prevMode) {
    setPrevMode(mode);
    setError(null);
    if (phase === "error") setPhase("idle");
  }

  useEffect(() => { onPhaseChange?.(phase); }, [phase, onPhaseChange]);
  useEffect(() => { presentRef.current = isPresent; }, [isPresent]);

  /* ---- Height: ONE animator per change ----
     The stack's wrapper is height:auto (follows content instantly; the error and name-note slots
     glide their own height). Only a mode switch glides the wrapper: from the last measured height
     to the new one, then it returns to auto. The ResizeObserver keeps the last height (and the
     followers' offsets) and retargets a glide still in flight.
     Followers: one tween drives both the wrapper height and the rows that persist across the
     switch. Each row is offset by (h - to) * k, k = its layout shift / the height change, so it
     starts at its old place and lands at its new one in lockstep with the height (same frame, same
     value). On the bottom-anchored sheet that exactly cancels the moving top edge (rows below the
     swapped fields stay still); on the centred desktop panel they move once, smoothly. Transform
     only: no second height animator. */
  const readOffsets = useCallback(
    () => ({ pw: pwRowRef.current?.offsetTop ?? 0, tail: tailRef.current?.offsetTop ?? 0 }),
    [],
  );

  const glideTo = useCallback((to: number, retarget = false) => {
    const outer = outerRef.current;
    if (!outer) return;
    const from = glide.current ? outer.offsetHeight : lastHeight.current;
    glide.current?.controls.stop();
    glide.current = null;
    const offsets = readOffsets();
    // A retarget (content changed mid-glide) lets the followers settle; only the height continues.
    const kPw = !retarget && from !== to ? (offsets.pw - lastOffsets.current.pw) / (to - from) : 0;
    const kTail = !retarget && from !== to ? (offsets.tail - lastOffsets.current.tail) / (to - from) : 0;
    lastOffsets.current = offsets;
    const release = () => {
      glide.current = null;
      outer.style.height = "";
      outer.style.overflow = "";
      pwY.set(0);
      tailY.set(0);
    };
    if (!from || from === to) { release(); return; }
    const apply = (h: number) => {
      outer.style.height = `${h}px`;
      pwY.set((h - to) * kPw);
      tailY.set((h - to) * kTail);
    };
    apply(from);
    outer.style.overflow = "hidden";
    const controls = animate(from, to, { ...HEIGHT_GLIDE, onUpdate: apply, onComplete: release });
    glide.current = { controls, to };
  }, [readOffsets, pwY, tailY]);

  useEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;
    lastHeight.current = inner.offsetHeight;
    lastOffsets.current = readOffsets();
    const ro = new ResizeObserver(() => {
      const h = inner.offsetHeight;
      if (glide.current && glide.current.to !== h) glideTo(h, true);
      lastHeight.current = h;
      lastOffsets.current = readOffsets();
    });
    ro.observe(inner);
    return () => {
      ro.disconnect();
      glide.current?.controls.stop();
      glide.current = null;
    };
  }, [glideTo, readOffsets]);

  // Runs after the commit that swapped the fields (popLayout has already taken the leaving ones
  // out of flow), before paint: the inner height is the final one from the first frame.
  const firstLayout = useRef(true);
  useLayoutEffect(() => {
    if (firstLayout.current) { firstLayout.current = false; return; }
    if (reduce || !innerRef.current) return;
    glideTo(innerRef.current.offsetHeight);
  }, [mode, reduce, glideTo]);

  /* ---- Errors ---- */
  const fail = (message: string, field?: AuthField) => {
    submittingRef.current = false;
    setError({ id: ++errorSeq.current, message, field });
    setPhase("error");
  };

  // Shake the offending field once per error (transform only); reduced motion: border colour only.
  useEffect(() => {
    if (!error?.field || reduce) return;
    const el = fieldRefs.current[error.field];
    if (!el) return;
    const controls = animate(el, errorShake.keyframes, errorShake.transition);
    // complete(), not stop(): an error cleared mid-shake must settle the field on x: 0.
    return () => controls.complete();
  }, [error, reduce]);

  const fieldBad = (field: AuthField) => error?.field === field;
  const setFieldRef = (field: AuthField) => (el: HTMLElement | null) => { fieldRefs.current[field] = el; };

  /** Starts a submit; false when one is already running (double-submit guard). */
  const begin = () => {
    if (submittingRef.current) return false;
    submittingRef.current = true;
    setError(null);
    setPhase("submitting");
    return true;
  };

  /* ---- Success ---- */
  const succeed = (name: string, isNew: boolean) => {
    // The pane holds the form's height so the panel does not jump when the form leaves.
    setWelcome({ name, isNew, height: formRef.current?.offsetHeight ?? 0 });
    setPhase("success");
  };

  const finish = useCallback(() => {
    // Never close after the modal was already dismissed (Escape / backdrop / X mid-success).
    if (closedRef.current || !presentRef.current) return;
    closedRef.current = true;
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (phase !== "success") return;
    const short = !!reduce || window.matchMedia(SHEET_QUERY).matches;
    const skip = setTimeout(() => setCanSkip(true), SKIP_AFTER_MS);
    const done = setTimeout(finish, durations.fast * 1000 + (short ? SUCCESS_HOLD_SHORT_MS : SUCCESS_HOLD_MS));
    return () => {
      clearTimeout(skip);
      clearTimeout(done);
    };
  }, [phase, reduce, finish]);

  // 403 `account_banned` from login / signup / Google login: the ban screen takes over (the
  // slice's `banned` state, not a form state), so close the form instead of alerting.
  const handledBan = (response: Response, data: unknown) => {
    if (response.status !== 403 || !isBanPayload(data)) return false;
    submittingRef.current = false;
    setPhase("idle");
    reportBan(data);
    onClose();
    return true;
  };

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!begin()) return;
    try {
      const response = await fetch(`${BACKEND_URL}/login/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: userId, password: userPassword }),
      });
      const data = await response.json();
      if (handledBan(response, data)) return;
      if (data.error) {
        fail(data.error, "password");
      } else {
        dispatch(login(data.user));
        setTokens(data.access, data.refresh);
        succeed(data.user.username, false);
      }
    } catch (err) {
      console.error("Login error:", err);
      fail(NETWORK_ERROR);
    }
  };

  const handleSignUp = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!begin()) return;

    if (!signupUsername || !signupEmail || !userPassword) {
      fail(
        "Please fill in all required fields.",
        !signupEmail ? "email" : !signupUsername ? "username" : "password",
      );
      return;
    }
    if (passwordRules(userPassword, signupUsername, signupEmail).some((r) => !r.ok)) {
      fail("Your password doesn't meet the requirements below it yet.", "password");
      return;
    }

    if (!consentComplete(consent)) {
      fail(CONSENT_NEEDED);
      return;
    }
    try {
      const response = await fetch(`${BACKEND_URL}/signup/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: signupUsername, email: signupEmail, password: userPassword, ...consentPayload(consent) }),
      });
      const data = await response.json();
      if (handledBan(response, data)) return;

      if (!response.ok || data.error) {
        const message = data.error || "Signup failed";
        fail(message, fieldForMessage(message));
      } else {
        localStorage.setItem("accessToken", data.access);
        localStorage.setItem("refreshToken", data.refresh);
        dispatch(login(data.user));
        succeed(data.user.username, true);
      }
    } catch (err) {
      console.error("Signup error:", err);
      fail(NETWORK_ERROR);
    }
  };

  /** POST a Google code (or, for a new account, the consent token) and act on the answer. */
  const sendGoogle = async (body: Record<string, unknown>) => {
    try {
      const response = await fetch(`${BACKEND_URL}/login/google/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (handledBan(response, data)) return;

      // A brand-new Google account: Google verified them, now we need the age + Terms answers.
      if (response.status === 428 && data.consent_token) {
        setGoogleToken(data.consent_token);
        submittingRef.current = false;
        setPhase("idle");
        return;
      }

      if (!response.ok || data.error) {
        if (body.consent_token && !data.code) setGoogleToken(null); // expired or tampered: start over
        fail(data.error || "Google Authentication Failed");
        return;
      }

      setGoogleToken(null);
      localStorage.setItem("accessToken", data.access);
      localStorage.setItem("refreshToken", data.refresh);
      dispatch(login(data.user));
      succeed(data.user.username, data.new_account === true);
    } catch (err) {
      console.error("Unexpected error during Google login:", err);
      fail(NETWORK_ERROR);
    }
  };

  const completeGoogleSignup = async () => {
    if (!googleToken || !begin()) return;
    if (!consentComplete(consent)) {
      fail(CONSENT_NEEDED);
      return;
    }
    await sendGoogle({ consent_token: googleToken, ...consentPayload(consent) });
  };

  const googleLogin = useGoogleLogin({
    flow: 'auth-code',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onSuccess: async (codeResponse: { code: any; }) => {
      if (!begin()) return;
      await sendGoogle({ code: codeResponse.code, ...(consentComplete(consent) ? consentPayload(consent) : {}) });
    },
    onError: () => {
      console.error("Google login failed");
      fail("Google sign-in didn't complete. Please try again.");
    },
    // The popup never opened (blocker) or was closed before Google answered.
    onNonOAuthError: (err) => {
      if (err.type === "popup_failed_to_open") {
        fail("Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again.");
        return;
      }
      submittingRef.current = false;
      setPhase((p) => (p === "submitting" ? "idle" : p));
    },
  });

  const startGoogleLogin = () => {
    if (submittingRef.current) return;
    // Google refuses OAuth inside social apps' built-in browsers; say so instead of failing.
    if (isInAppBrowser(navigator.userAgent)) {
      fail("Google doesn't allow sign-in inside this app's browser. Open this page in Safari or Chrome, or log in with your email.");
      return;
    }
    googleLogin();
  };

  const busy = phase === "submitting" || phase === "success";
  const field = reduce ? reducedFade : swap;
  const pane = reduce ? reducedFade : fadeIn;
  const submitLabel = isSignup ? "Create account" : "Log in";
  const busyLabel = isSignup ? "Creating…" : "Logging in…";

  return (
    <div ref={outerRef}>
      <div ref={innerRef}>
        <AnimatePresence mode="wait" initial={false}>
          {phase === "success" && welcome ? (
            <SuccessPane
              key="success"
              welcome={welcome}
              reduce={!!reduce}
              onSkip={canSkip ? finish : undefined}
            />
          ) : (
            <motion.div key="form" ref={formRef} className="auth-stack" variants={pane} initial={false} animate="visible" exit="exit">
              <SegmentedTabs
                className="auth-tabs"
                itemClassName="auth-tab"
                thumbRadius={8}
                options={AUTH_MODES}
                value={mode}
                onChange={onModeChange}
              />

              <form className="auth-stack auth-form" onSubmit={isSignup ? handleSignUp : handleLogin} aria-busy={phase === "submitting"}>
                {/* Every mode-dependent field in ONE presence group: popLayout takes leaving fields
                    out of flow at once, so entering and leaving fields cross over together with the
                    single height glide. The password row is a persistent member of the group. */}
                <AnimatePresence mode="popLayout" initial={false}>
                  {isSignup ? (
                    <motion.div key="signup-email" variants={field} initial="hidden" animate="visible" exit="exit">
                      <input
                        ref={setFieldRef("email")}
                        type="email"
                        className="modal-input"
                        required
                        aria-label="Email"
                        placeholder="Email"
                        aria-invalid={fieldBad("email") || undefined}
                        style={{ borderColor: fieldBad("email") ? "var(--bad)" : undefined }}
                        value={signupEmail}
                        onChange={(e) => setSignupEmail(e.target.value)}
                      />
                    </motion.div>
                  ) : (
                    <motion.div key="login-identifier" variants={field} initial="hidden" animate="visible" exit="exit">
                      <input
                        ref={setFieldRef("identifier")}
                        type="text"
                        className="modal-input"
                        required
                        aria-label="Email or username"
                        placeholder="Email or username"
                        title="Use your email, your username, or Name#ID if several players share your name."
                        aria-invalid={fieldBad("identifier") || undefined}
                        style={{ borderColor: fieldBad("identifier") ? "var(--bad)" : undefined }}
                        value={userId}
                        onChange={(e) => setUserId(e.target.value)}
                      />
                    </motion.div>
                  )}
                  {isSignup && (
                    <motion.div key="signup-username" variants={field} initial="hidden" animate="visible" exit="exit">
                      <input
                        ref={setFieldRef("username")}
                        type="text"
                        className="modal-input"
                        required
                        pattern="[A-Za-z0-9_]{3,20}"
                        title="3-20 characters: letters, numbers or underscores. Names don't have to be unique."
                        aria-label="Username"
                        placeholder="Username (any name)"
                        aria-invalid={fieldBad("username") || undefined}
                        style={{ borderColor: fieldBad("username") ? "var(--bad)" : undefined }}
                        value={signupUsername}
                        onChange={(e) => setSignupUsername(e.target.value)}
                      />
                    </motion.div>
                  )}
                  {isSignup && (
                    <motion.div key="signup-name-note-slot" className="auth-field-note-slot" role="status" aria-live="polite" variants={field} initial="hidden" animate="visible" exit="exit">
                      <AnimatePresence initial={false}>
                        {nameNote && (
                          <motion.div
                            key="signup-name-note"
                            style={{ overflow: "hidden" }}
                            variants={nameNoteSlot}
                            initial="hidden"
                            animate="visible"
                            exit="hidden"
                          >
                            <p className="auth-error auth-field-note"><SwapText>{nameNote}</SwapText></p>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  )}

                  <motion.div key="password" ref={pwRowRef} style={{ y: pwY }}>
                    <div className="auth-pw-wrap" ref={setFieldRef("password")}>
                      <input
                        type={showPassword ? "text" : "password"}
                        className="modal-input"
                        aria-label="Password"
                        placeholder="Password"
                        required
                        minLength={isSignup ? 8 : undefined}
                        autoComplete={isSignup ? "new-password" : "current-password"}
                        aria-invalid={fieldBad("password") || undefined}
                        style={{ paddingRight: 44, borderColor: fieldBad("password") ? "var(--bad)" : undefined }}
                        value={userPassword}
                        onChange={(e) => setUserPassword(e.target.value)}
                      />
                      <button type="button" className="auth-pw-toggle" aria-label="Toggle password visibility" onClick={() => setShowPassword(!showPassword)}>
                        <FontAwesomeIcon icon={showPassword ? faEyeSlash : faEye} />
                      </button>
                    </div>
                    {/* One password field: the rules glide open as soon as the player types, each with
                        a live check or cross (replaces the old "Confirm password" field). */}
                    <PasswordRules show={isSignup && userPassword.length > 0} rules={passwordRules(userPassword, signupUsername, signupEmail)} />
                  </motion.div>


                  {isSignup && (
                    <motion.div key="signup-consent" variants={field} initial="hidden" animate="visible" exit="exit">
                      <ConsentFields value={consent} onChange={setConsent} disabled={busy} />
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Everything below the field group moves as ONE block on a mode switch: its y is
                    driven by the height glide's own tween (glideTo), so the rows ride the glide
                    instead of snapping to their new offset (transform only, no second animator). */}
                <motion.div ref={tailRef} className="auth-stack" style={{ y: tailY }}>
                  <button type="submit" className="modal-primary-btn" disabled={busy}>
                    <SwapText>{phase === "submitting" ? busyLabel : submitLabel}</SwapText>
                  </button>

                  {/* Always-mounted slot (its negative margin cancels the stack gap while empty): only
                      the clip's height and opacity glide. Keyed by mode so a mode switch drops it in
                      the same commit as the field swap (one height change). The message is keyed per
                      error so its fade-up + shake replays. */}
                  <div key={mode} className="auth-error-slot">
                    <AnimatePresence initial={false}>
                      {error && (
                        <motion.div
                          key="auth-error"
                          className="auth-error-clip"
                          variants={reduce ? reducedFade : nameNoteSlot}
                          initial="hidden"
                          animate="visible"
                          exit={reduce ? "exit" : "hidden"}
                        >
                          <motion.p
                            key={error.id}
                            role="alert"
                            aria-live="assertive"
                            className="auth-error auth-error-msg"
                            variants={reduce ? reducedFade : errorIn}
                            initial="hidden"
                            animate="visible"
                          >
                            {error.message}
                          </motion.p>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  <div className="auth-divider"><span /> or <span /></div>

                  <button type="button" className="auth-google" onClick={startGoogleLogin} disabled={busy}>
                    <FontAwesomeIcon icon={faGoogle} />
                    Continue with Google
                  </button>

                  {googleToken ? (
                    <div className="auth-consent-panel">
                      <p className="auth-note">Looks like you&apos;re new here. One last step to create your account.</p>
                      {!isSignup && <ConsentFields value={consent} onChange={setConsent} disabled={busy} />}
                      <button type="button" className="modal-primary-btn" onClick={completeGoogleSignup} disabled={busy}>
                        Create my account
                      </button>
                    </div>
                  ) : (
                    <p className="auth-note">
                      By continuing with Google you agree to our <a href="/terms" target="_blank" rel="noopener">Terms</a> and{" "}
                      <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a>.
                    </p>
                  )}

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
                </motion.div>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

interface SuccessPaneProps {
  welcome: { name: string; isNew: boolean; height: number };
  reduce: boolean;
  /** Set once the skip delay has passed: a tap/click anywhere on the pane finishes early. */
  onSkip?: () => void;
}

/** Success state. Mounted once the form has finished leaving (mode="wait"), so its mount effect is
 *  the moment to take focus (the submit button it replaced is gone); the Modal focus trap keeps it. */
function SuccessPane({ welcome, reduce, onSkip }: SuccessPaneProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);

  return (
    <motion.div
      ref={ref}
      className="auth-success"
      tabIndex={-1}
      style={{ minHeight: welcome.height, cursor: onSkip ? "pointer" : undefined }}
      onClick={onSkip}
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
    >
      <SuccessBadge />
      <motion.p role="status" aria-live="polite" className="font-display auth-success-title" variants={reduce ? reducedFade : fadeInUp}>
        {welcome.isNew ? "Welcome" : "Welcome back"}, {welcome.name}
      </motion.p>
    </motion.div>
  );
}

// Provider lives here (not app-wide in app/providers.tsx) so Google's gsi/client script
// only loads when the login modal actually mounts.
export default function LogInSignUpWithGoogle(props: LogInSignUpProps) {
  return (
    <GoogleOAuthProvider clientId="504454176332-ut7po2glf32fv3dajltgnb5aho65er7i.apps.googleusercontent.com">
      <LogInSignUp {...props} />
    </GoogleOAuthProvider>
  );
}
