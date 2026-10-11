import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serviceError, ServiceError } from '$lib/server/couch-admin';
import { getSession } from '$lib/db/couch';
import {
	buildThaidAuthorizeUrl,
	createThaidOAuthState,
	getThaidOAuthConfig,
	resolveThaidRedirectUri,
	setThaidOAuthStateCookie,
	type ThaidOAuthMode
} from '$lib/server/thaid-oauth';

import { isKioskThaidCheckInAllowed } from '$lib/features/kiosk/server';
import { getScanSession } from '$lib/server/thaid-scan-session';
import { isThaidRegistrationEnabled } from '$lib/server/thaid-registration-gate';

export const prerender = false;

function parseMode(raw: string | null): ThaidOAuthMode {
	if (
		raw === 'link' ||
		raw === 'stepup' ||
		raw === 'login' ||
		raw === 'register' ||
		raw === 'member_scan' ||
		raw === 'kiosk_check_in'
	) {
		return raw;
	}
	throw new ServiceError(
		'VALIDATION',
		'mode must be link, stepup, login, register, member_scan, or kiosk_check_in'
	);
}

function kioskErrorUrl(code: string): string {
	return `/thaid-scan-success?flow=kiosk&error=${encodeURIComponent(code)}`;
}

/** Returns the session id when a pending kiosk session may start OAuth; otherwise throws the error redirect. */
async function requireStartableKioskSession(rawSessionId: string | null): Promise<string> {
	const sessionId = rawSessionId?.trim();
	if (!sessionId) throw redirect(302, kioskErrorUrl('missing_session'));

	const session = getScanSession(sessionId);
	if (!session || session.kind !== 'kiosk_check_in' || session.status !== 'pending') {
		throw redirect(302, kioskErrorUrl('session_expired'));
	}
	if (!(await isKioskThaidCheckInAllowed(session.binding?.shelter_code ?? ''))) {
		throw redirect(302, kioskErrorUrl('thaid_disabled'));
	}
	return sessionId;
}

/** GET — Start ThaID OAuth (mode=link|stepup|login|register|member_scan|kiosk_check_in). link/stepup require AuthSession. */
export const GET: RequestHandler = async ({ url, fetch, cookies }) => {
	try {
		const mode = parseMode(url.searchParams.get('mode'));

		// Operator kill-switch: hide/block new ThaiD entry points (not MFA step-up).
		// Run before getThaidOAuthConfig so disabled still redirects cleanly when keys are missing.
		if (
			mode === 'login' ||
			mode === 'link' ||
			mode === 'register' ||
			mode === 'member_scan' ||
			mode === 'kiosk_check_in'
		) {
			const thaidStatus = await isThaidRegistrationEnabled();
			if (!thaidStatus.enabled) {
				if (mode === 'login') throw redirect(302, '/login?error=thaid_disabled');
				if (mode === 'link') throw redirect(302, '/me?mfa=thaid_disabled');
				if (mode === 'register') throw redirect(302, '/pre-register?error=thaid_disabled');
				if (mode === 'kiosk_check_in') throw redirect(302, kioskErrorUrl('thaid_disabled'));
				throw redirect(302, '/thaid-scan-success?error=thaid_disabled');
			}
		}

		// FR-KTD-17: validate the kiosk session + shelter gate before bouncing to DOPA.
		// Runs before getThaidOAuthConfig so errors redirect cleanly when keys are missing.
		let kioskSessionId: string | undefined;
		if (mode === 'kiosk_check_in') {
			kioskSessionId = await requireStartableKioskSession(url.searchParams.get('session_id'));
		}

		const { clientId, authUrl } = getThaidOAuthConfig();
		const redirectUri = resolveThaidRedirectUri(url);

		let name = '';
		let returnTo: string | undefined;
		let sessionId: string | undefined = kioskSessionId;

		if (mode === 'link' || mode === 'stepup') {
			const session = await getSession(fetch);
			if (!session?.name) {
				throw new ServiceError('UNAUTHENTICATED', 'Not logged in');
			}
			name = session.name;
		} else if (mode === 'register') {
			const returnParam = url.searchParams.get('return_to');
			if (
				returnParam &&
				(returnParam === '/pre-register' || returnParam.startsWith('/pre-register?'))
			) {
				returnTo = returnParam;
			} else {
				returnTo = '/pre-register';
			}
		} else if (mode === 'member_scan') {
			const sidParam = url.searchParams.get('session_id')?.trim();
			if (!sidParam) {
				throw new ServiceError('VALIDATION', 'Missing session_id for member_scan');
			}
			sessionId = sidParam;
		}

		const state = createThaidOAuthState(mode, name, returnTo, sessionId);
		setThaidOAuthStateCookie(cookies, state);

		const authorizeUrl = buildThaidAuthorizeUrl({
			clientId,
			redirectUri,
			state,
			authUrl,
			mode
		});
		throw redirect(302, authorizeUrl);
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e && (e as { status: number }).status === 302) {
			throw e;
		}
		return serviceError(e);
	}
};
