import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminRaw, serviceError, ServiceError } from '$lib/server/couch-admin';
import { getSession } from '$lib/db/couch';

export const prerender = false;

/** GET — Retrieve currently logged-in user profile status (security setup & roles) */
export const GET: RequestHandler = async ({ fetch }) => {
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
			const doc = res.data as Record<string, unknown>;
			return json({
				name: session.name,
				display_name: (doc.display_name as string) ?? session.name,
				roles: (doc.roles as string[]) ?? session.roles,
				must_change_password: Boolean(doc.must_change_password),
				has_security_question: Boolean(
					(doc.security_question as Record<string, unknown> | undefined)?.answer_hash
				)
			});
		}

		// Fallback for bootstrap admin or docs not yet in _users
		return json({
			name: session.name,
			display_name: session.name,
			roles: session.roles,
			must_change_password: false,
			has_security_question: true
		});
	} catch (e) {
		return serviceError(e);
	}
};
