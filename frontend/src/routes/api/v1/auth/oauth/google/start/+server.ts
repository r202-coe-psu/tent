import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serviceError, ServiceError } from '$lib/server/couch-admin';
import { getSession } from '$lib/db/couch';
import {
	buildGoogleAuthorizeUrl,
	createOAuthState,
	getGoogleOAuthConfig,
	resolveGoogleRedirectUri,
	setOAuthStateCookie,
	type GoogleOAuthMode
} from '$lib/server/google-oauth';

export const prerender = false;

function parseMode(raw: string | null): GoogleOAuthMode {
	if (raw === 'link' || raw === 'stepup' || raw === 'login') return raw;
	throw new ServiceError('VALIDATION', 'mode must be link, stepup, or login');
}

/** GET — Start Google OAuth (mode=link|stepup|login). link/stepup require AuthSession. */
export const GET: RequestHandler = async ({ url, fetch, cookies }) => {
	try {
		const mode = parseMode(url.searchParams.get('mode'));
		const { clientId } = getGoogleOAuthConfig();
		const redirectUri = resolveGoogleRedirectUri(url);

		let name = '';
		if (mode === 'link' || mode === 'stepup') {
			const session = await getSession(fetch);
			if (!session?.name) {
				throw new ServiceError('UNAUTHENTICATED', 'Not logged in');
			}
			name = session.name;
		}

		const state = createOAuthState(mode, name);
		setOAuthStateCookie(cookies, state);

		const authorizeUrl = buildGoogleAuthorizeUrl({
			clientId,
			redirectUri,
			state
		});
		throw redirect(302, authorizeUrl);
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e && (e as { status: number }).status === 302) {
			throw e;
		}
		return serviceError(e);
	}
};
