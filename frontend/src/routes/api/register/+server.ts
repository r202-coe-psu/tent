import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminFetch, ServiceError } from '$lib/server/couch-admin';
import { createUser } from '$lib/server/user-service';

// Public self-signup endpoint; never prerendered — runs on the Node server at runtime.
export const prerender = false;

export const POST: RequestHandler = async ({ request }) => {
	const { username, password } = (await request.json().catch(() => ({}))) as {
		username?: string;
		password?: string;
	};

	// Validate input server-side (mirrors registerSchema constraints).
	if (!username || username.length < 3) throw error(400, 'Username must be at least 3 characters');
	if (!password || password.length < 6) throw error(400, 'Password must be at least 6 characters');

	// Single admin-write path for _users — same module the /api/v1/users BFF uses.
	// Public self-signup gets no shelter role; an SA/SM assigns roles afterwards.
	// Map the service-layer error back to this endpoint's {message} contract.
	try {
		await createUser({ name: username, password, roles: [] });
	} catch (e) {
		if (e instanceof ServiceError) throw error(e.code === 'CONFLICT' ? 409 : 500, e.message);
		throw e;
	}
	return json({ ok: true });
};
