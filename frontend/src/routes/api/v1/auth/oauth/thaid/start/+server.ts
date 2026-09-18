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

import { isThaidRegistrationEnabled } from '$lib/server/thaid-registration-gate';

export const prerender = false;

function parseMode(raw: string | null): ThaidOAuthMode {
	if (raw === 'link' || raw === 'stepup' || raw === 'login' || raw === 'register') return raw;
	throw new ServiceError('VALIDATION', 'mode must be link, stepup, login, or register');
}

/** GET — Start ThaID OAuth (mode=link|stepup|login|register). link/stepup require AuthSession. */
export const GET: RequestHandler = async ({ url, fetch, cookies }) => {
	try {
		const mode = parseMode(url.searchParams.get('mode'));
		const { clientId, authUrl } = getThaidOAuthConfig();
		const redirectUri = resolveThaidRedirectUri(url);

		let name = '';
		let returnTo: string | undefined;

		if (mode === 'link' || mode === 'stepup') {
			const session = await getSession(fetch);
			if (!session?.name) {
				throw new ServiceError('UNAUTHENTICATED', 'Not logged in');
			}
			name = session.name;
		} else if (mode === 'register') {
			const thaidStatus = await isThaidRegistrationEnabled();
			if (!thaidStatus.enabled) {
				throw redirect(302, '/pre-register?error=thaid_disabled');
			}
			const returnParam = url.searchParams.get('return_to');
			if (
				returnParam &&
				(returnParam === '/pre-register' || returnParam.startsWith('/pre-register?'))
			) {
				returnTo = returnParam;
			} else {
				returnTo = '/pre-register';
			}
		}

		const state = createThaidOAuthState(mode, name, returnTo);
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
