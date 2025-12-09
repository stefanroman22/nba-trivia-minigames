// utils/alerts.ts (or any common file)
import Swal from "sweetalert2";

export function showErrorAlert(message: string, title: string = "Error") {
  Swal.fire({
    icon: "error",
    title,
    html: `<p style="font-size: 1rem; color: #ccc; margin-top: 0.5rem;">${message}</p>`,
    background: "#1f1f1f",
    color: "#ffffff",
    confirmButtonText: "Try Again",
    confirmButtonColor: "#EA750E",
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
    text: `Welcome, ${username}! Glad to have you here!`,
    background: '#1f1f1f',
    color: '#ffffff',
    confirmButtonColor: '#EA750E',
    timer: 1500,
    showConfirmButton: false,
  });
}
