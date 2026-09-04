import { dev } from '$app/environment';

interface RateLimitEntry {
	timestamps: number[];
}

export class RateLimiter {
	private store = new Map<string, RateLimitEntry>();
	private windowMs: number;
	private maxRequests: number;

	constructor(windowMs: number = 60000, maxRequests: number = 3) {
		this.windowMs = windowMs;
		this.maxRequests = maxRequests;
	}

	/**
	 * Checks if the given key (IP or phone) has exceeded the rate limit.
	 * Returns true if allowed, false if blocked.
	 */
	check(key: string): boolean {
		if (!key) return true;
		if (
			dev &&
			(key === '127.0.0.1' || key === '::1' || key === 'localhost' || key === '::ffff:127.0.0.1')
		) {
			return true;
		}

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

// Singleton instances, one per surface rather than one shared budget.
//
// They were a single 3-per-minute limiter for every donation route, which meant one
// edit cost three: loading the ticket, saving, and the refetch after saving. CR-080
// settled that a donor may edit as often as they like, held only by the IP limit — so
// the limit has to leave room for editing at all.
//
// The numbers follow what each surface exposes:

/** Creating a booking. The abuse vector CR-005 set this at — deliberately tight. */
export const donationIpLimiter = new RateLimiter(60000, 3);
/** Same, per phone number, so one abuser cannot spread across IPs. */
export const donationPhoneLimiter = new RateLimiter(60000, 3);
/**
 * Changing a booking that already exists: edit, courier number, cancel.
 *
 * Reaching one requires the tracking token, which is 128 bits of unguessable, and the
 * blast radius is a single record the caller already owns. Ten a minute is generous for
 * a person and still caps a script.
 */
export const donationEditLimiter = new RateLimiter(60000, 10);
/**
 * Reading one's own ticket. Idempotent, token-gated, and the page refetches after every
 * change — counting it against the write budget is what made editing twice impossible.
 * Still limited, because each read reaches FastAPI and Mongo.
 */
export const donationReadLimiter = new RateLimiter(60000, 30);

// Public booking (CR-070 / T-71). Separate buckets from donations so a busy
// donation drive cannot lock a family out of booking a place to sleep.
// One household books once; 3/min per IP still allows correcting a typo.
export const registerIpLimiter = new RateLimiter(60000, 3);
export const registerPhoneLimiter = new RateLimiter(60000, 3);
// Lookup is a read but also an enumeration surface — hold it tighter.
export const registerLookupIpLimiter = new RateLimiter(60000, 10);

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
 * Editing your own profile from the portal. Tighter than the reads because it is a
 * write reached with a guessable credential, loose enough that someone correcting a
 * typo and re-picking their skills does not get locked out mid-edit.
 */
export const volunteerProfileUpdateLimiter = new RateLimiter(60000, 10);
