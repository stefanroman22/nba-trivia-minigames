"""Vercel Python serverless entrypoint for the Django backend.

Vercel's Root Directory for this project is the OUTER `backend/` folder, which holds
manage.py, requirements.txt, vercel.json, this api/ dir, and the inner Django package
`backend/` (settings.py, wsgi.py, urls.py). So `backend.wsgi` resolves to
backend/wsgi.py and exposes `application`. The vercel.json rewrite sends every route
to this function, so /api/*, /trivia/*, /admin/* all reach Django.
"""
import os
import sys
from pathlib import Path

# Make the project root importable regardless of the cwd Vercel invokes us from.
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings")

from backend.wsgi import application  # noqa: E402 (sys.path setup must run first)

# Vercel's Python runtime serves the module-level WSGI callable. Expose both names.
app = application
