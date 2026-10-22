#!/usr/bin/env bash
# Run the print agent by hand (PoC / testing). Production uses systemd — see setup_printer_server.sh.
#
#   ./run.sh            create .venv on first run (uv if present, else python3 -m venv + pip), then start
#   ./run.sh --setup    only (re)install dependencies, don't start
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"

die() { echo "run.sh: $*" >&2; exit 1; }

[ -f .env ] || die "ไม่พบ .env — cp .env.example .env แล้วใส่ TENT_BASE_URL / DEVICE_ID / DEVICE_SECRET / PRINTER_NAME"
if [ "$(stat -c %a .env)" != "600" ]; then
	chmod 600 .env && echo "run.sh: ตั้ง .env เป็น 600 (มี secret)"
fi

install_deps() {
	if command -v uv >/dev/null 2>&1; then
		uv sync --no-dev
	else
		command -v python3 >/dev/null 2>&1 || die "ไม่พบ python3"
		python3 -c 'import sys; sys.exit(sys.version_info < (3, 11))' \
			|| die "ต้องใช้ Python >= 3.11 (เครื่องนี้: $(python3 --version 2>&1))"
		[ -x .venv/bin/python ] || python3 -m venv .venv
		.venv/bin/pip install --quiet -r requirements.txt
	fi
}

if [ "${1:-}" = "--setup" ]; then
	install_deps
	echo "run.sh: ติดตั้ง dependency เสร็จ"
	exit 0
fi

if [ ! -x .venv/bin/python ] || ! .venv/bin/python -c 'import httpx' >/dev/null 2>&1; then
	install_deps
fi

# The agent reads .env from this directory itself; Ctrl+C to stop.
exec .venv/bin/python -m printer
