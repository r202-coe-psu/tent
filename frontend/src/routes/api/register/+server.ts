import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const prerender = false;

// Self-signup is closed (#474): accounts are provisioned by SA/SM through /api/v1/users.
// `$lib/features/register` is kept for a possible return; nothing imports it today.
export const POST: RequestHandler = async () => {
	throw error(404, 'Not found');
};
