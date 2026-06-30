import type { PageLoad } from './$types';

export const load: PageLoad = async ({ url, fetch }) => {
	// Mocking query params reading (can be used to pre-filter data)
	const search = url.searchParams.get('q') || '';
	const province = url.searchParams.get('province') || '';
	const status = url.searchParams.get('status') || '';

	// Mocking the GET /public/v1/transparency/shelters API response
	// The response should be aggregate-only, no-PII, including shelter geo for maps.
	const response = await fetch(`/api/public/v1/transparency/shelters?q=${search}&province=${province}&status=${status}`);
	const data = await response.json();

	return data;
};
