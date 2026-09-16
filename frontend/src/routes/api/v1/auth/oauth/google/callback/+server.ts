import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminRaw, serviceError, ServiceError } from '$lib/server/couch-admin';
import { getSession } from '$lib/db/couch';
import {
	clearOAuthStateCookie,
	exchangeGoogleCode,
	fetchCouchAuthHashAlgorithm,
	fetchCouchAuthSecret,
	getGoogleOAuthConfig,
	mintAuthSessionCookie,
	OAUTH_STATE_COOKIE,
	parseOAuthState,
	resolveGoogleLoginUser,
	resolveGoogleRedirectUri,
	setAuthSessionCookie,
	setMfaOkCookie
} from '$lib/server/google-oauth';
import {
	findUserByGoogleSubject,
	getGoogleMfa,
	linkGoogleMfa,
	touchGoogleMfaVerified,
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

/** GET — Google OAuth callback: link, step-up, or enrolled login mint. */
export const GET: RequestHandler = async ({ url, fetch, cookies }) => {
	try {
		const cookieState = cookies.get(OAUTH_STATE_COOKIE);
		const earlyState = parseOAuthState(cookieState);
		const isLoginMode = earlyState?.mode === 'login';

		const errorParam = url.searchParams.get('error');
		if (errorParam) {
			clearOAuthStateCookie(cookies);
			if (isLoginMode) {
				loginErrorRedirect(`oauth_${errorParam}`);
			}
			mfaErrorRedirect(`oauth_${errorParam}`);
		}

		const code = url.searchParams.get('code');
		const stateParam = url.searchParams.get('state');
		clearOAuthStateCookie(cookies);

		if (!code || !stateParam || stateParam !== cookieState) {
			if (isLoginMode) loginErrorRedirect('invalid_state');
			mfaErrorRedirect('invalid_state');
		}

		const state = parseOAuthState(stateParam);
		if (!state) {
			if (isLoginMode) loginErrorRedirect('invalid_state');
			mfaErrorRedirect('invalid_state');
		}

		const { clientId, clientSecret } = getGoogleOAuthConfig();
		const redirectUri = resolveGoogleRedirectUri(url);
		const claims = await exchangeGoogleCode({
			code,
			redirectUri,
			clientId,
			clientSecret
		});

		if (state.mode === 'login') {
			const user = await findUserByGoogleSubject(claims.sub);
			const resolved = resolveGoogleLoginUser(user);
			if (!resolved.ok) {
				loginErrorRedirect(
					resolved.reason === 'missing_salt' ? 'google_login_failed' : 'google_not_linked'
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
				await touchGoogleMfaVerified(resolved.name);
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
				await linkGoogleMfa(session.name, {
					subject: claims.sub,
					email: claims.email ?? null
				});
			} catch (e) {
				if (e instanceof ServiceError && e.code === 'CONFLICT') {
					throw redirect(302, '/me?mfa=conflict');
				}
				throw e;
			}
			setMfaOkCookie(cookies, session.name);
			throw redirect(302, '/me?mfa=linked');
		}

		// stepup — subject must match linked Google
		const res = await adminRaw(
			`/_users/org.couchdb.user:${encodeURIComponent(session.name)}`,
			'GET'
		);
		if (res.status !== 200) {
			mfaErrorRedirect('not_enrolled');
		}
		const doc = res.data as CouchUserDoc;
		const google = getGoogleMfa(doc);
		if (!google) {
			throw redirect(302, '/portal');
		}
		if (google.subject !== claims.sub) {
			mfaErrorRedirect('mismatch');
		}

		await touchGoogleMfaVerified(session.name);
		setMfaOkCookie(cookies, session.name);
		throw redirect(302, '/portal');
	} catch (e) {
		if (isRedirect(e)) throw e;
		return serviceError(e);
	}
};
