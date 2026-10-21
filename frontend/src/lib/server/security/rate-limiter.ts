import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';

/**
 * `RATE_LIMIT` — server-only runtime env, the e2e/staging switch of CR-160.
 *
 * `true` only when the value is exactly `false` or `0` (trimmed, case-insensitive); unset,
 * empty or any other value — including typos — leaves limiting on. Read per call because
 * `$env/dynamic/private` is a runtime lookup. It only ever affects limiters constructed
 * with `{ bypassable: true }`; every other limiter ignores it.
 */
function rateLimitSwitchedOff(): boolean {
	const raw = env.RATE_LIMIT?.trim().toLowerCase();
	return raw === 'false' || raw === '0';
}

/** The dev server's own address — local runs and e2e are never limited. */
function isDevLoopback(key: string): boolean {
	return (
		dev &&
		(key === '127.0.0.1' || key === '::1' || key === 'localhost' || key === '::ffff:127.0.0.1')
	);
}

interface RateLimitEntry {
	timestamps: number[];
}

export class RateLimiter {
	private store = new Map<string, RateLimitEntry>();
	private windowMs: number;
	private maxRequests: number;
	/**
	 * Whether `RATE_LIMIT=false|0` may turn this limiter off. Default `false` (fail-closed):
	 * only the public donation / pre-register forms that e2e drives opt in; auth, secret
	 * reveal, link-account, volunteer and anything added later always enforce.
	 */
	readonly bypassable: boolean;

	constructor(
		windowMs: number = 60000,
		maxRequests: number = 3,
		options?: { bypassable?: boolean }
	) {
		this.windowMs = windowMs;
		this.maxRequests = maxRequests;
		this.bypassable = options?.bypassable ?? false;
	}

	/**
	 * Checks if the given key (IP or phone) has exceeded the rate limit.
	 * Returns true if allowed, false if blocked.
	 */
	check(key: string): boolean {
		if (!key) return true;
		// CR-160 switch: allow without counting, so re-enabling starts from a clean slate.
		if (this.bypassable && rateLimitSwitchedOff()) return true;
		if (isDevLoopback(key)) return true;

		const now = Date.now();
		const entry = this.store.get(key) || { timestamps: [] };

		// Filter timestamps within the current window
		entry.timestamps = entry.timestamps.filter((ts) => now - ts < this.windowMs);

		if (entry.timestamps.length >= this.maxRequests) {
			this.store.set(key, entry);
			return false; // Rate limit exceeded
		}

		entry.timestamps.push(now);
		this.store.set(key, entry);

		// Optionally clean up expired entries periodically to prevent memory leaks
		this.cleanup(now);

		return true;
	}

	/**
	 * True when `key` has used its whole budget in the current window. Never consumes, so a
	 * caller can gate on it and spend budget with `check()` only for the events it counts
	 * (e.g. failed verifications).
	 */
	isBlocked(key: string): boolean {
		if (!key) return false;
		if (this.bypassable && rateLimitSwitchedOff()) return false;
		const now = Date.now();
		const active = (this.store.get(key)?.timestamps ?? []).filter((ts) => now - ts < this.windowMs);
		return active.length >= this.maxRequests;
	}

	private cleanup(now: number) {
		// Clean up every 100 requests roughly (naive approach)
		if (Math.random() < 0.01) {
			for (const [k, v] of this.store.entries()) {
				const active = v.timestamps.filter((ts) => now - ts < this.windowMs);
				if (active.length === 0) {
					this.store.delete(k);
				} else {
					this.store.set(k, { timestamps: active });
				}
			}
		}
	}
}

/**
 * How many different values one key has used in a window — "how many different phone
 * numbers has this IP searched" (CR-173 FR-8). A rate limit caps how often; this caps how
 * widely, which is what walking through numbers looks like. Same exemptions as
 * `RateLimiter`.
 */
export class DistinctValueWindow {
	private store = new Map<string, Map<string, number>>();

	constructor(
		private readonly windowMs: number,
		private readonly maxDistinct: number,
		private readonly options: { bypassable?: boolean } = {}
	) {}

	/**
	 * Records `value` against `key`. True while `key` has used no more than `maxDistinct`
	 * different values in the window, counting this one; repeating a value never adds.
	 */
	record(key: string, value: string): boolean {
		if (!key || !value) return true;
		if (this.options.bypassable && rateLimitSwitchedOff()) return true;
		if (isDevLoopback(key)) return true;

