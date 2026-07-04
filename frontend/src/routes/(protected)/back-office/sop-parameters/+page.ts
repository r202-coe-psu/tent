import { requireAdmin } from '$lib/guards/auth';
import type { PageLoad } from './$types';

export const load: PageLoad = async (event) => {
	await requireAdmin(event.fetch);
};
