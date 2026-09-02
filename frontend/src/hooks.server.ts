import type { Handle, ServerInit } from '@sveltejs/kit';
import { ensureCentralDatabases } from '$lib/server/bootstrap-db';

let initialized = false;

/** SvelteKit ServerInit hook — runs once when server starts. */
export const init: ServerInit = async () => {
	await ensureCentralDatabases();
	initialized = true;
};

/** First-party pages may request GPS; public distance filter depends on it. */
export const handle: Handle = async ({ event, resolve }) => {
	if (!initialized) {
		await ensureCentralDatabases();
		initialized = true;
	}
	const response = await resolve(event);
	response.headers.set('Permissions-Policy', 'geolocation=(self)');
	return response;
};
