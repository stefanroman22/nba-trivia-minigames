# NBA Trivia Minigames

This project is a fun and interactive web-based tool that lets users test their NBA knowledge through a variety of engaging mini-games.

---

##  Project Overview

The project make user of the data  provided by [link](https://pypi.org/project/nba_api/) (nba_api).

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

Not advised until final version published!

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
