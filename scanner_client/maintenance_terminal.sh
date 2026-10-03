#!/bin/bash
# ==============================================================================
# SmartShelter Kiosk - maintenance terminal inside the locked kiosk session
# ------------------------------------------------------------------------------
# Opened by maintenance_hotkey.py on Ctrl+Alt+Shift+T. Shows how to reach this machine (hostname,
# IPv4, gateway) WITHOUT a password, then asks for the kiosk user's password before giving a shell:
# the autologin session itself must never hand out a shell (anyone with a keyboard could read
# DEVICE_SECRET). Text is English only — the terminal font may have no Thai glyphs.
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
USER_NAME="$(id -un)"
HOST="$(hostname)"

echo "=== SmartShelter kiosk maintenance ==="
echo
echo "Hostname : $HOST   (same LAN: $HOST.local)"
echo "IPv4     :"
ip -4 -brief address show scope global 2>/dev/null | sed 's/^/  /'
echo "Gateway  : $(ip route show default 2>/dev/null | awk '{print $3; exit}')"
echo
echo "SSH from another machine:"
echo "  ssh $USER_NAME@<IPv4 above>    or    ssh $USER_NAME@$HOST.local"
echo
echo "Unlock to normal desktop (inside the shell below):"
echo "  $SCRIPT_DIR/setup_kiosk_lockdown.sh --disable && sudo systemctl restart gdm"
echo
echo "Password of '$USER_NAME' opens a shell. Ctrl+C or a wrong password closes this window."
echo

if su -l "$USER_NAME"; then
    exit 0
fi
echo
echo "No shell opened. Closing in 15 s..."
sleep 15
