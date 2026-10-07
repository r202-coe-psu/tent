import type { PageLoad } from './$types';
import { UNASSIGNED_SHELTER_CODE } from '$lib/features/public-register';

export const load: PageLoad = ({ url }) => {
	const shelter = url.searchParams.get('shelter') || UNASSIGNED_SHELTER_CODE;
	return {
		shelterCode: shelter
	};
};
