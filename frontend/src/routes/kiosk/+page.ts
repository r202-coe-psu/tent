import { fetchKioskConfig } from '$lib/features/kiosk/config';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch }) => fetchKioskConfig(fetch);
