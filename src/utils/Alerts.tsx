// utils/alerts.ts (or any common file)
// sweetalert2 is dynamically imported: alerts only fire on user actions, so the
// library (~16KB gz) stays out of the startup bundle.
const getSwal = async () => (await import("sweetalert2")).default;

export async function showErrorAlert(message: string, title: string = "Error", confirmButtonText: string = "Try Again") {
  const Swal = await getSwal();
  return Swal.fire({
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

/** Yes/no question in the same popup style; resolves true when confirmed. Escape/Stay = false. */
export async function showConfirm(message: string, title: string, confirmButtonText: string, cancelButtonText = "Stay"): Promise<boolean> {
  const Swal = await getSwal();
  const result = await Swal.fire({
    icon: "question",
    title,
    html: `<p style="font-size: 0.95rem; margin-top: 0.5rem;">${message}</p>`,
    background: "#1c1c1e",
    color: "#f5f3ef",
    confirmButtonText,
    cancelButtonText,
    showCancelButton: true,
    reverseButtons: true,
    focusCancel: true,
    customClass: {
      popup: "swal2-custom-popup",
      confirmButton: "swal2-custom-button",
      cancelButton: "swal2-custom-button swal2-custom-button--ghost",
    },
    buttonsStyling: false,
    allowOutsideClick: false,
    allowEscapeKey: true,
    iconColor: "#ff6a1a",
  });
  return result.isConfirmed;
}
