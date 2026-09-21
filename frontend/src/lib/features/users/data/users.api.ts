/**
 * User-management data layer — talks to the central service plane `/api/v1/users`
 * (same-origin BFF in dev; a reverse proxy routes it to FastAPI in prod).
 */

import { serviceFetch } from '$lib/api/service';
import type { ForgotPasswordVerifyInput, ForceSetupInput } from '../domain/schema';

const USERS_ENDPOINT = '/api/v1/users';
const RESET_PASSWORD_ENDPOINT = '/api/v1/users/reset-password';
const FORGOT_PASSWORD_ENDPOINT = '/api/v1/auth/forgot-password';
const FORCE_SETUP_ENDPOINT = '/api/v1/auth/force-setup';

export interface UserSummary {
	name: string;
	roles: string[];
	display_name?: string | null;
	shelter_id?: string | null;
	personnel_type?: 'staff' | 'volunteer';
	organization?: string | null;
	position?: string | null;
	phone?: string | null;
	email?: string | null;
	notes?: string | null;
	volunteer_id?: string | null;
	duty_window?: {
		start_ts: string;
		end_ts: string;
	} | null;
	active?: boolean;
	must_change_password?: boolean;
	has_security_question?: boolean;
	affiliation_tags?: string[];
	/** True when at least one MFA provider (Google or ThaID) is enrolled. */
	mfa_enrolled?: boolean;
	/** CR-124 — linked Google email (display). */
	mfa_google_email?: string | null;
	/** CR-ThaID — linked ThaID name (display). */
	mfa_thaid_name?: string | null;
	/** CR-ThaID — linked ThaID masked PID (display). */
	mfa_thaid_pid_masked?: string | null;
}

export function listUsers(): Promise<UserSummary[]> {
	return serviceFetch<UserSummary[]>(USERS_ENDPOINT);
}

export function createUser(input: {
	name: string;
	password: string;
	display_name: string;
	roles: string[];
	personnel_type?: 'staff' | 'volunteer';
	organization?: string | null;
	position?: string | null;
	phone?: string | null;
	email?: string | null;
	notes?: string | null;
	volunteer_id?: string | null;
	duty_window?: {
		start_ts: string;
		end_ts: string;
	} | null;
	must_change_password?: boolean;
	affiliation_tags?: string[];
}): Promise<{ ok: true; merged?: boolean }> {
	return serviceFetch(USERS_ENDPOINT, { method: 'POST', body: JSON.stringify(input) });
}

export function deleteUser(name: string): Promise<{ ok: true }> {
	return serviceFetch(`${USERS_ENDPOINT}?name=${encodeURIComponent(name)}`, { method: 'DELETE' });
}

export function updateUser(
	name: string,
	input: {
		password?: string;
		display_name?: string;
		roles?: string[];
		personnel_type?: 'staff' | 'volunteer';
		organization?: string | null;
		position?: string | null;
		phone?: string | null;
		email?: string | null;
		notes?: string | null;
		volunteer_id?: string | null;
		duty_window?: {
			start_ts: string;
			end_ts: string;
		} | null;
		active?: boolean;
		must_change_password?: boolean;
		affiliation_tags?: string[];
	}
): Promise<{ ok: true }> {
	return serviceFetch(USERS_ENDPOINT, {
		method: 'PUT',
		body: JSON.stringify({ name, ...input })
	});
}

/** Admin triggers reset of user password to a memorable temporary passphrase */
export function adminResetPassword(
	name: string
): Promise<{ ok: true; temporary_password: string }> {
	return serviceFetch<{ ok: true; temporary_password: string }>(RESET_PASSWORD_ENDPOINT, {
		method: 'POST',
		body: JSON.stringify({ name })
	});
}

/** Retrieve security question challenge */
export function getSecurityQuestionChallenge(phone: string): Promise<{
	ok: boolean;
	found: boolean;
	question_id?: string;
	question_label?: string;
}> {
	return serviceFetch(`${FORGOT_PASSWORD_ENDPOINT}?phone=${encodeURIComponent(phone.trim())}`);
}

