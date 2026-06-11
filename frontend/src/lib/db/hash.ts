/**
 * SHA-256 helpers. Used for the privacy-preserving hashes in the schema:
 * `donor.phone_hash`, `donation.tracking_token_hash`, and the public
 * `search_audit` query/IP hashes (docs/data/schema.md §2.3, §5.1).
 *
 * Async because Web Crypto's digest is async; callers compute the hash before
 * handing it to the (pure, sync) domain factories.
 */

/** Hex-encoded SHA-256 of a UTF-8 string. */
export async function sha256Hex(input: string): Promise<string> {
	const bytes = new TextEncoder().encode(input);
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
