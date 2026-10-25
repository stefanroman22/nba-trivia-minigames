#!/usr/bin/env bash
# Install the security agent's tools on a GitHub Actions Linux runner: gitleaks and osv-scanner as release binaries
# (checksum-verified, pinned), and Claude Code (pinned like checks-weekly.yml). Adds them to $GITHUB_PATH.
#   bash scripts/security/install-tools.sh [--no-claude]
set -euo pipefail
GITLEAKS_VERSION=8.21.2   # same version dev-ci.yml runs
OSV_VERSION=2.6.0
CLAUDE_VERSION=2.1.285

bin="${RUNNER_TEMP:-/tmp}/security-bin"
mkdir -p "$bin"
cd "$bin"

gl="gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz"
curl -fsSL -o "$gl" "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/${gl}"
curl -fsSL -o gl.sums "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_checksums.txt"
grep " ${gl}\$" gl.sums | sha256sum -c -
tar -xzf "$gl" gitleaks

curl -fsSL -o osv-scanner_linux_amd64 "https://github.com/google/osv-scanner/releases/download/v${OSV_VERSION}/osv-scanner_linux_amd64"
curl -fsSL -o osv.sums "https://github.com/google/osv-scanner/releases/download/v${OSV_VERSION}/osv-scanner_SHA256SUMS"
grep " osv-scanner_linux_amd64\$" osv.sums | sha256sum -c -
mv osv-scanner_linux_amd64 osv-scanner
chmod +x gitleaks osv-scanner
echo "$bin" >> "${GITHUB_PATH:-/dev/null}"
./gitleaks version
./osv-scanner --version | sed -n 1p # sed reads all input: no SIGPIPE under pipefail

if [ "${1:-}" != "--no-claude" ]; then
  npm install -g --no-audit --no-fund "@anthropic-ai/claude-code@${CLAUDE_VERSION}" >/dev/null
  claude --version
fi
