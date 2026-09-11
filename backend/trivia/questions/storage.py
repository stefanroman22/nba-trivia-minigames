"""Supabase Storage access: S3 for uploads, public HTTP for reads."""
import datetime
import hashlib
import json
import os

import requests
from django.core.exceptions import ImproperlyConfigured

from trivia.questions.base import load_dataset_from_rows

REQUIRED = (
    "SUPABASE_S3_ENDPOINT", "SUPABASE_S3_REGION", "SUPABASE_S3_ACCESS_KEY_ID",
    "SUPABASE_S3_SECRET_ACCESS_KEY", "SUPABASE_STORAGE_BUCKET", "QUESTIONS_PUBLIC_BASE",
)


class StorageUnavailable(Exception):
    """A public read failed or returned something we refuse to trust."""


class StorageConfig:
    def __init__(self, endpoint, region, access_key, secret_key, bucket, public_base):
        self.endpoint = endpoint
        self.region = region
        self.access_key = access_key
        self.secret_key = secret_key
        self.bucket = bucket
        self.public_base = public_base.rstrip("/")

    @classmethod
    def from_env(cls):
        values = {k: (os.environ.get(k) or "").strip() for k in REQUIRED}
        missing = [k for k, v in values.items() if not v]
        if missing:
            raise ImproperlyConfigured(f"Missing Supabase Storage env vars: {', '.join(missing)}")
        return cls(
            values["SUPABASE_S3_ENDPOINT"], values["SUPABASE_S3_REGION"],
            values["SUPABASE_S3_ACCESS_KEY_ID"], values["SUPABASE_S3_SECRET_ACCESS_KEY"],
            values["SUPABASE_STORAGE_BUCKET"], values["QUESTIONS_PUBLIC_BASE"],
        )


def s3_client(cfg):
    import boto3  # lazy: only uploads need it (requirements-publish.txt)

    return boto3.client(
        "s3", endpoint_url=cfg.endpoint, region_name=cfg.region,
        aws_access_key_id=cfg.access_key, aws_secret_access_key=cfg.secret_key,
    )


def public_url(cfg, key):
    return f"{cfg.public_base}/{key.lstrip('/')}"


def fetch_json(url, session=requests):
    try:
        res = session.get(url, timeout=30)
    except Exception as e:  # noqa: BLE001 - network: report as unavailable
        raise StorageUnavailable(f"GET {url}: {e}") from e
    if not res.ok:
        raise StorageUnavailable(f"GET {url}: HTTP {res.status_code}")
    try:
        return res.json()
    except ValueError as e:
        raise StorageUnavailable(f"GET {url}: not JSON") from e


def download_players_dataset(cfg, session=requests):
    manifest = fetch_json(public_url(cfg, "datasets/manifest.json"), session)
    entry = (manifest or {}).get("players") or {}
    url, sha, version = entry.get("url"), entry.get("sha256"), entry.get("version")
    if not (url and sha and version):
        raise StorageUnavailable("datasets/manifest.json has no complete players entry")
    try:
        res = session.get(url, timeout=120)
    except Exception as e:  # noqa: BLE001
        raise StorageUnavailable(f"GET {url}: {e}") from e
    if not res.ok:
        raise StorageUnavailable(f"GET {url}: HTTP {res.status_code}")
    body = res.content
    if hashlib.sha256(body).hexdigest() != sha:
        raise StorageUnavailable(f"players dataset {version}: sha256 mismatch")
    rows = json.loads(body.decode("utf-8"))
    if not isinstance(rows, list) or not rows:
        raise StorageUnavailable(f"players dataset {version}: empty or not a list")
    return load_dataset_from_rows(rows, version)


def version_key(version):
    date, _, n = version.partition(".")
    return (date, int(n or 0))


def next_version(current, today=None):
    today = today or datetime.datetime.now(datetime.timezone.utc).date()
    stamp = today.strftime("%Y-%m-%d")
    if current and current.startswith(stamp + "."):
        return f"{stamp}.{version_key(current)[1] + 1}"
    return f"{stamp}.1"
