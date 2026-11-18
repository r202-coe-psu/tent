import type { Handle } from '@sveltejs/kit';
import { runWithActorScope } from '$lib/server/request-actor';

/** First-party pages may request GPS; public distance filter depends on it. */
export const handle: Handle = async ({ event, resolve }) => {
	const response = await runWithActorScope(() => resolve(event));
	response.headers.set('Permissions-Policy', 'geolocation=(self)');
	return response;
};
