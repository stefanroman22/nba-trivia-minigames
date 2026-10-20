import { useRef } from "react";
import { Button } from "../ui";

interface ConfirmLogoutModalProps {
  onConfirm: () => void;
  onClose: () => void;
}

/** "Log out?" asked before every log out the player starts (header menu, mobile drawer, Profile
 *  settings). Cancel is focused first, so Enter or a stray tap keeps the session. Automatic
 *  logouts (an expired session, a ban) never come through here. */
export default function ConfirmLogoutModal({ onConfirm, onClose }: ConfirmLogoutModalProps) {
  // The panel stays clickable while it animates out: a second tap must not log out twice.
  const confirmed = useRef(false);
  const confirm = () => {
    if (confirmed.current) return;
    confirmed.current = true;
    onClose();
    onConfirm();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <p style={{ margin: 0, fontSize: 14.5, color: "var(--muted)", lineHeight: 1.5 }}>Are you sure you want to log out?</p>
      <div style={{ display: "flex", gap: 10 }}>
        <Button block variant="secondary" onClick={onClose} data-autofocus>Cancel</Button>
        <Button block onClick={confirm}>Log out</Button>
      </div>
    </div>
  );
}