/** Submit answer to security question and reset password (Self-Service) */
export function verifySecurityQuestionAndReset(
	input: ForgotPasswordVerifyInput
): Promise<{ ok: true }> {
	return serviceFetch(FORGOT_PASSWORD_ENDPOINT, {
		method: 'POST',
		body: JSON.stringify(input)
	});
}

export interface AuthStatus {
	name: string;
	display_name: string;
	roles: string[];
	must_change_password: boolean;
	has_security_question: boolean;
	/** True when at least one MFA provider is enrolled. */
	mfa_enrolled: boolean;
	/** Enrolled and no valid session `mfa_ok` cookie. */
	pending_mfa: boolean;
	mfa_providers?: Array<'google' | 'thaid'>;
	mfa_provider_email?: string | null;
	mfa_thaid_name?: string | null;
	mfa_thaid_pid_masked?: string | null;
	phone?: string | null;
	email?: string | null;
	organization?: string | null;
	position?: string | null;
	personnel_type?: 'staff' | 'volunteer' | null;
}

export interface OwnProfileUpdateInput {
	display_name?: string;
	phone?: string | null;
	email?: string | null;
	organization?: string | null;
	position?: string | null;
}

export interface OwnProfileUpdateResult {
	ok: true;
	name: string;
	display_name: string;
	phone: string | null;
	email: string | null;
	organization: string | null;
	position: string | null;
	personnel_type: 'staff' | 'volunteer' | null;
	roles: string[];
}

/** Complete first-time or forced security setup */
export function submitForceSetup(input: ForceSetupInput): Promise<{ ok: true }> {
	return serviceFetch(FORCE_SETUP_ENDPOINT, {
		method: 'POST',
		body: JSON.stringify(input)
	});
}

/** Check security setup status of currently authenticated user */
export function fetchAuthStatus(): Promise<AuthStatus> {
	return serviceFetch<AuthStatus>('/api/v1/auth/me');
}

/** Self-service PATCH for soft profile fields on `/api/v1/auth/me`. */
export function updateOwnProfile(input: OwnProfileUpdateInput): Promise<OwnProfileUpdateResult> {
	return serviceFetch<OwnProfileUpdateResult>('/api/v1/auth/me', {
		method: 'PATCH',
		body: JSON.stringify(input)
	});
}

/** Clear BFF `mfa_ok` cookie (after password login / logout). */
export function clearMfaOk(): Promise<{ ok: true }> {
	return serviceFetch('/api/v1/auth/mfa/clear', { method: 'POST', body: '{}' });
}

/** Skip BFF MFA challenge for the current session (sets `mfa_ok` cookie). */
export function skipMfa(): Promise<{ ok: true }> {
	return serviceFetch('/api/v1/auth/mfa/skip', { method: 'POST', body: '{}' });
}

/**
 * Unlink Google MFA. Omit `name` for self-unlink; pass `name` for admin/manager.
 */
export function unlinkGoogleMfa(name?: string): Promise<{ ok: true }> {
	return serviceFetch('/api/v1/auth/oauth/google/unlink', {
		method: 'POST',
		body: JSON.stringify(name ? { name } : {})
	});
}

/** Browser navigation target for Google OAuth start (BFF redirects to Google). */
export function googleOAuthStartHref(mode: 'link' | 'stepup' | 'login'): string {
	return `/api/v1/auth/oauth/google/start?mode=${mode}`;
}

/**
 * Unlink ThaID MFA. Omit `name` for self-unlink; pass `name` for admin/manager.
 */
export function unlinkThaidMfa(name?: string): Promise<{ ok: true }> {
	return serviceFetch('/api/v1/auth/oauth/thaid/unlink', {
		method: 'POST',
		body: JSON.stringify(name ? { name } : {})
	});
}

/** Browser navigation target for ThaID OAuth start (BFF redirects to ThaID). */
export function thaidOAuthStartHref(mode: 'link' | 'stepup' | 'login'): string {
	return `/api/v1/auth/oauth/thaid/start?mode=${mode}`;
}
