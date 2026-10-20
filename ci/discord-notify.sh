#!/usr/bin/env bash
# Post a single Discord embed describing a Jenkins build result.
# Contract and setup: ci/README.md. Inputs come from env only (never argv).
# Pure bash on purpose: the Jenkins agent is not guaranteed to have jq or python3.

set -Eeuo pipefail
set +x

readonly COLOR_GREEN=3066993  # 0x2ECC71
readonly COLOR_RED=15158332   # 0xE74C3C
readonly COLOR_YELLOW=15844367  # 0xF1C40F
readonly COLOR_GREY=9807270   # 0x95A5A6

# Cut a string to at most $2 bytes (appending "...") without splitting a UTF-8 sequence.
# Byte-based on purpose: it is locale independent and never exceeds Discord's char limits.
truncate_str() {
	local LC_ALL=C
	local s="$1" max="$2" n i o need
	if ((${#s} <= max)); then
		printf '%s' "$s"
		return
	fi
	s="${s:0:max-3}"
	n=${#s}
	for i in 1 2 3; do
		((i <= n)) || break
		printf -v o '%d' "'${s:n-i:1}"
		o=$((o & 255))
		if ((o < 128)); then
			break
		elif ((o >= 192)); then
			if ((o < 224)); then need=2; elif ((o < 240)); then need=3; else need=4; fi
			if ((i < need)); then s="${s:0:n-i}"; fi
			break
		fi
	done
	printf '%s...' "$s"
}

# Escape a string for use inside a JSON string literal.
json_escape() {
	local s="$1" c ch ch_json
	s="${s//\\/\\\\}"
	s="${s//\"/\\\"}"
	s="${s//$'\n'/\\n}"
	s="${s//$'\r'/\\r}"
	s="${s//$'\t'/\\t}"
	if [[ "$s" == *[[:cntrl:]]* ]]; then
		for ((c = 1; c < 32; c++)); do
			printf -v ch "\\x$(printf '%02x' "$c")"
			printf -v ch_json '\\u%04x' "$c"
			s="${s//"$ch"/$ch_json}"
		done
	fi
	printf '%s' "$s"
}

# truncate then escape, so escape sequences are never cut in half.
js() {
	json_escape "$(truncate_str "$1" "$2")"
}

result="${NOTIFY_RESULT:-UNKNOWN}"
kind="${NOTIFY_KIND:-build}"
target="${NOTIFY_TARGET:-}"

case "$result" in
SUCCESS) emoji='✅'; verb='succeeded'; color=$COLOR_GREEN ;;
FAILURE) emoji='❌'; verb='failed'; color=$COLOR_RED ;;
UNSTABLE) emoji='⚠️'; verb='unstable'; color=$COLOR_YELLOW ;;
ABORTED) emoji='⏹️'; verb='aborted'; color=$COLOR_GREY ;;
NOT_BUILT) emoji='⚪'; verb='not built'; color=$COLOR_GREY ;;
*) emoji='❔'; verb="finished (${result,,})"; color=$COLOR_GREY ;;
esac

case "$kind" in
build) label='Build' ;;
deploy) label='Deploy' ;;
e2e) label='Staging E2E' ;;
janitor) label='E2E janitor' ;;
*) label="$kind" ;;
esac

title="${emoji} ${label}${target:+ $target} ${verb}"
if [[ -n "${NOTIFY_JOB:-}" ]]; then
	title+=" — ${NOTIFY_JOB}${NOTIFY_BUILD_NUMBER:+ #$NOTIFY_BUILD_NUMBER}"
fi

commit="${NOTIFY_COMMIT:-}"
if [[ "$commit" =~ ^[0-9a-fA-F]{7,40}$ ]]; then
	commit="${commit:0:7}"
fi

fields=()
add_field() { # name value [inline=true]
	[[ -n "$2" ]] || return 0
	fields+=("{\"name\":\"$(js "$1" 256)\",\"value\":\"$(js "$2" 1024)\",\"inline\":${3:-true}}")
}
add_field 'Branch' "${NOTIFY_BRANCH:-}"
add_field 'Commit' "${commit:+\`$commit\`}"
add_field 'Duration' "${NOTIFY_DURATION:-}"
add_field 'E2E' "${NOTIFY_E2E_RESULT:-}"

fields_json=''
for f in "${fields[@]+"${fields[@]}"}"; do
	fields_json+="${fields_json:+,}${f}"
done

build_payload() {
	local url_json='' desc_json=''
	[[ -z "${NOTIFY_BUILD_URL:-}" ]] || url_json=",\"url\":\"$(js "$NOTIFY_BUILD_URL" 2048)\""
	[[ -z "${NOTIFY_DETAIL:-}" ]] || desc_json=",\"description\":\"$(js "$NOTIFY_DETAIL" 4096)\""
	printf '{"allowed_mentions":{"parse":[]},"embeds":[{"title":"%s"%s%s,"color":%s,"fields":[%s],"timestamp":"%s"}]}\n' \
		"$(js "$title" 256)" "$url_json" "$desc_json" "$color" "$fields_json" \
		"$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}

if [[ "${DRY_RUN:-}" == "1" ]]; then
	build_payload
	exit 0
fi

if [[ -z "${DISCORD_WEBHOOK_URL:-}" ]]; then
	printf 'discord-notify: DISCORD_WEBHOOK_URL is empty; skipping notification.\n' >&2
	exit 0
fi

if [[ ! "$DISCORD_WEBHOOK_URL" =~ ^https?://[^[:space:]\"\\]+$ ]]; then
	printf 'discord-notify: DISCORD_WEBHOOK_URL is not a valid URL.\n' >&2
	exit 1
fi

# The URL is passed through a curl config on an fd (not argv) so it never shows up in `ps`.
build_payload | curl -sS --fail --max-time 10 --retry 2 \
	-H 'Content-Type: application/json' --data-binary @- \
	-K <(printf 'url = "%s"\n' "$DISCORD_WEBHOOK_URL") >/dev/null
