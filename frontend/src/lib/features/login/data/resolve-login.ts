/** Thai mobile shape used as an alternate login identifier. */
const PHONE_LOGIN_RE = /^0\d{9}$/;

/**
 * Resolve a login identifier to CouchDB `name` when it looks like a phone.
 * Non-phone usernames pass through without a network call.
 */
export async function resolveLoginIdentifier(identifier: string): Promise<string> {
	const trimmed = identifier.trim();
	if (!PHONE_LOGIN_RE.test(trimmed)) return trimmed;

	try {
		const res = await fetch('/api/v1/auth/resolve-login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ identifier: trimmed })
		});
		if (!res.ok) return trimmed;
		const data = (await res.json()) as { name?: unknown };
		return typeof data.name === 'string' && data.name.trim().length > 0 ? data.name.trim() : trimmed;
	} catch {
		return trimmed;
	}
}
