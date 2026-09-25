#!/bin/bash
# ==============================================================================
# SmartShelter Kiosk - Local label printer test (Xprinter XP-365B via CUPS)
# ------------------------------------------------------------------------------
# ทดสอบ silent print (Chromium --kiosk-printing → CUPS → XP-365B) บนเครื่อง dev
# โดยไม่ต้องรันแอปจริง: สร้างหน้า label ทดสอบ (QR + ชื่อไทย, @page = KIOSK_LABEL_MM)
# → เปิด Chromium โปรไฟล์แยก → พิมพ์อัตโนมัติ → รอ job จบ → ตรวจขนาดภาพที่ driver สร้าง
#
# Usage: ./test_label_print.sh [options]
#   --queue NAME     CUPS queue (default: system default printer)
#   --label WxH      ขนาด label เป็น mm (default: KIOSK_LABEL_MM ใน print-label.ts)
#   --gap N          ระยะ gap ระหว่าง label (mm, default: 2)
#   --count N        จำนวน label ทดสอบ (default: 2)
#   --configure      ตั้งค่า queue ให้ตรง label ก่อนพิมพ์ (ใช้ sudo lpadmin)
#   --manual         ไม่สั่งพิมพ์เอง — กดปุ่มในหน้าเอง, ปิด browser เพื่อจบ
#   --cleanup        ลบภาพงานพิมพ์ที่ driver ทิ้งไว้ใน /tmp หลังจบ (ใช้ sudo)
#   --status         แสดงค่า queue ปัจจุบันแล้วออก
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
FRONTEND_DIR="$REPO_DIR/frontend"
LABEL_TS="$FRONTEND_DIR/src/lib/features/kiosk/domain/print-label.ts"
DPI=203

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info() { echo -e "${BLUE}▸ $*${NC}"; }
ok() { echo -e "${GREEN}✅ $*${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $*${NC}"; }
die() {
    echo -e "${RED}❌ $*${NC}" >&2
    exit 1
}

QUEUE=""
LABEL=""
GAP=2
COUNT=2
CONFIGURE=false
MANUAL=false
CLEANUP=false
STATUS_ONLY=false

while [ $# -gt 0 ]; do
    case "$1" in
    --queue) QUEUE="${2:?--queue ต้องมีชื่อ}"; shift 2 ;;
    --label) LABEL="${2:?--label ต้องเป็น WxH เช่น 60x40}"; shift 2 ;;
    --gap) GAP="${2:?--gap ต้องเป็นตัวเลข mm}"; shift 2 ;;
    --count) COUNT="${2:?--count ต้องเป็นตัวเลข}"; shift 2 ;;
    --configure) CONFIGURE=true; shift ;;
    --manual) MANUAL=true; shift ;;
    --cleanup) CLEANUP=true; shift ;;
    --status) STATUS_ONLY=true; shift ;;
    -h | --help) sed -n '2,19p' "$0"; exit 0 ;;
    *) die "ไม่รู้จัก option: $1 (ดู --help)" ;;
    esac
done

# --- Resolve label size (single source of truth = KIOSK_LABEL_MM) --------------
if [ -z "$LABEL" ]; then
    [ -f "$LABEL_TS" ] || die "ไม่พบ $LABEL_TS — ระบุ --label WxH เอง"
    LABEL="$(sed -nE 's/.*KIOSK_LABEL_MM = \{ width: ([0-9.]+), height: ([0-9.]+) \}.*/\1x\2/p' "$LABEL_TS")"
    [ -n "$LABEL" ] || die "อ่าน KIOSK_LABEL_MM จาก print-label.ts ไม่ได้ — ระบุ --label WxH เอง"
fi
[[ "$LABEL" =~ ^([0-9.]+)x([0-9.]+)$ ]] || die "--label ต้องเป็นรูปแบบ WxH (mm) เช่น 60x40"
LABEL_W="${BASH_REMATCH[1]}"
LABEL_H="${BASH_REMATCH[2]}"
[[ "$COUNT" =~ ^[1-9][0-9]*$ ]] || die "--count ต้องเป็นจำนวนเต็ม ≥ 1"

# --- Preflight -----------------------------------------------------------------
command -v lpstat >/dev/null || die "ไม่พบ CUPS client (lpstat) — sudo apt-get install cups-client"
if [ -z "$QUEUE" ]; then
    QUEUE="$(lpstat -d 2>/dev/null | sed -nE 's/^system default destination: (.+)$/\1/p')"
    [ -n "$QUEUE" ] || die "ไม่มี default printer — ระบุ --queue NAME"
