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
import { completeScanSession } from '$lib/server/thaid-scan-session';
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

/** GET — ThaID OAuth callback: register, link, step-up, or enrolled login mint. */
export const GET: RequestHandler = async ({ url, fetch, cookies }) => {
	const cookieState = cookies.get(OAUTH_THAID_STATE_COOKIE);
	const earlyState = parseThaidOAuthState(cookieState);
	const paramState = parseThaidOAuthState(url.searchParams.get('state') ?? undefined);

	const detectedMode = earlyState?.mode ?? paramState?.mode;
	const detectedReturnTo = earlyState?.returnTo ?? paramState?.returnTo;
	const isRegisterMode = detectedMode === 'register';
	const isLoginMode = detectedMode === 'login';
	const isMemberScanMode = detectedMode === 'member_scan';

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

		const { clientId, clientSecret, tokenUrl } = getThaidOAuthConfig();
		const redirectUri = resolveThaidRedirectUri(url);
		const claims = await exchangeThaidCode({
			code,
			redirectUri,
			clientId,
			clientSecret,
			tokenUrl
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

		if (state.mode === 'login') {
			const user = await findUserByThaidSubject(claims.sub);
			const resolved = resolveThaidLoginUser(user);
			if (!resolved.ok) {
				loginErrorRedirect(
					resolved.reason === 'missing_salt' ? 'thaid_login_failed' : 'thaid_not_linked'
				);
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
		return serviceError(e);
	}
};
