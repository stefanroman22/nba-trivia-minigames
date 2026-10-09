import { useState } from "react";
import { useDispatch } from "react-redux";
import type { AppDispatch } from "../store";
import { logout } from "../store/userSlice";
import { showErrorAlert } from "../utils/Alerts";
import { BACKEND_URL } from "../configurations/backend";

/** Log out: revoke the refresh token server-side, then clear the session. Used by the header
 *  profile menu and the Profile settings page. */
export function useLogout() {
  const dispatch = useDispatch<AppDispatch>();
  const [loggingOut, setLoggingOut] = useState(false);

  const logOut = async () => {
    if (loggingOut) return;
    const refreshToken = localStorage.getItem("refreshToken");
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    setLoggingOut(true);
    try {
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
    }
  };

  return { loggingOut, logOut };
}