fi
lpstat -p "$QUEUE" >/dev/null 2>&1 || die "ไม่พบ queue '$QUEUE' (ดู lpstat -p)"

show_status() {
    info "Queue: $QUEUE"
    lpstat -p "$QUEUE" | sed 's/^/    /'
    lpoptions -p "$QUEUE" -l | grep -E '^(PageSize|MediaMethod|PaperType|GapsHeight|Darkness|PrintSpeed)/' | sed 's/^/    /'
    lpstat -d | sed 's/^/    /'
}

if $STATUS_ONLY; then
    show_status
    exit 0
fi

# --- 1) Configure queue for the label roll ------------------------------------
current_page_size="$(lpoptions -p "$QUEUE" -l | sed -nE 's/^PageSize[^:]*:.*\*([^ ]+).*/\1/p')"
if [ "$current_page_size" = "Custom.WIDTHxHEIGHT" ]; then
    # lpoptions hides custom dimensions; the queue PPD has them but is root:lp 0640 (no password prompt here).
    current_page_size="$(sudo -n sed -n 's/^\*DefaultPageSize: *//p' "/etc/cups/ppd/$QUEUE.ppd" 2>/dev/null | tr -d '\r' || true)"
    current_page_size="${current_page_size:-custom}"
fi
if $CONFIGURE; then
    info "ตั้งค่า $QUEUE → PageSize=Custom.${LABEL}mm, LabelGaps gap ${GAP} mm (ต้องใช้ sudo)"
    sudo lpadmin -p "$QUEUE" \
        -o PageSize="Custom.${LABEL}mm" \
        -o MediaMethod=Direct -o PaperType=LabelGaps -o GapsHeight="$GAP" \
        -o Darkness=10 -o PrintSpeed=3 \
        -o printer-error-policy=abort-job
    ok "ตั้งค่า queue แล้ว"
elif [ "$current_page_size" = custom ]; then
    info "PageSize ของ $QUEUE เป็นขนาด custom (ตรวจตัวเลขได้ด้วย: sudo grep DefaultPageSize /etc/cups/ppd/$QUEUE.ppd)"
elif [ "$current_page_size" != "Custom.${LABEL}mm" ]; then
    warn "PageSize ของ $QUEUE = '${current_page_size:-?}' ไม่ตรง label ${LABEL} mm → อาจพิมพ์คร่อม/ว่าง (ใช้ --configure เพื่อตั้งค่า)"
fi

# --- 2) Find Chromium (Pi OS = /usr/bin/chromium, Ubuntu = snap) -----------------
CHROMIUM=""
for candidate in /usr/bin/chromium /snap/bin/chromium /usr/bin/chromium-browser; do
    if [ -x "$candidate" ]; then
        CHROMIUM="$candidate"
        break
    fi
done
[ -n "$CHROMIUM" ] || die "ไม่พบ Chromium"
# snap Chromium มองไม่เห็น /tmp ของ host และเขียนได้เฉพาะใต้ ~/snap/chromium/
# /snap/bin/chromium เป็น symlink ไป /usr/bin/snap; /usr/bin/chromium-browser บน Ubuntu เป็น wrapper ของ snap
if [[ "$CHROMIUM" == /snap/* || "$(readlink -f "$CHROMIUM")" == */snap ]] ||
    grep -qs '/snap/bin/chromium' "$CHROMIUM"; then
    PROFILE_DIR="$HOME/snap/chromium/common/tent-print-test"
else
    PROFILE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/tent-print-test"
fi
mkdir -p "$PROFILE_DIR"

# --- 3) Build the test page (QR payload is fake — not real evacuee data) --------
command -v python3 >/dev/null || die "ไม่พบ python3 (ใช้สร้างหน้าทดสอบ + เปิด http server ชั่วคราว)"
# Pi: qrencode (ติดตั้งโดย setup_printer.sh); dev laptop: fallback เป็น frontend/node_modules/qrcode
if command -v qrencode >/dev/null; then
    QR_TOOL=qrencode
elif command -v node >/dev/null && [ -d "$FRONTEND_DIR/node_modules/qrcode" ]; then
    QR_TOOL=node
else
    die "ต้องมี qrencode (sudo apt-get install qrencode) หรือ node + frontend/node_modules (pnpm install ใน frontend)"
fi

