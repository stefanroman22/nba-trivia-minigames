# security-state

Durable state of the security scan (weekly full scan + PR scans to main): findings.json, one entry per finding
fingerprint (new / open / resolved, its Notion ticket). Details are encrypted with the SECURITY_STATE_KEY secret.
Written only by scripts/security/lib/state.mjs (fast-forward pushes, never force). Do not merge this branch anywhere.
See docs/security/README.md.
