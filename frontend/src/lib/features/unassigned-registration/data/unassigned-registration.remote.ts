/**
 * Browser → SvelteKit BFF for staff Unassigned Registration search/claim (CR-113).
 * Never calls FastAPI from the browser.
 */
import {
	unassignedRegistrationClaimResponseSchema,
	type UnassignedRegistrationClaimRequest,
	type UnassignedRegistrationClaimResponse
} from '../domain/claim';
import type { UnassignedRegistrationSearchResponse } from '../domain/search';
import type { UnassignedRegistrationRepository } from './unassigned-registration.repository';

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

function errorFromBody(
	body: Record<string, unknown> | null,
	status: number,
	fallbackCode: string,
	fallbackMessage: string
): UnassignedRegistrationApiError {
	const nested =
		body && typeof body.error === 'object' && body.error !== null
			? (body.error as { code?: string; message?: string })
			: null;
	const code =
		(typeof body?.code === 'string' && body.code) ||
		nested?.code ||
		(status === 503 ? 'ONLINE_REQUIRED' : fallbackCode);
	const message =
		(typeof nested?.message === 'string' && nested.message) ||
		(typeof body?.message === 'string' && body.message) ||
		fallbackMessage;
	return new UnassignedRegistrationApiError(code, message, status);
}

export const unassignedRegistrationRemote: UnassignedRegistrationRepository = {
	async searchOpen(q: string): Promise<UnassignedRegistrationSearchResponse> {
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
			throw errorFromBody(
				body,
				response.status,
				'SEARCH_FAILED',
				'ค้นหาคิวลงทะเบียนล่วงหน้าไม่สำเร็จ'
			);
		}
		const results = Array.isArray(body.results) ? body.results : [];
		return {
			results: results as UnassignedRegistrationSearchResponse['results']
		};
	},

	async claimMembers(
		registrationId: string,
		payload: UnassignedRegistrationClaimRequest
	): Promise<UnassignedRegistrationClaimResponse> {
		const response = await fetch(
			`/api/staff/v1/unassigned-registrations/${encodeURIComponent(registrationId)}/claim`,
			{
				method: 'POST',
				credentials: 'include',
				headers: {
					Accept: 'application/json',
					'Content-Type': 'application/json'
				},
				body: JSON.stringify(payload)
			}
		);
		const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
		if (!response.ok || !body) {
			throw errorFromBody(body, response.status, 'CLAIM_FAILED', 'รับสมาชิกเข้าศูนย์ไม่สำเร็จ');
		}
		const parsed = unassignedRegistrationClaimResponseSchema.safeParse(body);
		if (!parsed.success) {
			throw new UnassignedRegistrationApiError(
				'CLAIM_FAILED',
				'รูปแบบคำตอบรับเข้าศูนย์ไม่ถูกต้อง',
				response.status
			);
		}
		return parsed.data;
	}
};

/** @deprecated Prefer repository — kept for barrel/tests naming clarity. */
export async function searchUnassignedRegistrations(
	q: string
): Promise<UnassignedRegistrationSearchResponse> {
	return unassignedRegistrationRemote.searchOpen(q);
}
