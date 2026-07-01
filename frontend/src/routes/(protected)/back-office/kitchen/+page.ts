import { requireKitchen } from '$lib/guards/auth';
import type { PageLoad } from './$types';

export const load: PageLoad = requireKitchen;
