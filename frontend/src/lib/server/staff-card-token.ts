import { randomBytes } from 'node:crypto';
import { sha256Hex } from '$lib/db/hash';
import { STAFF_TOKEN_RANDOM_BYTES, formatStaffToken } from '$lib/features/users/server';

/** Mint a fresh staff card token and return only its hash; the plaintext is discarded. */
export async function mintStaffTokenHash(): Promise<string> {
	return sha256Hex(formatStaffToken(randomBytes(STAFF_TOKEN_RANDOM_BYTES)));
}
