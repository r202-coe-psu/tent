/**
 * Server-side password policy. The rules and their Thai wording live in
 * `$lib/auth/password-schema` (`PASSWORD_RULES`), shared with the forms.
 *
 * Rules (per พี่โบ๊ท):
 * - At least 10 characters (after trim)
 * - At least one uppercase letter (A-Z)
 * - At least one lowercase letter (a-z)
 * - At least one digit (0-9)
 * - At least one special character (!@#$%^&*…)
 */

import { passwordPolicyError } from '$lib/auth/password-schema';
import { ServiceError } from '$lib/server/couch-admin';

/**
 * Validate a password against the policy and throw a `ServiceError('VALIDATION', …)`
 * if it fails. The password is trimmed before checking.
 *
 * @returns The trimmed password (safe to store).
 */
export function validatePassword(raw: string): string {
	// Thai, from the same rules the forms show, so the toast is readable (#1045). It trims.
	const error = passwordPolicyError(raw);
	if (error) throw new ServiceError('VALIDATION', error);
	return raw.trim();
}

/**
 * Validate a newly provisioned account. A volunteer may use their phone as a
 * one-time bootstrap password only when the caller also forces first-login
 * password setup; all other passwords must satisfy the normal policy.
 */
export function validateProvisionedPassword(
	raw: string,
	options: {
		phone?: string | null;
		personnelType?: 'staff' | 'volunteer';
		mustChangePassword?: boolean;
	} = {}
): string {
	const password = raw.trim();
	const phone = options.phone?.trim() ?? '';
	if (
		options.personnelType === 'volunteer' &&
		options.mustChangePassword === true &&
		/^0\d{9}$/.test(phone) &&
		password === phone
	) {
		return password;
	}
	return validatePassword(password);
}
