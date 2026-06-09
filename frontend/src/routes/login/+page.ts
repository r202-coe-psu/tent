import { redirectIfAuthenticated } from '$lib/guards/auth';
import type { PageLoad } from './$types';

export const load = (async () => {
  await redirectIfAuthenticated('/notes');
}) satisfies PageLoad;
