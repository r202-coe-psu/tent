/**
 * Monotonic ULID generator (Crockford base32, 48-bit time + 80-bit randomness).
 *
 * ULIDs are the project's idempotency key (see docs/data/data-model.md §2): a
 * client can mint an `_id` while offline, and a retried `put` of the same doc
 * collides on `_id` (409) instead of creating a duplicate. ULIDs are also
 * lexicographically sortable by creation time, which the schema relies on for
 * append-only event ordering.
 *
 * No runtime dependency — uses the Web Crypto RNG available in the browser and
 * in Node test environments.
 */

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32 (no I, L, O, U)
const TIME_LEN = 10;
const RANDOM_LEN = 16;

let lastTime = -1;
let lastRandom: number[] = [];

function randomByte(): number {
	const buf = new Uint8Array(1);
	crypto.getRandomValues(buf);
	return buf[0];
}

function encodeTime(time: number): string {
	let out = '';
	for (let i = TIME_LEN - 1; i >= 0; i--) {
		const mod = time % 32;
		out = ENCODING[mod] + out;
		time = (time - mod) / 32;
	}
	return out;
}

function randomChars(): number[] {
	// Each char is 5 bits; draw a fresh random index per char.
	return Array.from({ length: RANDOM_LEN }, () => randomByte() % 32);
}

/** Increment a base32 random component in place (carry-propagating) for monotonicity. */
function incrementRandom(chars: number[]): number[] {
	const out = [...chars];
	for (let i = RANDOM_LEN - 1; i >= 0; i--) {
		if (out[i] < 31) {
			out[i] += 1;
			return out;
		}
		out[i] = 0; // carry
	}
	// Overflow within the same millisecond is astronomically unlikely; restart.
	return randomChars();
}

/**
 * Generate a 26-char ULID. Within the same millisecond the random component is
 * incremented (not redrawn) so successive ULIDs stay strictly increasing.
 */
export function ulid(seedTime: number = Date.now()): string {
	if (seedTime === lastTime) {
		lastRandom = incrementRandom(lastRandom);
	} else {
		lastTime = seedTime;
		lastRandom = randomChars();
	}
	return encodeTime(seedTime) + lastRandom.map((c) => ENCODING[c]).join('');
}

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** True when `value` is a syntactically valid 26-char Crockford-base32 ULID. */
export function isUlid(value: string): boolean {
	return ULID_RE.test(value);
}
