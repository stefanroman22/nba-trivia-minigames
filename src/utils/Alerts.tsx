// utils/alerts.ts (or any common file)
import Swal from "sweetalert2";

export function showErrorAlert(message: string, title: string = "Error", confirmButtonText: string = "Try Again") {
  Swal.fire({
    icon: "error",
    title,
    html: `<p style="font-size: 0.95rem; margin-top: 0.5rem;">${message}</p>`,
    background: "#1c1c1e",
    color: "#f5f3ef",
    confirmButtonText,
    customClass: {
      popup: "swal2-custom-popup",
      confirmButton: "swal2-custom-button",
    },
    buttonsStyling: false,
    allowOutsideClick: false,
    allowEscapeKey: true,
    iconColor: "#ff4d4d",
  });
}

export function showNewUserAlert(username: string) {
  Swal.fire({
    icon: 'success',
    title: 'Account Created!',
    html: `<p style="font-size: 0.95rem; margin-top: 0.5rem;">Welcome, ${username}! Glad to have you here!</p>`,
    background: "#1c1c1e",
    color: "#f5f3ef",
    customClass: { popup: "swal2-custom-popup" },
    iconColor: "#2fc762",
    timer: 1600,
    showConfirmButton: false,
  });
}
