"""Startup guard: the request path never loads the data-pipeline/upload libraries, and the
pre-warm endpoint touches no database. See docs/team/designs/2026-10-03-backend-cold-start.md."""
import json
import subprocess
import sys

from django.conf import settings
from django.test import SimpleTestCase
from django.urls import reverse

# `requests` is deliberately not listed: rest_framework/compat.py does `import requests` whenever
# the package is installed (it must stay installed: google_login and google-auth's transport use
# it), so DRF loads it at startup no matter what users/views.py does. ~51 ms on Linux.
HEAVY = ("pandas", "numpy", "nba_api", "PIL", "google", "onnxruntime")

# Runs in a fresh interpreter: this test process has already imported PIL and nba_api through
# sibling test modules, so inspecting its own sys.modules would prove nothing.
STARTUP_SCRIPT = """
import json, os, sys
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings")
from django.core.wsgi import get_wsgi_application
get_wsgi_application()
from django.urls import get_resolver
get_resolver().url_patterns  # imports every urls module and the views they route
heavy = %r
print(json.dumps(sorted(m for m in sys.modules if m.split(".")[0] in heavy)))
""" % (HEAVY,)


class StartupImportTests(SimpleTestCase):
    def test_request_path_loads_no_heavy_libraries(self):
        proc = subprocess.run(
            [sys.executable, "-c", STARTUP_SCRIPT],
            cwd=settings.BASE_DIR, capture_output=True, text=True, timeout=120,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        loaded = json.loads(proc.stdout.strip().splitlines()[-1])
        self.assertEqual(loaded, [], f"heavy modules loaded at startup: {loaded}")


class HealthEndpointTests(SimpleTestCase):
    # SimpleTestCase forbids database access, so a query inside the view fails the test.
    def test_get(self):
        res = self.client.get(reverse("health"))
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), {"ok": True})
        self.assertEqual(res["Cache-Control"], "no-store")

    def test_post_rejected(self):
        self.assertEqual(self.client.post(reverse("health")).status_code, 405)