		const now = Date.now();
		const seen = this.store.get(key) ?? new Map<string, number>();
		for (const [v, ts] of seen) if (now - ts >= this.windowMs) seen.delete(v);
		seen.set(value, now);
		this.store.set(key, seen);
		this.cleanup(now);
		return seen.size <= this.maxDistinct;
	}

	private cleanup(now: number) {
		if (Math.random() >= 0.01) return;
		for (const [k, seen] of this.store) {
			for (const [v, ts] of seen) if (now - ts >= this.windowMs) seen.delete(v);
			if (seen.size === 0) this.store.delete(k);
		}
	}
}

// Singleton instances, one per surface rather than one shared budget.
//
// They were a single 3-per-minute limiter for every donation route, which meant one
// edit cost three: loading the ticket, saving, and the refetch after saving. CR-080
// settled that a donor may edit as often as they like, held only by the IP limit — so
// the limit has to leave room for editing at all.
//
// The numbers follow what each surface exposes:

/**
 * Staff login captcha verify — credential-stuffing surface; room for retries,
 * still caps a script hammering the BFF gate before CouchDB `_session`.
 */
export const loginCaptchaIpLimiter = new RateLimiter(60_000, 10);

/**
 * Staff login identifier resolve (username ↔ phone). Enumeration-ish surface —
 * same budget as captcha verify so a script cannot walk the phone book.
 */
export const loginResolveIpLimiter = new RateLimiter(60_000, 10);

/**
 * Third-party client secret reveal — own-password re-auth against CouchDB `_session`
 * (CR-136). Same budget as login captcha: it's
 * an already-authenticated SA, not an anonymous credential-stuffing surface, but a
 * wrong-password guess still shouldn't be unlimited.
 */
export const thirdPartyClientSecretRevealLimiter = new RateLimiter(60_000, 10);

/**
 * Link-on-first-login attempts per `pending_link` nonce (CR-141 FR-20) — 5 tries per OAuth
 * round; the window matches the cookie lifetime. Per worker, like every limiter here.
 */
export const linkAccountNonceLimiter = new RateLimiter(10 * 60_000, 5);

/** Link-on-first-login per IP — same budget as login captcha verify. */
export const linkAccountIpLimiter = new RateLimiter(60_000, 10);

/** Creating a booking. The abuse vector CR-005 set this at — deliberately tight. */
export const donationIpLimiter = new RateLimiter(60000, 3, { bypassable: true });
/** Same, per phone number, so one abuser cannot spread across IPs. */
export const donationPhoneLimiter = new RateLimiter(60000, 3, { bypassable: true });
/**
 * Changing a booking that already exists: edit, courier number, cancel.
 *
 * Reaching one requires the tracking token, which is 128 bits of unguessable, and the
 * blast radius is a single record the caller already owns. Ten a minute is generous for
 * a person and still caps a script.
 */
export const donationEditLimiter = new RateLimiter(60000, 10, { bypassable: true });
/**
 * Reading one's own ticket. Idempotent, token-gated, and the page refetches after every
 * change — counting it against the write budget is what made editing twice impossible.
 * Still limited, because each read reaches FastAPI and Mongo.
 */
export const donationReadLimiter = new RateLimiter(60000, 30, { bypassable: true });
/**
 * Finding a ticket by booking ref + phone (`track-search`). Its own bucket (#459): it
 * used to share `donationIpLimiter`, so a donor checking a booking spent the budget for
 * making one. Ten a minute leaves room for typos; the ref + phone pair is what makes a
 * guess expensive, as with `registerLookupIpLimiter`. Not bypassable: CR-160 keeps
 * limiters added after it on in every environment, and this one has room for e2e.
 */
export const donationTrackSearchLimiter = new RateLimiter(60000, 10);
/**
 * Finding every booking of a phone number (CR-173 FR-7). The widest door into donor PII
 * there is — a number alone hands back full access — so it is held per IP and per number:
 * 5 a minute per IP, 10 an hour per number so spreading across IPs does not help. Never
 * bypassable (CR-160), like the volunteer ticket find it mirrors.
 */
export const donationPhoneLookupIpLimiter = new RateLimiter(60_000, 5);
export const donationPhoneLookupPhoneLimiter = new RateLimiter(60 * 60_000, 10);
/**
 * More than 3 different numbers from one IP inside 5 minutes asks for a captcha before
 * the next (CR-173 FR-8). A donor has one number, maybe a relative's; a walk has many.
 */
