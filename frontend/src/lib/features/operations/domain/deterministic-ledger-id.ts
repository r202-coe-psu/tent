import { sha256Hex } from '$lib/db/hash';

const CROCKFORD_BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Converts workflow-owned immutable identity material into the schema-valid
 * StockLedger document ID used as the CouchDB put-if-absent gate.
 *
 * Callers own their namespace and key ordering so existing recovery identities
 * remain stable; this helper owns only the shared SHA-256/Crockford encoding.
 */
export async function deriveDeterministicLedgerId(
	namespace: string,
	scope: string,
	...keys: string[]
): Promise<string> {
	const hash = await sha256Hex([namespace, scope, ...keys].join(':'));
	const bytes = Array.from({ length: hash.length / 2 }, (_, index) =>
		Number.parseInt(hash.slice(index * 2, index * 2 + 2), 16)
	);
	let bits = 0;
	let value = 0;
	let suffix = '';

	for (const byte of bytes) {
		value = (value << 8) | byte;
		bits += 8;
		while (bits >= 5 && suffix.length < 26) {
			bits -= 5;
			suffix += CROCKFORD_BASE32[(value >>> bits) & 31];
		}
		if (suffix.length === 26) return `stock_ledger:${suffix}`;
	}

	throw new Error('Unable to derive deterministic stock ledger identity');
}
