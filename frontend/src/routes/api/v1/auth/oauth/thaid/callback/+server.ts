import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminRaw, serviceError, ServiceError } from '$lib/server/couch-admin';
import { getSession } from '$lib/db/couch';
import {
	clearThaidOAuthStateCookie,
	exchangeThaidCode,
	getThaidOAuthConfig,
	OAUTH_THAID_STATE_COOKIE,
	parseThaidCitizenClaims,
	parseThaidOAuthState,
	resolveThaidLoginUser,
	resolveThaidRedirectUri,
	setCitizenClaimCookie
} from '$lib/server/thaid-oauth';
import { completeKioskSession, completeScanSession } from '$lib/server/thaid-scan-session';
import {
	fetchCouchAuthHashAlgorithm,
	fetchCouchAuthSecret,
	mintAuthSessionCookie,
	setAuthSessionCookie,
	setMfaOkCookie
} from '$lib/server/google-oauth';
import {
	findUserByThaidSubject,
	getThaidMfa,
	linkThaidMfa,
	touchThaidMfaVerified,
	type CouchUserDoc
} from '$lib/server/user-service';
import { setPendingLinkCookie } from '$lib/server/pending-link';

export const prerender = false;

function isRedirect(e: unknown): boolean {
	return Boolean(
		e && typeof e === 'object' && 'status' in e && (e as { status: number }).status === 302
	);
}

function sanitizeRegisterReturnTo(raw?: string): string {
	if (raw && (raw === '/pre-register' || raw.startsWith('/pre-register?'))) {
		return raw;
	}
	return '/pre-register';
}

function loginErrorRedirect(code: string): never {
	throw redirect(302, `/login?error=${encodeURIComponent(code)}`);
}

function mfaErrorRedirect(code: string): never {
	throw redirect(302, `/mfa-challenge?error=${encodeURIComponent(code)}`);
}

function registerErrorRedirect(code: string, returnTo?: string): never {
	const base = sanitizeRegisterReturnTo(returnTo);
	const sep = base.includes('?') ? '&' : '?';
	throw redirect(302, `${base}${sep}error=${encodeURIComponent(code)}`);
}

function memberScanErrorRedirect(code: string): never {
	throw redirect(302, `/thaid-scan-success?error=${encodeURIComponent(code)}`);
}

function kioskErrorRedirect(code: string): never {
	throw redirect(302, `/thaid-scan-success?flow=kiosk&error=${encodeURIComponent(code)}`);
}

