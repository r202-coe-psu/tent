import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authorizeUserWrite, serviceError, ServiceError } from '$lib/server/couch-admin';
import { resetUserPasswordByAdmin } from '$lib/server/user-service';

export const prerender = false;

/** POST { name } — Admin resets a user password to a memorable temporary passphrase */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const caller = await authorizeUserWrite(request.headers.get('cookie'));
		const body = (await request.json().catch(() => ({}))) as { name?: unknown };
		const name = typeof body.name === 'string' ? body.name.trim() : '';

		if (!name) {
			throw new ServiceError('VALIDATION', 'name is required');
		}

		const result = await resetUserPasswordByAdmin(name, caller);
		return json({ ok: true, temporary_password: result.temporary_password });
	} catch (e) {
		return serviceError(e);
	}
};
