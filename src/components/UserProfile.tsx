import { useState } from "react";
import { showErrorAlert } from "../utils/Alerts";
import { useSelector, useDispatch } from "react-redux";
import type { RootState, AppDispatch } from "../store";
import { updateProfilePhoto, updateUsername } from "../store/userSlice";
import { apiFetch } from "../utils/Api";



function UserProfile() {
  const dispatch = useDispatch<AppDispatch>();
  const { user } = useSelector((state: RootState) => state.user);

  const [isEditing, setIsEditing] = useState(false);
  const [tempUsername, setTempUsername] = useState(user?.username || "");
  const [, setTempProfilePhoto] = useState(user?.profile_photo || "");

  const validateUsername = (username: string) => {
    const regex = /^(?=(?:.*[A-Za-z]){3,})(?=(?:.*[0-9]){2,})[A-Za-z0-9_]+$/;
    return regex.test(username);
  };

  const handleSave = async () => {
    if (!validateUsername(tempUsername)) {
      showErrorAlert(
        "Username must contain at least 3 letters, 2 digits, and can only include letters, digits, or underscores.",
        "Invalid Username"
      );
      return; // Stop if invalid
    }
    if (user?.username === tempUsername) {
      setIsEditing(false);
      return;
    }
   
    const response = await apiFetch("http://localhost:8000/api/update-profile/", {
      method: "POST",
      body: JSON.stringify({ username: tempUsername }),
    });

    const data = await response.json();

    if (data.error) {
      showErrorAlert(data.error, "Username change failed");
    } else {
      dispatch(updateUsername(tempUsername));
      setIsEditing(false);
    }
  };



  return (
    <div style={{ margin: "auto", padding: "2rem" }}>
      <h2
        style={{
          marginBottom: "2rem",
          fontSize: "1.5rem",
          fontWeight: "600",
          textAlign: "center",
        }}
      >
        Welcome {user?.username}!
      </h2>

      {/* Profile Photo + Change */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          marginBottom: "1.5rem",
        }}
      >
        <div
          style={{
            width: "100px",
            height: "100px",
            borderRadius: "50%",
            overflow: "hidden",
            marginBottom: "0.75rem",
            border: "3px solid #ff7a00",
            boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
          }}
        >
          <img
            src={user?.profile_photo || '../assets/default.png'}
            alt="Profile"
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            style={{ width: "100%", height: "100%", objectFit: "cover" , imageOrientation: "from-image" as any}}
          />
        </div>
        <label
          htmlFor="photo-upload"
          style={{
            cursor: "pointer",
            color: "#ff7a00",
            fontWeight: "bold",
            fontSize: "0.9rem",
            transition: "color 0.3s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "white";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "#ff7400";
          }}
        >
          Change Photo
        </label>
        <input
          id="photo-upload"
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;

            const formData = new FormData();
            formData.append("profile_photo", file);

            const response = await apiFetch("http://localhost:8000/api/update-profile/", {
              method: "POST",
              body: formData, // no need to set headers here
            });

            if (response.ok) {
              const previewURL = URL.createObjectURL(file);
              setTempProfilePhoto(previewURL);
              dispatch(updateProfilePhoto(previewURL));
            } else {
              const errorData = await response.json();
              showErrorAlert(errorData.error || "Photo upload failed", "Upload Error");
            }
          }}

        />
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        {/* Editable Username */}
        <div style={{ marginBottom: "1.2rem", width: "fit-content" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <label
              htmlFor="username"
              style={{
                display: "block",
                fontSize: "0.9rem",
                color: "#aaa",
                marginBottom: "0.3rem",
              }}
            >
              Username
            </label>
            <button
              onClick={() => {
                if (isEditing) {
                  handleSave();
                } else {
                  setTempUsername(user?.username || "");
                  setIsEditing(true);
                }
              }}
              style={{
                backgroundColor: "transparent",
                color: "#ff7400",
                border: "none",
                cursor: "pointer",
                fontSize: "0.8rem",
                padding: "0.2rem 0.5rem",
                borderRadius: "4px",
                marginLeft: "auto",
                fontWeight: "bold",
                transition: "color 0.3s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "white";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "#ff7400";
              }}

            >
              {isEditing ? "Confirm" : "Change"}
            </button>
          </div>

          {isEditing ? (
            <input
              id="username"
              type="text"
              maxLength={20}
              value={tempUsername}
              onChange={(e) => setTempUsername(e.target.value)}
              style={{
                fontSize: "1rem",
                lineHeight: "1.2rem",
                backgroundColor: "#2a2a2a",
                color: "#fff",
                borderRadius: "6px",
                padding: "0.2rem 0.4rem",
                cursor: "text",
                width: "auto",
                minWidth: "200px",
                textAlign: "center",
              }}
              autoFocus
            />
          ) : (
            <div
              style={{
                fontSize: "1rem",
                lineHeight: "1.2rem",
                backgroundColor: "#2a2a2a",
                color: "#aaa",
                border: "1px solid #444",
                borderRadius: "6px",
                padding: "0.2rem 0.4rem",
                width: "auto",
                minWidth: "200px",
                textAlign: "center",
              }}
            >
              {user?.username}
            </div>
          )}
        </div>

        {/* Email (Fixed) */}
        <div style={{ marginBottom: "1.2rem", width: "fit-content" }}>
          <label
            style={{
              display: "block",
              fontSize: "0.9rem",
              color: "#aaa",
              marginBottom: "0.3rem",
              textAlign: "center",
            }}
          >
            Email
          </label>
          <div
            style={{
              fontSize: "1rem",
              lineHeight: "1.2rem",
              backgroundColor: "#2a2a2a",
              color: "#888",
              border: "1px solid #444",
              borderRadius: "6px",
              padding: "0.2rem 0.4rem",
              cursor: "not-allowed",
              width: "auto",
              minWidth: "200px",
              textAlign: "center",
            }}
          >
            {user?.email}
          </div>
        </div>
      </div>

      {/* Points & Rank */}
      <div
        style={{
          display: "flex",
          gap: "10px",       // space between boxes
          margin: "0 10px",  // margin on left/right to avoid touching edges
        }}
      >
        <div
          style={{
            flex: 1,
            background: "#2d2d2d",
            padding: "1rem",
            borderRadius: "10px",
            textAlign: "center",
          }}
        >
          <p style={{ fontSize: "0.85rem", color: "#aaa" }}>Points</p>
          <p style={{ fontSize: "1.25rem", fontWeight: "bold", color: "#fff" }}>
            {user?.points}
          </p>
        </div>

        <div
          style={{
            flex: 1,
            background: "#2d2d2d",
            padding: "1rem",
            borderRadius: "10px",
            textAlign: "center",
          }}
        >
          <p style={{ fontSize: "0.85rem", color: "#aaa" }}>Rank</p>
          <p style={{ fontSize: "1.25rem", fontWeight: "bold", color: "#fff" }}>
            {user?.rank}
          </p>
        </div>
      </div>

    </div>
  );
};

export default UserProfile;
