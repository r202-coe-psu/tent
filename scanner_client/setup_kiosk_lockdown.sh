#!/bin/bash
# ==============================================================================
# SmartShelter Kiosk - Lock the big kiosk (GDM / GNOME, Debian) into the kiosk app
# ------------------------------------------------------------------------------
# A normal GNOME session lets anyone leave Chromium (touch swipe -> Activities overview, top bar).
# This sets GDM autologin for the kiosk user into the "GNOME Kiosk Script" session: no GNOME
# Shell, no overview, no gestures, no panel. The only app on screen is
# ~/.local/bin/gnome-kiosk-script, which keeps scanner_client/start_kiosk.sh running.
# Display rotation keeps coming from the user's ~/.config/monitors.xml (not touched here).
# Text TTYs for maintenance: GNOME Kiosk is built on mutter, whose Ctrl+Alt+F1..F6 VT-switch keys
# are set for the kiosk user (gsettings); /etc/issue shows hostname + IP above the TTY login prompt.
#
# Run as a normal user (NOT with sudo); the script calls sudo itself. Applies at the next login:
# add --restart (or run: sudo systemctl restart gdm / reboot).
#
# Usage: ./setup_kiosk_lockdown.sh [--user NAME] [--restart] [--status | --disable | --help]
#   (none)        install packages, write the kiosk script, enable Ctrl+Alt+F1..F6 + IP on
#                 the TTY login, set autologin + kiosk session, then print --status
#   --status      checks only, change nothing (exit 1 when not locked)
#   --disable     maintenance: autologin into the previous (normal GNOME) session instead
#   --restart     after install/--disable succeeds, restart gdm so it applies now. This ends
#                 the session on the kiosk screen (a terminal open there closes) — SSH stays.
#   --user NAME   the autologin kiosk user (default: the user running this script)
# ==============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
KIOSK_SCRIPT="$SCRIPT_DIR/start_kiosk.sh"
APT_PACKAGES=(gnome-kiosk gnome-kiosk-script-session)
SESSION_DIRS=(/usr/share/wayland-sessions /usr/share/xsessions)
GDM_CONF="/etc/gdm3/daemon.conf"
LOCK_FILE="/tmp/smart_shelter_kiosk.lock"
MANAGED_MARK="# Managed by tent scanner_client/setup_kiosk_lockdown.sh"
FALLBACK_SESSION="gnome"
# mutter (GNOME Shell and GNOME Kiosk) switches VTs itself on Wayland; the kernel does not while a
# compositor owns the keyboard. Values equal the GNOME defaults, so a normal session is unaffected.
VT_KEYS_SCHEMA="org.gnome.mutter.wayland.keybindings"
VT_NUMBERS=(1 2 3 4 5 6)
ISSUE_FILE="/etc/issue"
# agetty expands \n = hostname, \4 = IPv4 of the first configured interface. /etc/issue has no
# comment syntax, so this exact line is also how the script recognises its own addition.
ISSUE_LINE='SmartShelter kiosk: \n   IP: \4   (Ctrl+Alt+F1/F2 = back to the kiosk screen)'

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info() { echo -e "${BLUE}▸ $*${NC}"; }
ok() { echo -e "${GREEN}✅ $*${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $*${NC}"; }
bad() {
    echo -e "${RED}❌ $*${NC}"
    FAILED=true
}
FAILED=false

# --- Pure helpers (no sudo, no side effects; covered by tests/test_setup_kiosk_lockdown.py) ---

