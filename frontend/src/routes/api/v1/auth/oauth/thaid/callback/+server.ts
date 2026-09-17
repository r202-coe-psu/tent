import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminRaw, serviceError, ServiceError } from '$lib/server/couch-admin';
import { getSession } from '$lib/db/couch';
import {
	clearThaidOAuthStateCookie,
	exchangeThaidCode,
	getThaidOAuthConfig,
	OAUTH_THAID_STATE_COOKIE,
	parseThaidOAuthState,
	resolveThaidLoginUser,
	resolveThaidRedirectUri
} from '$lib/server/thaid-oauth';
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

function loginErrorRedirect(code: string): never {
	throw redirect(302, `/login?error=${encodeURIComponent(code)}`);
}

function mfaErrorRedirect(code: string): never {
	throw redirect(302, `/mfa-challenge?error=${encodeURIComponent(code)}`);
}

/** GET — ThaID OAuth callback: link, step-up, or enrolled login mint. */
export const GET: RequestHandler = async ({ url, fetch, cookies }) => {
	try {
		const cookieState = cookies.get(OAUTH_THAID_STATE_COOKIE);
		const earlyState = parseThaidOAuthState(cookieState);
		const isLoginMode = earlyState?.mode === 'login';

		const errorParam = url.searchParams.get('error');
		if (errorParam) {
			clearThaidOAuthStateCookie(cookies);
			if (isLoginMode) {
				loginErrorRedirect(`oauth_${errorParam}`);
			}
			mfaErrorRedirect(`oauth_${errorParam}`);
		}

		const code = url.searchParams.get('code');
		const stateParam = url.searchParams.get('state');
		clearThaidOAuthStateCookie(cookies);

		if (!code || !stateParam || stateParam !== cookieState) {
			if (isLoginMode) loginErrorRedirect('invalid_state');
			mfaErrorRedirect('invalid_state');
		}

		const state = parseThaidOAuthState(stateParam);
		if (!state) {
			if (isLoginMode) loginErrorRedirect('invalid_state');
			mfaErrorRedirect('invalid_state');
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
		return serviceError(e);
	}
};
