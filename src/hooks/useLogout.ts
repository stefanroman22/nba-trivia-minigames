import { useRef, useState } from "react";
import { useDispatch } from "react-redux";
import type { AppDispatch } from "../store";
import { logout } from "../store/userSlice";
import { showErrorAlert } from "../utils/Alerts";
import { BACKEND_URL } from "../configurations/backend";
import { useModal } from "../context/ModalContext";

/** Log out: revoke the refresh token server-side, then clear the session. Used by the header
 *  profile menu, the mobile drawer and the Profile settings page, always through `requestLogOut`
 *  (the "Log out?" confirm); `logOut` itself skips the question. */
export function useLogout() {
  const dispatch = useDispatch<AppDispatch>();
  const { open } = useModal();
  const [loggingOut, setLoggingOut] = useState(false);
  // A ref, not the state: the confirm modal holds the logOut of the render that opened it, whose
  // `loggingOut` is stale, so a double tap would otherwise run it twice.
  const busy = useRef(false);

  const logOut = async () => {
    if (busy.current) return;
    busy.current = true;
    const refreshToken = localStorage.getItem("refreshToken");
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    setLoggingOut(true);
    try {
      // Already logged out (another tab, or a second tap after the first finished): nothing to revoke,
      // and a POST without a token would only come back as an error alert.
      if (!refreshToken) return;
      const res = await fetch(`${BACKEND_URL}/logout/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh: refreshToken }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.error) showErrorAlert(data.error, "Unable to Log Out!");
    } catch {
      // The tokens are already gone locally; the server-side revoke can fail without blocking logout.
    } finally {
      dispatch(logout());
      setLoggingOut(false);
      busy.current = false;
    }
  };

  /** Ask "Log out?" first (the in-app confirm modal); "Log out" there runs logOut. */
  const requestLogOut = () => open("confirmLogout", { onConfirm: () => { void logOut(); } });

  return { loggingOut, logOut, requestLogOut };
}