export const donationPhoneLookupSpread = new DistinctValueWindow(5 * 60_000, 3);
/**
 * The wizard's window grid (`GET /donations/slots`). Anonymous and keyed by IP only, and
 * each call scans every `donation_slot:` and `donation:` doc of a shelter with admin
 * credentials — the heaviest public read — so it gets its own bucket rather than sharing
 * the ticket-read budget. Changing date or queue refetches, hence 30 a minute.
 */
export const donationSlotsLimiter = new RateLimiter(60000, 30);

// Public booking (CR-070 / T-71). Separate buckets from donations so a busy
// donation drive cannot lock a family out of booking a place to sleep.
// One household books once; 3/min per IP still allows correcting a typo.
export const registerIpLimiter = new RateLimiter(60000, 3, { bypassable: true });
export const registerPhoneLimiter = new RateLimiter(60000, 3, { bypassable: true });
// Lookup is a read but also an enumeration surface — hold it tighter.
export const registerLookupIpLimiter = new RateLimiter(60000, 10, { bypassable: true });

/** Kiosk phone lookup — per scanner device (registry_id), FR-KPC-59. */
export const kioskPhoneDeviceLimiter = new RateLimiter(60_000, 10);
/** Kiosk phone lookup — per normalized phone across devices. */
export const kioskPhoneNumberLimiter = new RateLimiter(60_000, 5);
/** Kiosk QR reprint — per scanner device (registry_id). */
export const kioskReprintDeviceLimiter = new RateLimiter(60_000, 10);
/**
 * Kiosk QR reprint — failed ID last-4 verifications per primary evacuee (5 per 10 minutes).
 * Only failures consume it (`isBlocked` gates, `check` records), so a correct entry is never
 * counted but a guesser of the 10 000 possible codes is locked out after five misses.
 */
export const kioskReprintVerifyFailureLimiter = new RateLimiter(10 * 60_000, 5);
/** Kiosk volunteer role card — per scanner device (registry_id). */
export const kioskVolunteerCardDeviceLimiter = new RateLimiter(60_000, 10);
/** Kiosk volunteer role card — per phone (sha256) across devices, counts every request. */
export const kioskVolunteerCardPhoneLimiter = new RateLimiter(10 * 60_000, 3);
/** Walk-in creation — per authenticated kiosk device. */
export const kioskRegisterDeviceLimiter = new RateLimiter(60_000, 5);
/** Kiosk ThaiD session creation — per scanner device (registry_id). D-5 proposal, pending PO decision. */
export const kioskThaidSessionDeviceLimiter = new RateLimiter(60_000, 10);

// Public volunteer board (CR-092 / T-28). Its own buckets so a donation drive and a
// volunteer callout cannot starve each other.
/**
 * Submitting an application. CR-092 FR-VOL-02.3 sets this at 3 per 10 minutes per IP
 * and per phone — a longer window than the donation limiter because the abuse being
 * priced here is filling a shelter's roster with people who will not turn up, and one
 * genuine volunteer signs up for a handful of shifts at most.
 */
export const volunteerApplyIpLimiter = new RateLimiter(600000, 3);
/** Same window, keyed by phone, so one abuser cannot spread across IPs. */
export const volunteerApplyPhoneLimiter = new RateLimiter(600000, 3);
/**
 * Looking a ticket up by phone number. An enumeration surface — it answers "does this
 * number have a ticket" — so it is held tighter than reading a ticket you hold the
 * token for.
 */
export const volunteerTicketFindLimiter = new RateLimiter(60000, 5);
/** Reading or cancelling one's own ticket. Token-gated; the page refetches after a change. */
export const volunteerTicketLimiter = new RateLimiter(60000, 30);
/**
 * Answering a dispatched shift. The tightest of the volunteer limiters: it is the only
 * public volunteer surface where a correct guess performs a write, the code is six
 * characters rather than 128 bits, and a declined shift cannot be un-declined by the
 * volunteer. Ten a minute leaves room for mistyping a code read over a bad phone line,
 * and nothing like enough for a search.
 */
/**
 * Editing your own profile from the portal. Tighter than the reads because it is a
 * write reached with a guessable credential, loose enough that someone correcting a
 * typo and re-picking their skills does not get locked out mid-edit.
 */
export const volunteerProfileUpdateLimiter = new RateLimiter(60000, 10);

export const volunteerDispatchRespondLimiter = new RateLimiter(60000, 10);
