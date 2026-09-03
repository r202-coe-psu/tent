import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
export * from '$lib/auth/security-questions';

/**
 * Normalizes security answer: strips leading/trailing whitespace and converts to lowercase.
 */
export function normalizeSecurityAnswer(rawAnswer: string): string {
	return rawAnswer.trim().toLowerCase();
}

/**
 * Computes salted SHA-256 hash for a normalized security answer.
 */
export function hashSecurityAnswer(
	rawAnswer: string,
	existingSalt?: string
): {
	answer_hash: string;
	salt: string;
} {
	const normalized = normalizeSecurityAnswer(rawAnswer);
	const salt = existingSalt ?? randomBytes(16).toString('hex');
	const hash = createHash('sha256').update(`${salt}:${normalized}`).digest('hex');
	return { answer_hash: hash, salt };
}

/**
 * Verifies a raw security answer against a stored salt and answer_hash.
 */
export function verifySecurityAnswer(
	rawAnswer: string,
	salt: string,
	expectedHash: string
): boolean {
	if (!rawAnswer || !salt || !expectedHash) return false;
	const { answer_hash } = hashSecurityAnswer(rawAnswer, salt);
	try {
		const a = Buffer.from(answer_hash, 'hex');
		const b = Buffer.from(expectedHash, 'hex');
		return a.length === b.length && timingSafeEqual(a, b);
	} catch {
		return false;
	}
}
