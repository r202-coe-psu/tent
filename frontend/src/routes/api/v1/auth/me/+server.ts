import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	adminRaw,
	isProtectedBootstrapAdmin,
	serviceError,
	ServiceError
} from '$lib/server/couch-admin';
import { getSession } from '$lib/db/couch';
import { computeMfaFlags, verifyMfaOkCookie, MFA_OK_COOKIE } from '$lib/server/google-oauth';
import {
	getGoogleMfa,
	getThaidMfa,
	updateOwnProfile,
	type CouchUserDoc,
	type OwnProfileFields
} from '$lib/server/user-service';

export const prerender = false;

interface MfaDetails {
	mfaProviderEmail: string | null;
	mfaProviders: ('google' | 'thaid')[];
	mfaThaidName: string | null;
	mfaThaidPidMasked: string | null;
}

function profilePayload(
	name: string,
	doc: CouchUserDoc | null,
	roles: string[],
	mfa: { mfa_enrolled: boolean; pending_mfa: boolean },
	details: MfaDetails
) {
	const isBootstrap = isProtectedBootstrapAdmin({ name, roles });
	return {
		name,
		display_name: doc?.display_name ?? name,
		roles: doc?.roles ?? roles,
		must_change_password: isBootstrap ? false : Boolean(doc?.must_change_password),
		has_security_question: isBootstrap ? true : Boolean(doc?.security_question?.answer_hash),
		mfa_enrolled: mfa.mfa_enrolled,
		pending_mfa: mfa.pending_mfa,
		mfa_providers: details.mfaProviders,
		mfa_provider_email: details.mfaProviderEmail,
		mfa_thaid_name: details.mfaThaidName,
		mfa_thaid_pid_masked: details.mfaThaidPidMasked,
		phone: doc?.phone ?? null,
		email: doc?.email ?? null,
		organization: doc?.organization ?? null,
		position: doc?.position ?? null,
		personnel_type: doc?.personnel_type ?? null
	};
}

/** GET — Retrieve currently logged-in user profile status (security setup, MFA & roles) */
export const GET: RequestHandler = async ({ fetch, cookies }) => {
	try {
		const session = await getSession(fetch);
		if (!session?.name) {
			throw new ServiceError('UNAUTHENTICATED', 'Not logged in');
		}

		const res = await adminRaw(
			`/_users/org.couchdb.user:${encodeURIComponent(session.name)}`,
			'GET'
		);

		if (res.status === 200) {
			const doc = res.data as CouchUserDoc;
			const google = getGoogleMfa(doc);
			const thaid = getThaidMfa(doc);
			const enrolled = Boolean(google || thaid);
			const mfaOkValid = verifyMfaOkCookie(cookies.get(MFA_OK_COOKIE), session.name);
			const mfa = computeMfaFlags({ enrolled, mfaOkValid });

			const mfaProviders: ('google' | 'thaid')[] = [];
			if (google) mfaProviders.push('google');
			if (thaid) mfaProviders.push('thaid');

			return json(
				profilePayload(session.name, doc, session.roles, mfa, {
					mfaProviderEmail: google?.email ?? null,
					mfaProviders,
					mfaThaidName: thaid?.name ?? null,
					mfaThaidPidMasked: thaid?.pid_masked ?? null
				})
			);
		}

		// Fallback for bootstrap admin or docs not yet in _users — not MFA-enrolled
		return json(
			profilePayload(
				session.name,
				null,
				session.roles,
				{ mfa_enrolled: false, pending_mfa: false },
				{
					mfaProviderEmail: null,
					mfaProviders: [],
					mfaThaidName: null,
					mfaThaidPidMasked: null
				}
			)
		);
	} catch (e) {
		return serviceError(e);
	}
};

/** PATCH — Self-edit soft profile fields on the session user's `_users` doc only */
export const PATCH: RequestHandler = async ({ request, fetch }) => {
	try {
		const session = await getSession(fetch);
		if (!session?.name) {
			throw new ServiceError('UNAUTHENTICATED', 'Not logged in');
		}

		if (isProtectedBootstrapAdmin({ name: session.name, roles: session.roles })) {
			throw new ServiceError('FORBIDDEN', 'Cannot modify the bootstrap admin user');
		}

		const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
		if (!body || typeof body !== 'object' || Array.isArray(body)) {
			throw new ServiceError('VALIDATION', 'Request body must be a JSON object');
		}

		const summary = await updateOwnProfile(
			session.name,
			body as OwnProfileFields & Record<string, unknown>
		);

		return json({
			ok: true as const,
			name: summary.name,
			display_name: summary.display_name ?? summary.name,
			phone: summary.phone ?? null,
			email: summary.email ?? null,
			organization: summary.organization ?? null,
			position: summary.position ?? null,
			personnel_type: summary.personnel_type ?? null,
			roles: summary.roles
		});
	} catch (e) {
		return serviceError(e);
	}
};
