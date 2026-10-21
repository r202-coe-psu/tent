#!/bin/bash
# ==============================================================================
# SmartShelter Kiosk - ผูก CUPS queue ของ label printer เข้ากับ XP-365B ที่เสียบอยู่ตอนนี้
# ------------------------------------------------------------------------------
# CUPS เก็บ serial ของเครื่องไว้ใน device URI ของ queue (usb://Xprinter/XP-365B?serial=…)
# พอเปลี่ยนเป็น XP-365B อีกตัว (รุ่นเดียวกัน) queue จะรอเครื่องตัวเก่า
# ("Waiting for printer to become available") — script นี้ชี้ queue ไปที่ตัวที่เสียบอยู่แทน
#
# start_kiosk.sh เรียกทุกครั้งที่ boot · เปลี่ยนเครื่องตอนเปิดอยู่ก็รันเองได้เลย (ไม่ต้อง sudo
# แต่ user ต้องอยู่กลุ่ม lpadmin) · ไม่แตะ queue อื่น และไม่ fail — ถ้าไม่แน่ใจจะแค่ log แล้วข้าม
#
# Usage: ./rebind_printer.sh [queue]   (default: tent_xprinter)
# ==============================================================================

export LC_ALL=C # lpstat output is parsed
QUEUE="${1:-tent_xprinter}"
TRIES="${REBIND_TRIES:-3}"
RETRY_SEC="${REBIND_RETRY_SEC:-2}"

log() { echo "[$(date)] rebind_printer: $*"; }

# XP-365B device URIs on USB now, one per line (same match as setup_printer.sh find_printer_uri).
# Right after boot the usb backend may not see the printer yet — retry a few times.
plugged_uris() {
    local uris="" i
    for ((i = 1; i <= TRIES; i++)); do
        uris="$(lpinfo --timeout 10 --include-schemes usb -v 2>/dev/null |
            awk '$2 ~ /^usb:\/\// && tolower($2) ~ /xprinter|xp-365/ {print $2}')"
        [ -n "$uris" ] && break
        [ "$i" -lt "$TRIES" ] && sleep "$RETRY_SEC"
    done
    printf '%s' "$uris"
}

current="$(lpstat -v "$QUEUE" 2>/dev/null | awk '{print $NF; exit}')"
if [ -z "$current" ]; then
    log "ไม่มี queue $QUEUE — รัน ./setup_printer.sh ก่อน"
    exit 0
fi

plugged="$(plugged_uris)"
if [ -z "$plugged" ]; then
    log "ไม่พบ XP-365B บน USB — คง $QUEUE ไว้ที่ $current"
elif grep -qxF "$current" <<<"$plugged"; then
    log "$QUEUE ชี้ $current อยู่แล้ว"
elif [ "$(wc -l <<<"$plugged")" -gt 1 ]; then
    log "เสียบ XP-365B หลายตัวและไม่มีตัวไหนตรงกับ $QUEUE — ถอดให้เหลือตัวเดียว: $(tr '\n' ' ' <<<"$plugged")"
else
    log "$QUEUE: $current → $plugged"
    # Pausing first puts a job stuck waiting on the old printer back in the queue, so it restarts
    # on the new one once the queue is enabled again.
    cupsdisable "$QUEUE" && lpadmin -p "$QUEUE" -v "$plugged" ||
        log "ผูก $QUEUE ใหม่ไม่สำเร็จ (user ต้องอยู่กลุ่ม lpadmin)"
    cupsenable "$QUEUE"
fi
exit 0
