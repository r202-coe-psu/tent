/**
 * Server-side password policy — single source of truth.
 *
 * Rules (per พี่โบ๊ท):
 * - At least 10 characters (after trim)
 * - At least one uppercase letter (A-Z)
 * - At least one lowercase letter (a-z)
 * - At least one digit (0-9)
 * - At least one special character (!@#$%^&*…)
 */

import { ServiceError } from '$lib/server/couch-admin';

const MIN_LENGTH = 10;
const HAS_UPPERCASE = /[A-Z]/;
const HAS_LOWERCASE = /[a-z]/;
const HAS_DIGIT = /[0-9]/;
const HAS_SPECIAL = /[^A-Za-z0-9]/;

/**
 * Validate a password against the policy and throw a `ServiceError('VALIDATION', …)`
 * if it fails. The password is trimmed before checking.
 *
 * @returns The trimmed password (safe to store).
 */
export function validatePassword(raw: string): string {
	const password = raw.trim();

	const failures: string[] = [];
	if (password.length < MIN_LENGTH) failures.push(`at least ${MIN_LENGTH} characters`);
	if (!HAS_UPPERCASE.test(password)) failures.push('at least one uppercase letter (A-Z)');
	if (!HAS_LOWERCASE.test(password)) failures.push('at least one lowercase letter (a-z)');
	if (!HAS_DIGIT.test(password)) failures.push('at least one digit (0-9)');
	if (!HAS_SPECIAL.test(password)) failures.push('at least one special character');

	if (failures.length > 0) {
		throw new ServiceError(
			'VALIDATION',
			`Password must contain: ${failures.join(', ')}`
		);
	}

	return password;
}
