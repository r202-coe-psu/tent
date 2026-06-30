import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ServiceError } from '$lib/server/couch-admin';
import { createUser } from '$lib/server/user-service';
import { validatePassword } from '$lib/server/password-policy';

// Public self-signup endpoint; never prerendered — runs on the Node server at runtime.
export const prerender = false;

export const POST: RequestHandler = async ({ request }) => {
	const { username, password } = (await request.json().catch(() => ({}))) as {
		username?: string;
		password?: string;
	};

	// Validate input server-side (mirrors registerSchema constraints).
	if (!username || username.length < 3) throw error(400, 'Username must be at least 3 characters');
	if (!password) throw error(400, 'Password is required');
	let validPassword: string;
	try {
		validPassword = validatePassword(password);
	} catch (e) {
		if (e instanceof ServiceError) throw error(400, e.message);
		throw e;
	}

	// Single admin-write path for _users — same module the /api/v1/users BFF uses.
	// Public self-signup gets no shelter role; an SA/SM assigns roles afterwards.
	// Map the service-layer error back to this endpoint's {message} contract.
	try {
		await createUser({
			name: username,
			password: validPassword,
			display_name: username,
			roles: []
		});
	} catch (e) {
		if (e instanceof ServiceError) throw error(e.code === 'CONFLICT' ? 409 : 500, e.message);
		throw e;
	}
	return json({ ok: true });
};
