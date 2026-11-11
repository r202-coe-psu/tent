#!/usr/bin/env bash
# Install everything scanner-client needs on Debian/Ubuntu and run it from source.
# Safe to re-run: every step is skipped when already done.
#   ./run-linux.sh                      # install (first time) + run
#   SHELTER_URL=https://x ./run-linux.sh  # set SHELTER_URL in .env on first run
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"

say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m!!\033[0m %s\n' "$*" >&2; exit 1; }

# 1. PC/SC service + CCID driver (needs sudo once)
missing=()
for pkg in pcscd libccid pcsc-tools; do
	dpkg -s "$pkg" >/dev/null 2>&1 || missing+=("$pkg")
done
if ((${#missing[@]})); then
	command -v apt-get >/dev/null || die "install ${missing[*]} with your package manager"
	say "installing ${missing[*]} (sudo)"
	sudo apt-get update -qq
	sudo apt-get install -y "${missing[@]}"
fi
if ! systemctl is-active --quiet pcscd.socket && ! systemctl is-active --quiet pcscd; then
	say "enabling pcscd (sudo)"
	sudo systemctl enable --now pcscd.socket
fi

# 2. uv
if ! command -v uv >/dev/null; then
	say "installing uv"
	curl -LsSf https://astral.sh/uv/install.sh | sh
	export PATH="$HOME/.local/bin:$PATH"
fi

# 3. .env
if [[ ! -f .env ]]; then
	cp .env.example .env
	url="${SHELTER_URL:-}"
	if [[ -z "$url" && -t 0 ]]; then
		read -rp "SHELTER_URL (เช่น https://shelter.example.org หรือ http://localhost:5173): " url
	fi
	[[ -n "$url" ]] || die "ยังไม่ได้ตั้ง SHELTER_URL — แก้ในไฟล์ $(pwd)/.env แล้วรันใหม่"
	sed -i "s|^#\?\s*SHELTER_URL=.*|SHELTER_URL=${url}|" .env
	say ".env created"
fi

# 4. Python deps + browser (Linux default channel = bundled chromium)
say "syncing python deps"
uv sync --quiet
channel="$(grep -E '^\s*BROWSER_CHANNEL=' .env | tail -1 | cut -d= -f2- | tr -d '[:space:]' || true)"
if [[ -z "$channel" || "$channel" == "chromium" ]]; then
	say "making sure playwright chromium is installed"
	uv run playwright install chromium
fi

# 5. Run
say "starting scanner-client (close the browser window to quit)"
exec uv run scanner-client
