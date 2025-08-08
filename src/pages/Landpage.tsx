import { useState, useEffect} from "react";
import logo from "../assets/basketballLogo.webp";
import "../styles/LandPage.css";
import Swal from 'sweetalert2';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faEyeSlash, faEye} from '@fortawesome/free-solid-svg-icons';
import {useNavigate } from "react-router-dom";
import {GameCard, games} from "../components/GameCard"; // adjust the path as necessary

const Landpage = () => {
  const navItems = ["Play", "Log in", "Contact"];
  const [isSignup, setIsSignup] = useState(false);
  const [userId, setUserId] = useState("");
  const [userPassword, setUserPassword] = useState("");
  const [signupUsername, setSignupUsername] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [user, setUser] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [tempUsername, setTempUsername] = useState("");
  const [tempProfilePhoto, setTempProfilePhoto] = useState();
  const [showPassword, setShowPassword] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMatchError, setPasswordMatchError] = useState("");
  const navigate = useNavigate();


  useEffect(() => {
  const checkLogin = async () => {
    const res = await fetch("http://127.0.0.1:8000/api/me/", {
      method: "GET",
      credentials: "include", // Keep session
    });
    if (res.ok) {
      const data = await res.json();
      setUser(data); // Save user to context or local state
      setTempUsername(user.username);
      setTempProfilePhoto(data.profile_photo);
    } else {
      setUser(null); // Not logged in
    }
  };

  checkLogin();
  }, []);

  const handleLogin = async (e: React.FormEvent<HTMLButtonElement>) => {
    e.preventDefault();
      const response = await fetch("http://127.0.0.1:8000/api/login/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include", //Important for session/cookie support
        body: JSON.stringify({
          id: userId,
          password: userPassword,
        })
      })
      const data = await response.json();
      if (data.error) {
        Swal.fire({
          icon: 'error',
          title: 'Authentication Failed',
          html: `<p style="font-size: 1rem; color: #ccc; margin-top: 0.5rem;">${data.error}</p>`,
          background: '#1f1f1f',
          color: '#ffffff',
          confirmButtonText: 'Try Again',
          confirmButtonColor: '#EA750E',
          customClass: {
            popup: 'swal2-custom-popup',
            confirmButton: 'swal2-custom-button'
          },
          buttonsStyling: false,
          allowOutsideClick: false,
          allowEscapeKey: true,
          iconColor: '#ff4d4d',
        });
      }else{
        window.location.reload();
        setUser(data);
        setTempUsername(data.username);
        setTempProfilePhoto(data.profile_photo);
      }
      console.log(data); 
  }

  const handleSignUp = async (e: React.FormEvent<HTMLButtonElement>) => {
  e.preventDefault();

  // Basic field validation
  if (!signupUsername || !signupEmail || !userPassword || !confirmPassword) {
    Swal.fire({
      icon: 'warning',
      title: 'Missing Fields',
      text: 'Please fill in all required fields.',
      background: '#1f1f1f',
      color: '#ffffff',
      confirmButtonText: 'Okay',
      confirmButtonColor: '#EA750E',
      customClass: {
        popup: 'swal2-custom-popup',
        confirmButton: 'swal2-custom-button'
      },
      buttonsStyling: false,
      iconColor: '#ffa500',
    });
    return;
  }

  if (userPassword !== confirmPassword) {
    Swal.fire({
      icon: 'error',
      title: 'Password Mismatch',
      text: 'Passwords do not match. Please try again.',
      background: '#1f1f1f',
      color: '#ffffff',
      confirmButtonText: 'Retry',
      confirmButtonColor: '#EA750E',
      iconColor: '#ff4d4d',
      buttonsStyling: false,
    });
    return;
  }

  try {
    const response = await fetch("http://127.0.0.1:8000/api/signup/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        username: signupUsername,
        email: signupEmail,
        password: userPassword,
      }),
    });

    const data = await response.json();

    if (!response.ok || data.error) {
      Swal.fire({
        icon: 'error',
        title: 'Signup Failed',
        html: `<p style="font-size: 1rem; color: #ccc; margin-top: 0.5rem;">${data.error || "An unexpected error occurred."}</p>`,
        background: '#1f1f1f',
        color: '#ffffff',
        confirmButtonText: 'Try Again',
        confirmButtonColor: '#EA750E',
        customClass: {
          popup: 'swal2-custom-popup',
          confirmButton: 'swal2-custom-button'
        },
        buttonsStyling: false,
        allowOutsideClick: false,
        allowEscapeKey: true,
        iconColor: '#ff4d4d',
      });
    } else {
      setUser(data);
      setTempUsername(data.username);
      setTempProfilePhoto(data.profile_photo);

      Swal.fire({
        icon: 'success',
        title: 'Account Created!',
        text: `Welcome, ${data.username}! You can now log in.`,
        background: '#1f1f1f',
        color: '#ffffff',
        confirmButtonColor: '#EA750E',
        timer: 1500,
        showConfirmButton: false,
      }).then(() => {
        window.location.reload(); // or route to login/dashboard
      });
    }

    console.log(data);
  } catch (err) {
    console.error("Signup error:", err);
    Swal.fire({
      icon: 'error',
      title: 'Network Error',
      text: 'Unable to contact the server. Please try again later.',
      background: '#1f1f1f',
      color: '#ffffff',
      confirmButtonText: 'Close',
      confirmButtonColor: '#EA750E',
      iconColor: '#ff4d4d',
      customClass: {
        popup: 'swal2-custom-popup',
        confirmButton: 'swal2-custom-button'
      },
      buttonsStyling: false,
    });
  }
  };

  const handleSave = async () => {
    const response = await fetch("http://127.0.0.1:8000/api/update-profile/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ username: tempUsername }),
    });
    const data = await response.json();
    if (data.error) {
        Swal.fire({
          icon: 'error',
          title: 'Username change failed!',
          html: `<p style="font-size: 1rem; color: #ccc; margin-top: 0.5rem;">${data.error}</p>`,
          background: '#1f1f1f',
          color: '#ffffff',
          confirmButtonText: 'Try Again',
          confirmButtonColor: '#EA750E',
          customClass: {
            popup: 'swal2-custom-popup',
            confirmButton: 'swal2-custom-button'
          },
          buttonsStyling: false,
          allowOutsideClick: false,
          allowEscapeKey: true,
          iconColor: '#ff4d4d',
        });
      }else{
        setUser({ ...user, username: tempUsername });
        setIsEditing(false);
      }
  };

  const togglePasswordVisibility = () => {
  setShowPassword((prev) => !prev);
  };


  return (
    <div className="main-container" style={{ fontFamily: "Inter, sans-serif", backgroundColor: "#1e1e1e", color: "white" }}>
      
      {/* Navigation */}
      <div className="navigation-container" style={{ display: 'flex', alignItems: 'center', padding: '1rem', backgroundColor: '#222' }}>
        <img src={logo} alt="Logo" style={{ height: '40px', marginRight: '20px' }} />
        <ul style={{ display: 'flex', listStyle: 'none', padding: 0, margin: 0 }}>
          {navItems.map((item) => (
            
            <li key={item} style={{ margin: '0 10px', fontWeight: 'bold',  transition: 'color 0.3s ease', }}>
              <a
                href={`#${item.toLowerCase().replace(" ", "")}`}
                style={{
                color: 'white',
                textDecoration: 'none',
                cursor: 'pointer',
                transition: 'color 0.3s ease',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#ff7a00')} 
                onMouseLeave={(e) => (e.currentTarget.style.color = 'white')}
            >
                {item === "Log in" && user ? (
      <img
        src={tempProfilePhoto || user.profile_photo}
        alt="Profile"
        style={{
          height: "25px",
          width: "25px",
          borderRadius: "50%",
          border: "2px solid #ff7a00",
          cursor: "pointer",
        }}
        onClick={() => {
          window.location.href = "#profile";
        }}
      />
    ) : (
      item
    )}
            </a>
            </li>
          ))}
        </ul>
      </div>

      {/* Play Section */}
      <div id="play" className="play-section" style={{ padding: "4rem 2rem", textAlign: "center",}}>
        <h2 style={{ marginBottom: "2rem", fontWeight: "bold"}}>NBA Trivia & Minigames</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1.5rem" }}>
          {games.map((game, index) => (
            <GameCard
              key={index}
              name={game.name}
              description={game.description}
              backgroundImage={game.backgroundImage}
              urlPath={game.urlPath}
            />
          ))}
        </div>
      </div>

      {/* Login Section */}
      <div
      id="login"
      className="login-section"
      style={{
        padding: "4rem 2rem",
        backgroundColor: "#292929",
        textAlign: "center",
        color: "white",
      }}
    > {user ? (
    <>
  <h2 style={{ marginBottom: "2rem", fontSize: "1.5rem", fontWeight: "600" }}>
    Welcome back!
  </h2>

  {/* Profile Photo + Change */}
  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: "1.5rem" }}>
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
        src={tempProfilePhoto || user.profile_photo}
        alt="Profile"
        style={{ width: "100%", height: "100%", objectFit: "cover"}}
      />
    </div>
    <label htmlFor="photo-upload" 
    style={{ cursor: "pointer", color: "#ff7a00", fontWeight: "bold", fontSize: "0.9rem", transition: 'color 0.3s ease'}}
    onMouseEnter={(e) => {
            e.currentTarget.style.color = "white";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "#ff7400";
          }}>
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

        const response = await fetch("http://127.0.0.1:8000/api/update-profile/", {
          method: "POST",
          credentials: "include",
          body: formData,
        });

        if (response.ok) {
          const updated = await response.json();
          const previewURL = URL.createObjectURL(file); 
          setTempProfilePhoto(previewURL);
          setUser((prev) => ({ ...prev, profile_photo: updated.profile_photo }));
        }
      }}
    />
  </div>

  <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
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
              setTempUsername(user.username);
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
            transition: 'color 0.3s ease',
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
          {user.username}
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
        width: "auto", // Let it size to content
        minWidth: "200px", // Match the input's minimum width
        textAlign: "center",
      }}
    >
      {user.email}
    </div>
  </div>
  </div>

  {/* Points & Rank */}
  <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", marginBottom: "1.5rem" }}>
    <div style={{ flex: 1, background: "#2d2d2d", padding: "1rem", borderRadius: "10px", textAlign: "center" }}>
      <p style={{ fontSize: "0.85rem", color: "#aaa" }}>Points</p>
      <p style={{ fontSize: "1.25rem", fontWeight: "bold", color: "#fff" }}>{user.points}</p>
    </div>
    <div style={{ flex: 1, background: "#2d2d2d", padding: "1rem", borderRadius: "10px", textAlign: "center" }}>
      <p style={{ fontSize: "0.85rem", color: "#aaa" }}>Rank</p>
      <p style={{ fontSize: "1.25rem", fontWeight: "bold", color: "#fff" }}>{user.rank}</p>
    </div>
  </div>

  {/* Logout Button */}
  <button
    style={{
      ...inputStyle,
      backgroundColor: "#ea750e",
      color: "#fff",
      borderRadius: "10px",
      fontWeight: "bold",
      border: "none",
      transition: "background 0.3s ease, transform 0.2s ease",
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.backgroundColor = "#a14c07";
      e.currentTarget.style.transform = "scale(1.03)";
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.backgroundColor = "#ea750e";
      e.currentTarget.style.transform = "scale(1)";
    }}
    onClick={async () => {
      await fetch("http://127.0.0.1:8000/api/logout/", {
        method: "POST",
        credentials: "include",
      });
      setUser(null);
    }}
  >
    Log Out
  </button>
