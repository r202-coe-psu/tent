import type { PageLoad } from './$types';

export const load: PageLoad = ({ url }) => {
	const shelter = url.searchParams.get('shelter') ?? '';
	return {
		shelterCode: shelter
	};
};