/** GET — ThaID OAuth callback: register, link, step-up, enrolled login mint, member scan, or kiosk check-in. */
export const GET: RequestHandler = async ({ url, fetch, cookies }) => {
	const cookieState = cookies.get(OAUTH_THAID_STATE_COOKIE);
	const earlyState = parseThaidOAuthState(cookieState);
	const paramState = parseThaidOAuthState(url.searchParams.get('state') ?? undefined);

	const detectedMode = earlyState?.mode ?? paramState?.mode;
	const detectedReturnTo = earlyState?.returnTo ?? paramState?.returnTo;
	const isRegisterMode = detectedMode === 'register';
	const isLoginMode = detectedMode === 'login';
	const isMemberScanMode = detectedMode === 'member_scan';
	const isKioskCheckInMode = detectedMode === 'kiosk_check_in';

	function dispatchErrorRedirect(code: string): never {
		if (isRegisterMode) {
			registerErrorRedirect(code, detectedReturnTo);
		}
		if (isLoginMode) {
			loginErrorRedirect(code);
		}
		if (isMemberScanMode) {
			memberScanErrorRedirect(code);
		}
		if (isKioskCheckInMode) {
			kioskErrorRedirect(code);
		}
		mfaErrorRedirect(code);
	}

	try {
		const errorParam = url.searchParams.get('error');
		if (errorParam) {
			clearThaidOAuthStateCookie(cookies);
			dispatchErrorRedirect(`oauth_${errorParam}`);
		}

		const code = url.searchParams.get('code');
		const stateParam = url.searchParams.get('state');
		clearThaidOAuthStateCookie(cookies);

		if (!code || !stateParam || stateParam !== cookieState) {
			dispatchErrorRedirect('invalid_state');
		}

		const state = parseThaidOAuthState(stateParam);
		if (!state) {
			dispatchErrorRedirect('invalid_state');
		}

		const { clientId, clientSecret, tokenUrl, userinfoUrl } = getThaidOAuthConfig();
		const redirectUri = resolveThaidRedirectUri(url);
		const claims = await exchangeThaidCode({
			code,
			redirectUri,
			clientId,
			clientSecret,
			tokenUrl,
			userinfoUrl
		});

		if (state.mode === 'register') {
			const profile = parseThaidCitizenClaims(claims);
			setCitizenClaimCookie(cookies, profile);
			const base = sanitizeRegisterReturnTo(state.returnTo);
			const sep = base.includes('?') ? '&' : '?';
			throw redirect(302, `${base}${sep}thaid=autofill`);
		}

		if (state.mode === 'member_scan') {
			if (!state.sessionId) {
				memberScanErrorRedirect('missing_session');
			}
			const profile = parseThaidCitizenClaims(claims);
			const completed = completeScanSession(state.sessionId, profile);
			if (!completed) {
				memberScanErrorRedirect('session_expired');
			}
			throw redirect(302, '/thaid-scan-success?status=success');
		}

		if (state.mode === 'kiosk_check_in') {
			if (!state.sessionId) {
				kioskErrorRedirect('missing_session');
			}
			// Digits only (ThaiD may format the id); the session stores the bare 13 digits.
			const pid = (claims.pid ?? '').replace(/\D/g, '');
			if (!/^\d{13}$/.test(pid)) kioskErrorRedirect('missing_pid');
			const completed = completeKioskSession(state.sessionId, { pid, sub: claims.sub });
			if (!completed) kioskErrorRedirect('session_expired');
			throw redirect(302, '/thaid-scan-success?flow=kiosk&status=success');
		}

		if (state.mode === 'login') {
			const user = await findUserByThaidSubject(claims.sub);
			const resolved = resolveThaidLoginUser(user);
			if (!resolved.ok) {
				if (resolved.reason === 'missing_salt') loginErrorRedirect('thaid_login_failed');
				// CR-141 — not linked yet: offer link-on-first-login instead of an error.
				setPendingLinkCookie(cookies, {
					provider: 'thaid',
					sub: claims.sub,
					name: claims.name ?? null,
					pid_masked: claims.pid_masked ?? null
				});
				throw redirect(302, '/login/link');
			}

			const [secret, algo] = await Promise.all([
				fetchCouchAuthSecret(),
				fetchCouchAuthHashAlgorithm()
			]);
			const cookieValue = mintAuthSessionCookie(resolved.name, resolved.salt, secret, algo);
			setAuthSessionCookie(cookies, cookieValue);
			setMfaOkCookie(cookies, resolved.name);
			try {
				await touchThaidMfaVerified(resolved.name);
			} catch {
				// Non-fatal — session + mfa_ok already set
			}
			throw redirect(302, '/portal');
		}

		const session = await getSession(fetch);
		if (!session?.name || state.name !== session.name) {
			mfaErrorRedirect('invalid_state');
		}

		if (state.mode === 'link') {
			try {
				await linkThaidMfa(session.name, {
					subject: claims.sub,
					name: claims.name,
					pid_masked: claims.pid_masked
				});
			} catch (e) {
				if (e instanceof ServiceError && e.code === 'CONFLICT') {
					throw redirect(302, '/me?mfa=thaid_conflict');
				}
				throw e;
			}
			setMfaOkCookie(cookies, session.name);
			throw redirect(302, '/me?mfa=thaid_linked');
		}

		// stepup — subject must match linked ThaID
		const res = await adminRaw(
			`/_users/org.couchdb.user:${encodeURIComponent(session.name)}`,
			'GET'
		);
		if (res.status !== 200) {
			mfaErrorRedirect('not_enrolled');
		}
		const doc = res.data as CouchUserDoc;
		const thaid = getThaidMfa(doc);
		if (!thaid) {
			throw redirect(302, '/portal');
		}
		if (thaid.subject !== claims.sub) {
			mfaErrorRedirect('thaid_mismatch');
		}

		await touchThaidMfaVerified(session.name);
		setMfaOkCookie(cookies, session.name);
		throw redirect(302, '/portal');
	} catch (e) {
		if (isRedirect(e)) throw e;
		if (isRegisterMode) {
			registerErrorRedirect('oauth_exchange_failed', detectedReturnTo);
		}
		if (isMemberScanMode) {
			memberScanErrorRedirect('oauth_exchange_failed');
		}
		if (isKioskCheckInMode) {
			kioskErrorRedirect('oauth_exchange_failed');
		}
		return serviceError(e);
	}
};