</>
) : 
    (<>
        <h2>{isSignup ? "Sign Up" : "Log In"}</h2>

      <form
        onSubmit={(e) => isSignup ? handleSignUp(e) : handleLogin(e)}
        style={{
          maxWidth: "400px",
          margin: "2rem auto",
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
          transition: "all 0.3s ease-in-out",
        }}
        
      >
        <input 
            type="text" 
            placeholder={isSignup ? "Username" : "Username or email"} 
            style={inputStyle}
            value={isSignup ? signupUsername : userId} 
            onChange={(e) =>
              isSignup ? setSignupUsername(e.target.value) : setUserId(e.target.value)
            }
            required
            {...(isSignup && {
              pattern: "^(?=(?:.*[a-zA-Z]){3,})(?=(?:.*\\d){2,})[a-zA-Z0-9_]{5,}$",
              title:
                "Username must contain at least 3 letters and 2 digits, and only letters, digits, or underscores",
            })}
          />
        {isSignup && (
          <input
            type="email"
            placeholder="Email"
            style={{ ...inputStyle, opacity: 1, transition: "opacity 0.3s ease" }}
            value={signupEmail}
            onChange={(e) => setSignupEmail(e.target.value)}
            required
          />
        )}
        <div style={{ position: "relative" }}>
          <input
            type={showPassword ? "text" : "password"}
            placeholder="Password"
            style={{
              width: "92%",
              ...inputStyle,
            }}
            value={userPassword}
            onChange={(e) => setUserPassword(e.target.value)}
            required
            minLength={isSignup ? 8 : undefined}
            pattern={isSignup ? "(?=.*\\d)(?=.*[a-z])(?=.*[A-Z])(?=.*[\\W_]).{8,}" : undefined}
            title={
              isSignup
                ? "Password must be at least 8 characters and include one uppercase letter, one lowercase letter, one number, and one special character."
                : undefined
            }
          />


          <FontAwesomeIcon
            icon={showPassword ? faEye : faEyeSlash}
            onClick={togglePasswordVisibility}
            style={{
              position: "absolute",
              right: "10px",
              top: "50%",
              transform: "translateY(-50%)",
              cursor: "pointer",
              color: "#1e1e1e",
            }}
          />
        </div>
        
        {isSignup && (
        <input
          type="password"
          placeholder="Confirm Password"
          style={{ ...inputStyle, opacity: 1, transition: "opacity 0.3s ease" }}
          value={confirmPassword}
          onChange={(e) => {
            setConfirmPassword(e.target.value);
            if (userPassword && e.target.value !== userPassword) {
              setPasswordMatchError("Passwords do not match");

            } else {
              setPasswordMatchError("");
            }
          }}
          required
        />
      )}
        {isSignup && passwordMatchError && (
          <p style={{ color: "red", fontSize: "0.9em", fontWeight: "bold"}}>{passwordMatchError}</p>
        )}
        <button
              style={{
                ...inputStyle,
                backgroundColor: isSignup && passwordMatchError
                  ? "#999999"  // gray color when disabled
                  : "rgba(234, 117, 14, 0.78)", // orange when enabled
                color: "white",
                cursor: isSignup && passwordMatchError ? "not-allowed" : "pointer",
                fontWeight: "bold",
                border: "none",
                borderRadius: "8px",
                transition: "background-color 0.4s ease, transform 0.2s ease",
              }}
              onMouseEnter={(e) => {
                if (!(isSignup && passwordMatchError)) {
                  e.currentTarget.style.backgroundColor = "rgba(95, 48, 7, 0.88)";
                  e.currentTarget.style.transform = "scale(1.02)";
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = isSignup && passwordMatchError
                  ? "#999999"
                  : "rgba(234, 117, 14, 0.78)";
                e.currentTarget.style.transform = "scale(1)";
              }}
              onClick={(e) => {
                if (!(isSignup && passwordMatchError)) {
                  isSignup ? handleSignUp(e) : handleLogin(e);
                }
              }}
              disabled={isSignup && passwordMatchError !== ""}
            >
              {isSignup ? "Create Account" : "Log In"}
          </button>


      </form>

      <p style={{ marginTop: "1rem", fontSize: "0.9rem" }}>
        {isSignup ? "Already have an account?" : "Don't have an account?"}{" "}
        <span
          style={{ color: "#ff7400", cursor: "pointer", fontWeight: "bold", transition: 'color 0.3s ease', }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "white";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "#ff7400";
          }}
          onClick={() => setIsSignup(!isSignup)}
        >
          {isSignup ? "Log In" : "Sign Up"}
        </span>
      </p>
    </>)}
  </div>
    
      {/* Contact Section */}
      <div id="contact" className="contact-section" style={{ padding: "4rem 2rem", backgroundColor: "#1e1e1e", textAlign: "center" }}>
        <h2>Contact Us</h2>
        <p style={{ color: "#aaa", marginTop: "1rem" }}>Need help or have feedback? Email us at <a href="mailto:stefanromanpers@gmail.com" style={{ color: 'inherit'}}>
                                                <strong>stefanromanpers@gmail.com</strong>
                                                </a></p>

        <p style={{
  marginTop: "1rem",
  fontSize: "0.75rem",       // smaller font
  color: "#aaaaaa",          // light gray
  fontWeight: "normal",      // de-emphasized
  opacity: 0.7,              // subtle fade
}}>
  All logos and brands are property of their respective owners and are used for identification purposes only.
</p>
      </div>
    </div>
  );
};

// Shared input styling
const inputStyle = {
  padding: "0.75rem 1rem",
  borderRadius: "8px",
  border: "none",
  outline: "none",
  fontSize: "1rem",
};


export default Landpage;