# Prints the session id (.desktop basename) whose Exec runs gnome-kiosk-script; wayland first.
kiosk_session_id() {
    local dir file
    for dir in "${SESSION_DIRS[@]}"; do
        for file in "$dir"/*.desktop; do
            [ -f "$file" ] || continue
            grep -q '^Exec=.*gnome-kiosk-script' "$file" || continue
            basename "$file" .desktop
            return 0
        done
    done
    return 1
}

# Prints the GDM autologin user from a daemon.conf, or nothing when autologin is off.
gdm_autologin_user() {
    [ -f "$1" ] || return 0
    awk '
        /^[[:space:]]*\[/ { in_daemon = ($0 ~ /^[[:space:]]*\[daemon\]/) }
        in_daemon && /^[[:space:]]*AutomaticLoginEnable[[:space:]]*=/ { sub(/^[^=]*=/, ""); enable = $0 }
        in_daemon && /^[[:space:]]*AutomaticLogin[[:space:]]*=/ { sub(/^[^=]*=/, ""); user = $0 }
        END {
            gsub(/[[:space:]]/, "", enable); gsub(/[[:space:]]/, "", user)
            if (tolower(enable) == "true") print user
        }
    ' "$1"
}

# Prints daemon.conf ($1, may be missing) with autologin for $2: active AutomaticLogin* keys in
# [daemon] are replaced, comments and every other line are kept.
gdm_with_autologin() {
    local source="$1"
    [ -f "$source" ] || source=/dev/null
    awk -v user="$2" '
        /^[[:space:]]*\[/ { in_daemon = ($0 ~ /^[[:space:]]*\[daemon\]/) }
        in_daemon && /^[[:space:]]*AutomaticLogin(Enable)?[[:space:]]*=/ { next }
        { print }
        /^[[:space:]]*\[daemon\]/ && !found {
            print "AutomaticLoginEnable=true"; print "AutomaticLogin=" user; found = 1
        }
        END { if (!found) { print "[daemon]"; print "AutomaticLoginEnable=true"; print "AutomaticLogin=" user } }
    ' "$source"
}

# Prints the gsettings value that binds Ctrl+Alt+F<n> to "switch to VT n".
vt_keybinding_value() {
    printf "['<Primary><Alt>F%s']" "$1"
}

# Prints an issue file ($1, may be missing) with ISSUE_LINE as its last line: any earlier copy of
# the line is removed first, so re-runs never stack it. A blank line separates it from the
# distribution banner.
issue_with_ip_line() {
    local source="$1"
    [ -f "$source" ] || source=/dev/null
    # Passed through the environment: awk -v would turn \n and \4 into control characters.
    ISSUE_LINE="$ISSUE_LINE" awk '
        BEGIN { line = ENVIRON["ISSUE_LINE"] }
        $0 == line { next }
        { lines[++n] = $0 }
        END {
            while (n > 0 && lines[n] == "") n--
            for (i = 1; i <= n; i++) print lines[i]
            if (n > 0) print ""
            print line
            print ""
        }
    ' "$source"
}

# Prints the ~/.local/bin/gnome-kiosk-script body for start_kiosk.sh at $1.
session_script_content() {
    cat <<EOF
#!/bin/sh
$MANAGED_MARK - rerun it instead of editing.
# GNOME Kiosk keeps this as the only app on screen. start_kiosk.sh supervises main.py; this loop
# only covers start_kiosk.sh itself exiting (exit 78/79 = .env/credential problem: retry so a fix
# over SSH recovers without a reboot). Skip while the XDG-autostart copy already holds the lock.
while true; do
    if flock -n "$LOCK_FILE" true 2>/dev/null; then
        "$1"
    fi
    sleep 30
done
EOF
}

# --- System helpers ---

user_home() { getent passwd "$1" | cut -d: -f6; }

# The kiosk user's home may be 0700 (Debian default): read it via sudo when it is another user.
as_kiosk() {
    if [ "$KIOSK_USER" = "$(id -un)" ]; then
        "$@"
    else
        sudo -n "$@"
    fi
}
# Runs a command AS the kiosk user (not root) — gsettings must write that user's own dconf.
as_kiosk_user() {
    if [ "$KIOSK_USER" = "$(id -un)" ]; then
        "$@"
    else
        sudo -n -u "$KIOSK_USER" "$@"
    fi
}

# gsettings for the kiosk user: through the live session bus when the user is logged in (the
# running session sees the change), otherwise a throw-away bus that still writes ~/.config/dconf.
kiosk_gsettings() {
    local bus="/run/user/$(id -u "$KIOSK_USER")/bus"
    if [ -S "$bus" ]; then
        as_kiosk_user env DBUS_SESSION_BUS_ADDRESS="unix:path=$bus" gsettings "$@"
    else
        as_kiosk_user dbus-run-session -- gsettings "$@"
    fi
}

vt_keys_enabled() {
    local n
    for n in "${VT_NUMBERS[@]}"; do
        [ "$(kiosk_gsettings get "$VT_KEYS_SCHEMA" "switch-to-session-$n" 2>/dev/null)" = "$(vt_keybinding_value "$n")" ] ||
            return 1
    done
}

set_vt_keys() {
    local n
    kiosk_gsettings list-keys "$VT_KEYS_SCHEMA" >/dev/null 2>&1 || return 2
    for n in "${VT_NUMBERS[@]}"; do
        kiosk_gsettings set "$VT_KEYS_SCHEMA" "switch-to-session-$n" "$(vt_keybinding_value "$n")" || return 1
    done
}

set_issue_ip() {
    local tmp status
    [ -f "$ISSUE_FILE" ] && ! sudo test -f "$ISSUE_FILE.tent-bak" && sudo cp -p "$ISSUE_FILE" "$ISSUE_FILE.tent-bak"
    tmp="$(mktemp)" || return 1
    issue_with_ip_line "$ISSUE_FILE" >"$tmp" && sudo install -m 644 "$tmp" "$ISSUE_FILE"
    status=$?
    rm -f "$tmp"
    return $status
}

account_path() { echo "/org/freedesktop/Accounts/User$(id -u "$1")"; }

current_session() {
    local value
    value="$(busctl get-property org.freedesktop.Accounts "$(account_path "$KIOSK_USER")" \
        org.freedesktop.Accounts.User Session 2>/dev/null | sed -n 's/^s "\(.*\)"$/\1/p')"
    [ -n "$value" ] ||
        value="$(sudo -n sed -n 's/^Session=//p' "/var/lib/AccountsService/users/$KIOSK_USER" 2>/dev/null | tail -1)"
    printf '%s' "$value"
}

set_session() {
    local account_file="/var/lib/AccountsService/users/$KIOSK_USER"
    if sudo busctl call org.freedesktop.Accounts "$(account_path "$KIOSK_USER")" \
        org.freedesktop.Accounts.User SetSession s "$1" >/dev/null 2>&1; then
        return 0
    fi
    # Older AccountsService without SetSession: edit the user file and reload the daemon.
    sudo mkdir -p "$(dirname "$account_file")" || return 1
    sudo test -f "$account_file" || printf '[User]\n' | sudo tee "$account_file" >/dev/null
    sudo sed -i '/^Session=/d; /^XSession=/d' "$account_file" &&
        sudo sed -i "/^\[User\]/a Session=$1" "$account_file" &&
        sudo systemctl restart accounts-daemon
}

set_autologin() {
    local tmp status
    [ -f "$GDM_CONF" ] && ! sudo test -f "$GDM_CONF.tent-bak" && sudo cp -p "$GDM_CONF" "$GDM_CONF.tent-bak"
    tmp="$(mktemp)" || return 1
    gdm_with_autologin "$GDM_CONF" "$KIOSK_USER" >"$tmp" && sudo install -m 644 "$tmp" "$GDM_CONF"
    status=$?
    rm -f "$tmp"
    return $status
}

# Writes a file owned by the kiosk user (sudo only when it is not the user running this script).
install_as_kiosk() {
    local mode="$1" dest="$2" tmp status
    tmp="$(mktemp)" || return 1
    cat >"$tmp"
    if [ "$KIOSK_USER" = "$(id -un)" ]; then
        install -D -m "$mode" "$tmp" "$dest"
    else
        sudo install -D -m "$mode" -o "$KIOSK_USER" -g "$(id -gn "$KIOSK_USER")" "$tmp" "$dest"
    fi
    status=$?
    rm -f "$tmp"
    return $status
}

packages_missing() {
    local pkg
    for pkg in "${APT_PACKAGES[@]}"; do
        dpkg -s "$pkg" >/dev/null 2>&1 || echo "$pkg"
    done
}

# --- Commands ---

show_status() {
    local missing session_id session autologin
    missing="$(packages_missing | xargs)"
    [ -z "$missing" ] && ok "ติดตั้ง ${APT_PACKAGES[*]} แล้ว" || bad "ยังไม่ได้ติดตั้ง: $missing"

    session_id="$(kiosk_session_id)" && ok "พบ session: $session_id" || bad "ไม่พบ session GNOME Kiosk Script"

    if as_kiosk grep -qs "$MANAGED_MARK" "$SESSION_SCRIPT" && as_kiosk test -x "$SESSION_SCRIPT"; then
        ok "kiosk script: $SESSION_SCRIPT"
    elif as_kiosk test -e "$SESSION_SCRIPT"; then
        warn "$SESSION_SCRIPT มีอยู่แต่ไม่ได้สร้างโดย script นี้ (รันติดตั้งใหม่เพื่อเขียนทับ)"
    else
        bad "ยังไม่มี $SESSION_SCRIPT"
    fi

    vt_keys_enabled && ok "Ctrl+Alt+F1..F6 สลับ TTY ได้ (gsettings $VT_KEYS_SCHEMA)" ||
        bad "ยังไม่ได้ตั้ง Ctrl+Alt+F1..F6 สำหรับ $KIOSK_USER"
    grep -qxF "$ISSUE_LINE" "$ISSUE_FILE" 2>/dev/null && ok "หน้า login ของ TTY แสดง hostname + IP ($ISSUE_FILE)" ||
        warn "หน้า login ของ TTY ยังไม่แสดง IP ($ISSUE_FILE)"

    autologin="$(gdm_autologin_user "$GDM_CONF")"
    [ "$autologin" = "$KIOSK_USER" ] && ok "GDM autologin: $KIOSK_USER" ||
        bad "GDM autologin ไม่ใช่ $KIOSK_USER (ตอนนี้: ${autologin:-ปิด})"

    session="$(current_session)"
    if [ -n "${session_id:-}" ] && [ "$session" = "$session_id" ]; then
        ok "session ตอน login: $session (ล็อก kiosk)"
    else
        bad "session ตอน login: ${session:-ไม่ทราบ} — ยังไม่ได้ล็อก kiosk"
    fi
}

install_lockdown() {
    local missing session_id session
    sudo -v || { echo "ต้องใช้สิทธิ์ sudo" >&2; exit 1; }
    [ -x "$KIOSK_SCRIPT" ] || chmod +x "$KIOSK_SCRIPT" 2>/dev/null || { bad "ไม่พบ $KIOSK_SCRIPT"; exit 1; }
    systemctl list-unit-files gdm.service 2>/dev/null | grep -q '^gdm' ||
        { bad "เครื่องนี้ไม่ได้ใช้ GDM — script นี้ทำมาสำหรับตู้ใหญ่ (GNOME)"; exit 1; }
    if [ "$KIOSK_USER" != "$(id -un)" ] && ! sudo -u "$KIOSK_USER" test -x "$KIOSK_SCRIPT"; then
        bad "$KIOSK_USER รัน $KIOSK_SCRIPT ไม่ได้ (สิทธิ์ไฟล์/โฟลเดอร์)"
        exit 1
    fi

    missing="$(packages_missing | xargs)"
    if [ -n "$missing" ]; then
        info "apt install $missing"
        # shellcheck disable=SC2086
        sudo apt-get update && sudo apt-get install -y $missing ||
            { bad "apt install ไม่สำเร็จ (เน็ตต้อง login captive portal ก่อนหรือไม่?)"; exit 1; }
    fi
    ok "ติดตั้ง ${APT_PACKAGES[*]} แล้ว"

    session_id="$(kiosk_session_id)" || { bad "ไม่พบ session GNOME Kiosk Script หลังติดตั้ง"; exit 1; }
    ok "session: $session_id"

    local vt_before
    vt_before="$(kiosk_gsettings get "$VT_KEYS_SCHEMA" switch-to-session-3 2>/dev/null)"
    if [ "$vt_before" = "$(vt_keybinding_value 3)" ]; then
        info "ค่าเดิมของ Ctrl+Alt+F3 ถูกอยู่แล้ว ($vt_before) — ถ้าเคยกดไม่ได้ สาเหตุไม่ใช่ค่านี้ (ดูหลัง restart)"
    else
        info "ค่าเดิมของ Ctrl+Alt+F3: ${vt_before:-ไม่มี/อ่านไม่ได้} → จะตั้งเป็น $(vt_keybinding_value 3)"
    fi
    set_vt_keys
    case $? in
    0) ok "เปิด Ctrl+Alt+F1..F6 (สลับ TTY) ให้ $KIOSK_USER" ;;
    2) bad "ไม่มี schema $VT_KEYS_SCHEMA — Ctrl+Alt+F3 จะใช้ไม่ได้ (เข้าเครื่องได้ทาง SSH เท่านั้น)" ;;
    *) bad "ตั้ง Ctrl+Alt+F1..F6 ไม่สำเร็จ (gsettings)" ;;
    esac
    set_issue_ip && ok "หน้า login ของ TTY แสดง hostname + IP ($ISSUE_FILE, backup: $ISSUE_FILE.tent-bak)" ||
        warn "แก้ $ISSUE_FILE ไม่สำเร็จ — TTY จะไม่แสดง IP"

    session_script_content "$KIOSK_SCRIPT" | install_as_kiosk 755 "$SESSION_SCRIPT" &&
        ok "เขียน $SESSION_SCRIPT" || bad "เขียน $SESSION_SCRIPT ไม่สำเร็จ"
    # Stops gnome-initial-setup from appearing inside the kiosk session.
    install_as_kiosk 644 "$KIOSK_HOME/.config/gnome-initial-setup-done" </dev/null ||
        warn "สร้าง ~/.config/gnome-initial-setup-done ไม่สำเร็จ"

    # Lock the session before turning autologin on, so a half-run never autologins into GNOME.
    session="$(current_session)"
    if [ -n "$session" ] && [ "$session" != "$session_id" ]; then
        printf '%s\n' "$session" | install_as_kiosk 644 "$PREV_SESSION_FILE" ||
            warn "จำ session เดิม ($session) ไม่สำเร็จ — --disable จะใช้ $FALLBACK_SESSION"
    fi
    if set_session "$session_id"; then
        ok "session ตอน login → $session_id"
        set_autologin && ok "GDM autologin: $KIOSK_USER ($GDM_CONF, backup: $GDM_CONF.tent-bak)" ||
            bad "ตั้ง GDM autologin ไม่สำเร็จ"
    else
        bad "ตั้ง session ไม่สำเร็จ — ไม่เปิด autologin"
    fi

    echo
    if $FAILED; then
        bad "ตั้งค่าไม่ครบ — ดูข้อความด้านบน"
        exit 1
    fi
    ok "ล็อก kiosk แล้ว"
    info "เข้า TTY ในโหมดล็อก: เสียบคีย์บอร์ด → Ctrl+Alt+F3 (หน้า login แสดง IP) · กลับหน้า kiosk: Ctrl+Alt+F1 หรือ F2"
    info "กลับเป็น desktop ปกติ: ./setup_kiosk_lockdown.sh --disable --restart"

    echo
    info "ตรวจค่าที่ตั้ง (--status):"
    show_status
    if $FAILED; then
        exit 1
    fi
}

# Applies the change now. Last step on purpose: it ends the graphical session on the kiosk screen.
restart_gdm() {
    if [ "$RESTART" != true ]; then
        info "มีผลตอน login ครั้งถัดไป: ./setup_kiosk_lockdown.sh --restart หรือ sudo systemctl restart gdm (หรือ reboot)"
        return 0
    fi
    info "restart gdm — จอตู้จะดับแป๊บหนึ่ง (SSH ไม่หลุด)"
    sudo systemctl restart gdm && ok "restart gdm แล้ว" || { bad "restart gdm ไม่สำเร็จ"; exit 1; }
}

disable_lockdown() {
    local previous="$FALLBACK_SESSION"
    sudo -v || { echo "ต้องใช้สิทธิ์ sudo" >&2; exit 1; }
    as_kiosk test -s "$PREV_SESSION_FILE" && previous="$(as_kiosk head -1 "$PREV_SESSION_FILE")"
    set_session "$previous" && ok "session ตอน login → $previous" || { bad "ตั้ง session ไม่สำเร็จ"; exit 1; }
    warn "autologin ยังเปิดอยู่ — ตอนนี้ใครเปิดเครื่องก็เข้า desktop ได้ ซ่อมเสร็จแล้วล็อกกลับด้วย ./setup_kiosk_lockdown.sh --restart"
}

main() {
    local command="install"
    KIOSK_USER="$(id -un)"
    RESTART=false
    while [ $# -gt 0 ]; do
        case "$1" in
        --status | -s) command="status"; shift ;;
        --disable | -d) command="disable"; shift ;;
        --user) KIOSK_USER="${2:?--user ต้องมีชื่อ user}"; shift 2 ;;
        --restart | -r) RESTART=true; shift ;;
        -h | --help) awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"; exit 0 ;;
        *) echo "ไม่รู้จัก option: $1 (ดู --help)" >&2; exit 1 ;;
        esac
    done
    if [ "$(id -u)" -eq 0 ]; then
        echo -e "${RED}❌ รันด้วย user ปกติ (ไม่ต้องใส่ sudo) — ใช้ --user เพื่อเลือก user ของ kiosk${NC}" >&2
        exit 1
    fi
    id "$KIOSK_USER" >/dev/null 2>&1 || { echo -e "${RED}❌ ไม่มี user: $KIOSK_USER${NC}" >&2; exit 1; }
    KIOSK_HOME="$(user_home "$KIOSK_USER")"
    SESSION_SCRIPT="$KIOSK_HOME/.local/bin/gnome-kiosk-script"
    PREV_SESSION_FILE="$KIOSK_HOME/.config/tent-kiosk-lockdown.prev-session"
    info "kiosk user: $KIOSK_USER ($KIOSK_HOME)"

    case "$command" in
    status)
        [ "$RESTART" = true ] && warn "--restart ใช้กับ --status ไม่ได้ (ไม่ได้ restart)"
        show_status
        $FAILED && exit 1 || exit 0
        ;;
    disable) disable_lockdown && restart_gdm ;;
    install) install_lockdown && restart_gdm ;;
    esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    main "$@"
fi
