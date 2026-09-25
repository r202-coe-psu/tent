import { fetchKioskConfig } from '$lib/features/kiosk';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch }) => fetchKioskConfig(fetch);
