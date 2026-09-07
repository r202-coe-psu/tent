/**
 * Browser → SvelteKit BFF for staff Unassigned Registration search (CR-113).
 * Never calls FastAPI from the browser.
 */
import type { UnassignedRegistrationSearchResponse } from '../domain/search';

export class UnassignedRegistrationApiError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly status: number
	) {
		super(message);
		this.name = 'UnassignedRegistrationApiError';
	}
}

export async function searchUnassignedRegistrations(
	q: string
): Promise<UnassignedRegistrationSearchResponse> {
	const params = new URLSearchParams({ q });
	const response = await fetch(
		`/api/staff/v1/unassigned-registrations/search?${params.toString()}`,
		{
			credentials: 'include',
			headers: { Accept: 'application/json' }
		}
	);
	const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
	if (!response.ok || !body) {
		const nested =
			body && typeof body.error === 'object' && body.error !== null
				? (body.error as { code?: string; message?: string })
				: null;
		const code =
			(typeof body?.code === 'string' && body.code) ||
			nested?.code ||
			(response.status === 503 ? 'ONLINE_REQUIRED' : 'SEARCH_FAILED');
		const message =
			(typeof nested?.message === 'string' && nested.message) ||
			(typeof body?.message === 'string' && body.message) ||
			'ค้นหาคิวลงทะเบียนล่วงหน้าไม่สำเร็จ';
		throw new UnassignedRegistrationApiError(code, message, response.status);
	}
	return {
		results: Array.isArray(body.results)
			? (body.results as UnassignedRegistrationSearchResponse['results'])
			: []
	};
}
