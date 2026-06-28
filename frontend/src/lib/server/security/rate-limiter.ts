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

// Singleton instances for specific limits
export const donationIpLimiter = new RateLimiter(60000, 3);
export const donationPhoneLimiter = new RateLimiter(60000, 3);
