# NBA Trivia Minigames

This project is a fun and interactive web-based tool that lets users test their NBA knowledge through a variety of engaging mini-games.

---

##  Project Overview

The project make user of the data  provided by [](https://pypi.org/project/nba_api/) (nba_api).

The project's frontend has been developed using Typescript while the backend has been build up using Django.

This project is currently in development, therefore some features might not be able to function at this moment.

Up until now this code version supports: Log-in, sign-up for users so they can track their progress and the Guess Playoff Series winner game has been developed. 


---

## Project Folder Structure

###  1. General Project Root

| Folder            | Description |
|-------------------|-------------|
| `src/`            | React + TypeScript frontend code, including all UI components. |
| `backend/`        | Django backend project, including all apps and API logic. |
| `README.md`       | Project documentation file. |

---

### 2. Frontend – `src/`

| Folder              | Description |
|---------------------|-------------|
| `components/`       | Reusable React components such as game cards |
| `pages/`            | Page-level .tsx components (e.g., SeriesWinner, LandPage). |
| `styles/`           | All .css files for all .tsx filed from  `pages/`  |
| `constats/`         | All constant data used withing the project |

---

### 3. Backend – `django-backend/`

####  `backend/`
| File/Folder       | Description |
|-------------------|-------------|
| `settings.py`     | Django configuration (apps, database, middleware). |
| `urls.py`         | Root URL routing for the entire backend. |
| `wsgi.py` / `asgi.py` | Entry points for WSGI/ASGI servers. |

####  `users/` – Django app for user management
| File/Folder       | Description |
|-------------------|-------------|
| `models.py`       | Defines the database models for users. |
| `views.py`        | Handles API logic for login, signup and update profile |
| `urls.py`         | URL routing specific to the user requirement. |
| `migrations/`     | Auto-generated files to manage database schema changes. |

####  `trivia/` – Django app for collecting user feedback
| File/Folder       | Description |
|-------------------|-------------|
| `models.py`       | Database model for different minigames data. |
| `views.py`        | Handles user request for minigames. |
| `migrations/`     | Schema history for the feedback app. |

####  `media/`
| Folder            | Description |
|-------------------|-------------|
| `media/`          | Stores uploaded files (e.g., if users upload a profile picture). |


---

##  How to Run the Project Locally

The app has three parts, each in its own terminal: the **Django API** (port 8000),
the **Socket.IO multiplayer server** (port 4000), and the **Vite + React frontend**
(port 5173). Requires Node.js and Python 3.10+.

> Make sure ports **8000**, **4000** and **5173** are free before starting.

### 1. Backend — Django API (port 8000)

```bash
cd nba-minigames/backend
python -m venv venv
venv\Scripts\activate          # Windows  (macOS/Linux: source venv/bin/activate)
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 8000
```

### 2. Multiplayer server — Socket.IO (port 4000)

```bash
cd nba-minigames/multiplayer_server
npm install
node src/index.js
```

### 3. Frontend — Vite + React (port 5173)

```bash
cd nba-minigames
npm install
npm run dev
```

Then open **http://localhost:5173**.

The frontend reads the backend URL from `.env` (`VITE_BACKEND_URL=http://localhost:8000/api`)
and the socket URL from `VITE_SOCKET_URL` (defaults to `http://localhost:4000`). Single-player
games work with just the backend running; the multiplayer server is only needed for "Play Online".

##  Technologies Used

###  **Frontend**
- **HTML/CSS** – For structure and layout.
- **TypeScript + React.js** – Enables component-based UI and type safety.

###  **Backend**
- **Django (Python)** – Handles user management, minigames logic, and stores persistent data via REST APIs.
- **Django REST Framework** – Simplifies API development and user authentication.

These technologies were chosen for:
- Ease of integration between React and Django.
- Strong typing (TypeScript) for large-scale frontend.
- Rapid API development and user/session management (Django).

---


##  Contributions and Development

Soon to come!

---

##  Contact

If you have questions or want to collaborate, feel free to open an issue or reach out via GitHub.
