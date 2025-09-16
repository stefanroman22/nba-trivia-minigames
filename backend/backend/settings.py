"""
Django settings for backend project.
Hardened for production deployment.
"""

from pathlib import Path
import os
from datetime import timedelta
from django.core.management.utils import get_random_secret_key

BASE_DIR = Path(__file__).resolve().parent.parent

# =========================================================
# Environment Variables
# =========================================================
# Load from OS environment for production safety
# e.g. in shell or deployment: export SECRET_KEY="myprodsecret"
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", get_random_secret_key())

# Default to False in production
DEBUG = os.environ.get("DJANGO_DEBUG", "False") == "True"

# Example: ALLOWED_HOSTS=yourdomain.com,www.yourdomain.com
ALLOWED_HOSTS = os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")

# =========================================================
# Installed Apps
# =========================================================
INSTALLED_APPS = [
    'users',
    'corsheaders',
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'django_extensions',
]

# =========================================================
# Middleware
# =========================================================
MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',  # must be first
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',  # CSRF middleware
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    'django.middleware.security.SecurityMiddleware',
]

# =========================================================
# CORS / CSRF Settings
# =========================================================
# Frontend production URL
FRONTEND_URL = os.environ.get("FRONTEND_URL", "https://localhost:5173")

CORS_ALLOWED_ORIGINS = [
    FRONTEND_URL,
]


# Required for cookie-based session + CSRF protection
CORS_ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "https://localhost:5173",
    "http://127.0.0.1:5173",
    "https://127.0.0.1:5173",
]
CSRF_TRUSTED_ORIGINS = [
    "https://localhost:5173",
    "https://127.0.0.1:5173",
]

# Allow cookies and authentication headers
CORS_ALLOW_CREDENTIALS = True

# =========================================================
# Session & Cookies
# =========================================================
# Session cookie name (defaults to sessionid)
SESSION_COOKIE_NAME = "sessionid"

# Cookie configuration for cross-site SPA
SESSION_COOKIE_SECURE = True        # Must be True for HTTPS
SESSION_COOKIE_SAMESITE = 'None'    # Required for cross-site cookies

# CSRF cookie
CSRF_COOKIE_SECURE = True
CSRF_COOKIE_SAMESITE = 'None'
CSRF_HEADER_NAME = "HTTP_X_CSRFTOKEN"  # For fetch/axios header: X-CSRFToken

# Session lifetime
SESSION_COOKIE_AGE = 60 * 60 * 24 * 7  # 7 days
SESSION_EXPIRE_AT_BROWSER_CLOSE = False

# =========================================================
# Security Headers
# =========================================================
if not DEBUG:
    SECURE_SSL_REDIRECT = True
    SECURE_HSTS_SECONDS = 31536000  # 1 year
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'http')

    # Clickjacking protection
    X_FRAME_OPTIONS = 'DENY'

    # Force content type checks
    SECURE_CONTENT_TYPE_NOSNIFF = True
    SECURE_BROWSER_XSS_FILTER = True

# =========================================================
# URL Configuration
# =========================================================
ROOT_URLCONF = 'backend.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

DEBUG = True

WSGI_APPLICATION = 'backend.wsgi.application'

# =========================================================
# Database
# =========================================================
# Use SQLite for dev, Postgres or MySQL for prod
DATABASES = {
    'default': {
        'ENGINE': os.environ.get('DB_ENGINE', 'django.db.backends.sqlite3'),
        'NAME': os.environ.get('DB_NAME', BASE_DIR / 'db.sqlite3'),
        'USER': os.environ.get('DB_USER', ''),
        'PASSWORD': os.environ.get('DB_PASSWORD', ''),
        'HOST': os.environ.get('DB_HOST', ''),
        'PORT': os.environ.get('DB_PORT', ''),
    }
}

# =========================================================
# Authentication
# =========================================================
AUTH_USER_MODEL = 'users.CustomUser'

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator', 'OPTIONS': {'min_length': 8}},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

# =========================================================
# Internationalization
# =========================================================
LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True

# =========================================================
# Static & Media Files
# =========================================================
STATIC_URL = '/static/'
STATIC_ROOT = os.path.join(BASE_DIR, 'staticfiles')

STATICFILES_DIRS = [
    os.path.join(BASE_DIR, 'static'),
]

MEDIA_URL = '/media/'
MEDIA_ROOT = os.path.join(BASE_DIR, 'media')

# =========================================================
# Logging
# =========================================================
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'verbose': {
            'format': '{levelname} {asctime} {module} {message}',
            'style': '{',
        },
        'simple': {
            'format': '{levelname} {message}',
            'style': '{',
        },
    },
    'handlers': {
        'console': {
            'class': 'logging.StreamHandler',
            'formatter': 'verbose',
        },
    },
    'root': {
        'handlers': ['console'],
        'level': 'INFO',
    },
    'django': {
        'handlers': ['console'],
        'level': 'WARNING',
        'propagate': False,
    },
}

# =========================================================
# Google OAuth Config
# =========================================================
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")