WORK_DIR="$(mktemp -d)"
SERVER_PID=""
cleanup_work() {
    [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true
    pkill -f -- "--user-data-dir=$PROFILE_DIR" 2>/dev/null || true
    rm -rf "$WORK_DIR"
}
trap cleanup_work EXIT

for i in $(seq 1 "$COUNT"); do
    payload="evacuee:01TESTPRINT$(printf '%015d' "$i")"
    echo "$payload" >"$WORK_DIR/qr_$i.txt"
    if [ "$QR_TOOL" = qrencode ]; then
        qrencode -t SVG -m 4 -o "$WORK_DIR/qr_$i.svg" "$payload"
    else
        NODE_PATH="$FRONTEND_DIR/node_modules" node -e \
            'require("qrcode").toString(process.argv[1], { type: "svg", margin: 4 }).then((s) => process.stdout.write(s))' \
            "$payload" >"$WORK_DIR/qr_$i.svg"
    fi
done

python3 - "$WORK_DIR" "$LABEL_W" "$LABEL_H" "$COUNT" <<'PY'
import html, sys
from pathlib import Path

work, w, h, count = Path(sys.argv[1]), float(sys.argv[2]), float(sys.argv[3]), int(sys.argv[4])
names = ["ทดสอบ หนึ่ง", "ทดสอบ สอง นามสกุลยาวมากเพื่อดูการตัดคำ", "ทดสอบ สาม"]
qr_mm = min(h, w / 2) - 4
labels = []
for i in range(1, count + 1):
    svg = (work / f"qr_{i}.svg").read_text()
    svg = svg[svg.index("<svg"):]  # drop the XML prolog/doctype so the SVG can be inlined
    payload = (work / f"qr_{i}.txt").read_text().strip()
    labels.append(
        f'<div class="label">{svg}<div class="txt"><b>{names[(i - 1) % len(names)]}</b>'
        f"<small>{html.escape(payload)}</small></div></div>"
    )
(work / "index.html").write_text(f"""<!doctype html><html lang="th"><head><meta charset="utf-8"><title>Label print test</title>
<style>
@page{{size:{w:g}mm {h:g}mm;margin:0}}
body{{font-family:sans-serif;margin:16px}}
.label{{width:{w:g}mm;height:{h:g}mm;box-sizing:border-box;padding:2mm;display:flex;gap:2mm;align-items:center;border:1px dashed #999;margin-bottom:8px;overflow:hidden}}
.label svg{{width:{qr_mm:g}mm;height:{qr_mm:g}mm;flex:none;shape-rendering:crispEdges}}
.txt{{display:flex;flex-direction:column;gap:1mm;font-size:10pt;min-width:0}}
.txt small{{font-size:6pt;word-break:break-all}}
@media print{{body{{margin:0}}.no-print{{display:none}}.label{{border:0;margin:0;break-after:page}}.label:last-child{{break-after:auto}}}}
</style></head><body>
<div class="no-print"><button id="p" style="font-size:20px;padding:12px 24px">พิมพ์ {count} label</button></div>
{"".join(labels)}
<script>document.getElementById('p').onclick=()=>window.print();if(new URLSearchParams(location.search).has('auto'))setTimeout(()=>window.print(),800);</script>
</body></html>""")
PY

PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')"
python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$WORK_DIR" >/dev/null 2>&1 &
SERVER_PID=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do
    python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:$PORT/')" 2>/dev/null && break
    sleep 0.3
done

# --- 4) Print via Chromium --kiosk-printing -------------------------------------
last_job_id() {
    lpstat -W all -o "$QUEUE" 2>/dev/null | sed -nE "s/^${QUEUE}-([0-9]+) .*/\1/p" | sort -n | tail -1
}
BEFORE_JOB="$(last_job_id)"
BEFORE_JOB="${BEFORE_JOB:-0}"
MARKER="$WORK_DIR/marker"
touch "$MARKER"

URL="http://127.0.0.1:$PORT/index.html"
$MANUAL || URL="$URL?auto=1"
info "เปิด $CHROMIUM (--kiosk-printing, โปรไฟล์ $PROFILE_DIR)"
"$CHROMIUM" --user-data-dir="$PROFILE_DIR" --kiosk-printing --no-first-run \
    --disable-session-crashed-bubble --noerrdialogs "$URL" >"$WORK_DIR/chromium.log" 2>&1 &
CHROME_PID=$!

chromium_died() {
    echo -e "${RED}❌ Chromium ปิดตัวเองก่อนพิมพ์ — log:${NC}" >&2
    tail -20 "$WORK_DIR/chromium.log" | sed 's/^/    /' >&2
    exit 1
}

if $MANUAL; then
    info "กดปุ่มในหน้าเพื่อพิมพ์ — ปิดหน้าต่าง browser เมื่อเสร็จ"
    wait "$CHROME_PID" || true
else
    info "รอ job ใหม่ใน $QUEUE (สูงสุด 60 วินาที)..."
    new_job=""
    for _ in $(seq 1 60); do
        latest="$(last_job_id)"
        if [ -n "$latest" ] && [ "$latest" -gt "$BEFORE_JOB" ] &&
            lpstat -W completed -o "$QUEUE" | grep -q "^${QUEUE}-${latest} "; then
            new_job="$latest"
            break
        fi
        kill -0 "$CHROME_PID" 2>/dev/null || pgrep -f -- "--user-data-dir=$PROFILE_DIR" >/dev/null || chromium_died
        sleep 1
    done
    pkill -f -- "--user-data-dir=$PROFILE_DIR" 2>/dev/null || true
    [ -n "$new_job" ] || {
        lpstat -o "$QUEUE" | sed 's/^/    /'
        die "ไม่มี job ใหม่เสร็จภายใน 60 วินาที — ถ้าเห็น print dialog แปลว่า --kiosk-printing ไม่ทำงาน (ปิด Chromium ทุกหน้าต่างแล้วลองใหม่)"
    }
fi

# --- 5) Report ----------------------------------------------------------------
echo
info "Job ใหม่ใน $QUEUE"
lpstat -W completed -l -o "$QUEUE" | awk -v q="$QUEUE" -v b="$BEFORE_JOB" '
    $1 ~ "^" q "-[0-9]+$" { n = split($1, a, "-"); show = (a[n] + 0 > b + 0) }
    show { print "    " $0 }'

# The XP-365B TSPL filter dumps an 8-bit BMP of each page into /tmp (see plan §1.3):
# its byte size tells whether CUPS rendered the label size or the 4x6 default.
mapfile -t BMPS < <(find /tmp -maxdepth 1 -name 'origin_*.bmp' -newer "$MARKER" 2>/dev/null | sort)
if [ ${#BMPS[@]} -eq 0 ]; then
    warn "ไม่พบภาพ /tmp/origin_*.bmp ของ job นี้ (wrapper ของ setup_printer.sh ลบทันทีหลังพิมพ์ หรือ cups ใช้ PrivateTmp) — ตรวจขนาดด้วยตาแทน"
else
    if python3 - "$LABEL_W" "$LABEL_H" "$DPI" "$COUNT" "${BMPS[@]}" <<'PY'
import math, os, sys
w_mm, h_mm, dpi, count = float(sys.argv[1]), float(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
files = sys.argv[5:]

def bmp_bytes(w, h):  # 8-bit BMP: 54-byte header + 256-colour palette + 4-byte-aligned rows
    return 54 + 1024 + ((w + 3) & ~3) * h

def dots(mm):
    exact = mm / 25.4 * dpi
    return sorted({math.floor(exact), round(exact), math.ceil(exact)})

expected = {bmp_bytes(w, h): (w, h) for w in dots(w_mm) for h in dots(h_mm)}
known = {bmp_bytes(812, 1218): "4x6 in (w4h6 default)", bmp_bytes(812, 812): "4x4 in", bmp_bytes(406, 812): "2x4 in"}
good = 0
for f in files:
    size = os.path.getsize(f)
    if size in expected:
        w, h = expected[size]
        good += 1
        print(f"    ✅ {os.path.basename(f)}: {w}x{h} dots = label {w_mm:g}x{h_mm:g} mm")
    else:
        print(f"    ❌ {os.path.basename(f)}: {size} bytes — {known.get(size, 'ไม่ตรงขนาด label')}")
print(f"    ภาพ {len(files)} หน้า (คาดไว้ {count}), ขนาดถูก {good} หน้า")
sys.exit(0 if good == len(files) == count else 3)
PY
    then
        ok "ขนาดหน้าที่ส่งถึง driver ตรงกับ label"
    else
        warn "ขนาด/จำนวนหน้าไม่ตรง — ดูตารางด้านบน"
    fi
fi

echo
info "ตรวจด้วยตา: ออก $COUNT ดวงพอดี · ไม่มีดวงว่าง/คร่อมรอยฉีก · ไม่ถูกย่อ/ตัดขอบ · QR สแกนได้ · ไม่มี header/footer"

if $CLEANUP; then
    info "ลบภาพงานพิมพ์ที่ driver ทิ้งไว้ใน /tmp (ต้องใช้ sudo)"
    sudo rm -f /tmp/origin_*.bmp /tmp/dithered_*.bmp /tmp/prnimg_*.bmp /tmp/xxxxx.log
    ok "ลบแล้ว"
else
    warn "driver ทิ้งภาพงานพิมพ์ไว้ใน /tmp — ลบด้วย --cleanup หรือ: sudo rm -f /tmp/origin_*.bmp /tmp/dithered_*.bmp /tmp/prnimg_*.bmp"
fi
