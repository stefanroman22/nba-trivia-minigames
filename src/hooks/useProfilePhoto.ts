import { useState, type ChangeEvent } from "react";
import { useDispatch } from "react-redux";
import type { AppDispatch } from "../store";
import { updateProfilePhoto } from "../store/userSlice";
import { apiFetch } from "../utils/Api";
import { isBanPayload } from "../utils/ban";
import { showErrorAlert } from "../utils/Alerts";
import { PhotoPrepError, prepareProfilePhoto } from "../utils/imagePrep";
import { BACKEND_URL } from "../configurations/backend";

/** Change / remove the profile photo. Shared by the landing profile card and the Profile settings page. */
export function useProfilePhoto() {
  const dispatch = useDispatch<AppDispatch>();
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const handlePhotoUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingPhoto(true);
    try {
      let photo: Blob;
      try {
        photo = await prepareProfilePhoto(file);
      } catch (err) {
        showErrorAlert(err instanceof PhotoPrepError ? err.message : "Photo upload failed", "Upload Error");
        return;
      }
      const formData = new FormData();
      formData.append("profile_photo", photo, "photo.jpg");

      const response = await apiFetch(`${BACKEND_URL}/update-profile/`, {
        method: "POST",
        body: formData,
      });
      const data = await response.json().catch(() => null);
      if (response.ok && typeof data?.user?.profile_photo === "string") {
        // The server's normalized photo, not a local preview — what /me/ will return after reload.
        dispatch(updateProfilePhoto(data.user.profile_photo));
      } else if (response.status === 403 && isBanPayload(data)) {
        // apiFetch already reported the ban.
        return;
      } else if (data?.code === "photo_rejected") {
        showErrorAlert(data.error, "Photo not allowed");
      } else if (data?.code === "moderation_unavailable") {
        showErrorAlert(data.error, "Try again later");
      } else {
        showErrorAlert(data?.error || "Photo upload failed", "Upload Error");
      }
    } finally {
      setUploadingPhoto(false);
      e.target.value = "";
    }
  };

  const handleRemovePhoto = async () => {
    try {
      const res = await apiFetch(`${BACKEND_URL}/account/remove-photo/`, { method: "POST" });
      if (!res.ok) throw new Error(`remove-photo ${res.status}`);
      dispatch(updateProfilePhoto(null));
    } catch (err) {
      console.error("Photo removal failed:", err);
      showErrorAlert("We couldn't remove your photo. Please try again.", "Something went wrong");
    }
  };

  return { uploadingPhoto, handlePhotoUpload, handleRemovePhoto };
}
