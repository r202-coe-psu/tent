/**
 * Reads of the public volunteer job board through the SvelteKit BFF (`/api/public/v1/volunteer/*`).
 * Public plane: no CouchDB session, no staff repository (CONTRIBUTING §4.2).
 */

export interface PublicBoardParams {
	q: string;
	status: 'all' | 'open' | 'near_full' | 'controlled';
	shelterCode: string;
	/** Every spelling of the picked skill (code + labels) so jobs stored either way match. */
	skills: readonly string[];
	page: number;
	pageSize: number;
}

export interface PublicBoardPage<Job = Record<string, unknown>> {
	jobs: Job[];
	total: number;
	shelters: { code: string; name: string }[];
}

/** Board-wide counts that ignore filters and paging (CR-264 FR-9). */
export interface PublicBoardSummary {
	total: number;
	open: number;
	near_full: number;
	controlled: number;
	as_of: string;
}

export async function fetchPublicBoard<Job = Record<string, unknown>>(
	params: PublicBoardParams,
	signal?: AbortSignal
): Promise<PublicBoardPage<Job>> {
	const query = new URLSearchParams();
	if (params.q) query.set('q', params.q);
	if (params.status !== 'all') query.set('status', params.status);
	if (params.shelterCode !== 'all') query.set('shelter_code', params.shelterCode);
	for (const skill of params.skills) query.append('skill', skill);
	query.set('page', String(params.page));
	query.set('page_size', String(params.pageSize));
	const res = await fetch(`/api/public/v1/volunteer/jobs?${query}`, { signal });
	if (!res.ok) throw new Error(`public jobs board failed (${res.status})`);
	const data = await res.json();
	const jobs: Job[] = Array.isArray(data.jobs) ? data.jobs : [];
	return {
		jobs,
		total: typeof data.total === 'number' ? data.total : jobs.length,
		shelters: Array.isArray(data.shelters) ? data.shelters : []
	};
}

export async function fetchPublicBoardSummary(signal?: AbortSignal): Promise<PublicBoardSummary> {
	const res = await fetch('/api/public/v1/volunteer/jobs/summary', { signal });
	if (!res.ok) throw new Error(`public jobs summary failed (${res.status})`);
	const data = await res.json();
	return {
		total: Number(data.total) || 0,
		open: Number(data.open) || 0,
		near_full: Number(data.near_full) || 0,
		controlled: Number(data.controlled) || 0,
		as_of: typeof data.as_of === 'string' ? data.as_of : ''
	};
}
