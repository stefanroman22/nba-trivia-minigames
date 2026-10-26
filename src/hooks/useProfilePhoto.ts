import { useRef, useState, type ChangeEvent } from "react";
import { useDispatch } from "react-redux";
import type { AppDispatch } from "../store";
import { updateAge, updateProfilePhoto } from "../store/userSlice";
import { apiFetch } from "../utils/Api";
import { isBanPayload } from "../utils/ban";
import { showErrorAlert } from "../utils/Alerts";
import { PhotoPrepError, prepareProfilePhoto } from "../utils/imagePrep";
import { BACKEND_URL } from "../configurations/backend";
import { LEGAL } from "../configurations/legal";

/** Change / remove the profile photo. Shared by the landing profile card and the Profile settings page.
 *
 *  An account whose age is unknown (signed up with the 13+ tick-box) is asked for its birth month and
 *  year the first time it uploads: the server answers 428 `age_required`, the prepared photo is held,
 *  `agePrompt` opens (components/PhotoAgePrompt), and once the age is saved the same photo is sent
 *  again; the server then applies the 16+ rule as for every account. */
export function useProfilePhoto() {
  const dispatch = useDispatch<AppDispatch>();
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [agePrompt, setAgePrompt] = useState(false);
  const [ageSaving, setAgeSaving] = useState(false);
  const [ageError, setAgeError] = useState("");
  const heldPhoto = useRef<Blob | null>(null);

  const sendPhoto = async (photo: Blob) => {
    const formData = new FormData();
    formData.append("profile_photo", photo, "photo.jpg");

    const response = await apiFetch(`${BACKEND_URL}/update-profile/`, {
      method: "POST",
      body: formData,
    });
    const data = await response.json().catch(() => null);
    if (response.ok && typeof data?.user?.profile_photo === "string") {
      // The server's normalized photo, not a local preview: what /me/ will return after reload.
      dispatch(updateProfilePhoto(data.user.profile_photo));
    } else if (response.status === 403 && isBanPayload(data)) {
      // apiFetch already reported the ban.
      return;
    } else if (data?.code === "age_required") {
      heldPhoto.current = photo;
      setAgeError("");
      setAgePrompt(true);
    } else if (data?.code === "photo_rejected") {
      showErrorAlert(data.error, "Photo not allowed");
    } else if (data?.code === "moderation_unavailable") {
      showErrorAlert(data.error, "Try again later");
    } else {
      showErrorAlert(data?.error || "Photo upload failed", "Upload Error");
    }
  };

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
      await sendPhoto(photo);
    } finally {
      setUploadingPhoto(false);
      e.target.value = "";
    }
  };

  /** Save the birth month + year (only the 16+ / under-16 result is kept), then retry the held photo. */
  const submitAge = async (month: string, year: string) => {
    if (ageSaving) return;
    if (!month || !year) {
      setAgeError("Please choose your birth month and year.");
      return;
    }
    setAgeSaving(true);
    setAgeError("");
    try {
      const res = await apiFetch(`${BACKEND_URL}/account/age/`, {
        method: "POST",
        body: JSON.stringify({ birth_month: Number(month), birth_year: Number(year) }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setAgeError(data?.error || "We couldn't save that. Please try again.");
        return;
      }
      // Same mapping as Profile settings' own age form, so the Date of birth row and the change count
      // follow without a reload (the server has already counted this as one of the two age sets).
      dispatch(updateAge({
        age_group: data?.user?.age_group ?? "",
        profile_photo: data?.user?.profile_photo ?? null,
        birth_month: data?.user?.birth_month ?? null,
        birth_year: data?.user?.birth_year ?? null,
        age_sets_left: data?.user?.age_sets_left ?? 0,
      }));
      setAgePrompt(false);
      const photo = heldPhoto.current;
      heldPhoto.current = null;
      // Under 16: no photo is allowed, so the held one is dropped (and the player told why) instead of being sent again.
      if (photo && data?.user?.age_group !== "adult") {
        showErrorAlert(`Profile photos are for players aged ${LEGAL.photoMinimumAge} and over.`, "Photo not allowed");
      } else if (photo) {
        setUploadingPhoto(true);
        try {
          await sendPhoto(photo);
        } finally {
          setUploadingPhoto(false);
        }
      }
    } catch (err) {
      console.error("Saving the age failed:", err);
      setAgeError("Unable to contact the server. Please try again later.");
    } finally {
      setAgeSaving(false);
    }
  };

  const cancelAge = () => {
    heldPhoto.current = null;
    setAgeError("");
    setAgePrompt(false);
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

  return { uploadingPhoto, handlePhotoUpload, handleRemovePhoto, agePrompt, ageSaving, ageError, submitAge, cancelAge };
}
