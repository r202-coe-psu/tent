import { dev } from '$app/environment';

export type GateInput =
	| { source: 'smart-card'; citizen_id: string }
	| { source: 'qr'; token: string }
	| { source: 'phone'; phone: string; primary_evacuee_id?: string };

export interface KioskEvacueeSummary {
	evacuee_id: string;
	first_name: string;
	last_name: string;
	gender: string | null;
	age: number | null;
	status: string;
	is_primary: boolean;
	phone_matched?: boolean;
	selectable: boolean;
}

export interface KioskLookupResult {
	shelter_code: string;
	primary_evacuee_id: string;
	members: KioskEvacueeSummary[];
}

export interface KioskHouseholdCandidate {
	primary_evacuee_id: string;
	contact_display: string;
	member_count: number;
	pending_count: number;
}

export type KioskLookupResponse =
	| ({ kind: 'household'; name_masked: boolean } & KioskLookupResult)
	| { kind: 'candidates'; shelter_code: string; candidates: KioskHouseholdCandidate[] };

export interface KioskCheckInMemberResult {
	evacuee_id: string;
	status: 'checked_in' | 'already_checked_in' | 'not_found' | 'not_eligible' | 'failed';
	stay_status?: string;
	qr_payload?: string;
}

export interface KioskCheckInResult {
	shelter_code: string;
	members: KioskCheckInMemberResult[];
}

export interface KioskCheckInBatchResult extends KioskCheckInResult {
	retryable_evacuee_ids: string[];
}

export class KioskRequestError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly code: string | null
	) {
		super(message);
		this.name = 'KioskRequestError';
	}
}

export class KioskPartialCheckInError extends Error {
	constructor(readonly result: KioskCheckInBatchResult) {
		super('รายงานตัวได้บางส่วน กรุณาตรวจผลและลองรายการที่เหลืออีกครั้ง');
		this.name = 'KioskPartialCheckInError';
	}
}

async function requestError(response: Response): Promise<KioskRequestError> {
	const body = (await response.json().catch((error: unknown) => {
		if (error instanceof Error && error.name === 'AbortError') throw error;
		return null;
	})) as {
		error?: { message?: unknown; code?: unknown } | unknown;
	} | null;
	const nestedMessage =
		typeof body?.error === 'object' && body.error !== null && 'message' in body.error
			? body.error.message
			: null;
	const nestedCode =
		typeof body?.error === 'object' && body.error !== null && 'code' in body.error
			? body.error.code
			: null;
	const message = typeof nestedMessage === 'string' ? nestedMessage : 'ระบบไม่สามารถทำรายการได้';
	return new KioskRequestError(
		message,
		response.status,
		typeof nestedCode === 'string' ? nestedCode : null
	);
}

function withTimeout(
	ms: number,
	signal?: AbortSignal
): { signal: AbortSignal; cleanup: () => void } {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), ms);
	const abortFromParent = () => controller.abort(signal?.reason);
	if (signal?.aborted) abortFromParent();
	else signal?.addEventListener('abort', abortFromParent, { once: true });
	return {
		signal: controller.signal,
		cleanup: () => {
			clearTimeout(timeoutId);
			signal?.removeEventListener('abort', abortFromParent);
		}
	};
}

async function requestWithTimeout<T>(
	input: RequestInfo | URL,
	init: RequestInit,
	consume: (response: Response) => Promise<T>,
	signal?: AbortSignal
): Promise<T> {
	const timeout = withTimeout(10_000, signal);
	try {
		const response = await fetch(input, { ...init, signal: timeout.signal });
		return await consume(response);
	} catch (error) {
		if (error instanceof Error && error.name === 'AbortError') {
			throw new KioskRequestError('เชื่อมต่อช้า กรุณาลองอีกครั้ง', 0, 'TIMEOUT');
		}
		throw error;
	} finally {
		timeout.cleanup();
	}
}

function normalizeLookupResponse(payload: unknown): KioskLookupResponse {
	if (typeof payload === 'object' && payload !== null && 'kind' in payload) {
		return payload as KioskLookupResponse;
	}
	return { ...(payload as KioskLookupResult), kind: 'household', name_masked: false };
}

/** Resolve any identity gate through the scanner-authenticated kiosk API. */
export async function lookupPreRegisteredEvacuee(
	input: GateInput,
	options: { signal?: AbortSignal } = {}
): Promise<KioskLookupResponse> {
	const result = await requestWithTimeout(
		'/api/v1/scanner/kiosk/lookup',
		{
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			cache: 'no-store',
			body: JSON.stringify(input)
		},
		async (response) => {
			if (dev) console.info('[Kiosk lookup] Response', { http_status: response.status });
			if (!response.ok) throw await requestError(response);
			return normalizeLookupResponse(await response.json());
		},
		options.signal
	);
	return result;
}

/** The server derives the shelter from device auth and validates household membership. */
export async function checkInSelectedMembers(
	primaryEvacueeId: string,
	evacueeIds: string[],
	options: { signal?: AbortSignal; batchLimit?: number } = {}
): Promise<KioskCheckInBatchResult> {
	const batchLimit = Math.min(20, Math.max(1, options.batchLimit ?? 20));
	const batches = Array.from({ length: Math.ceil(evacueeIds.length / batchLimit) }, (_, index) =>
		evacueeIds.slice(index * batchLimit, (index + 1) * batchLimit)
	);
	const members: KioskCheckInMemberResult[] = [];
	let shelterCode = '';
	const retryableIds = (notReturned: ReadonlySet<string> = new Set()) => {
		const byId = new Map(members.map((member) => [member.evacuee_id, member]));
		return evacueeIds.filter((id) => {
			const result = byId.get(id);
			return notReturned.has(id) || !result || result.status === 'failed';
		});
	};

	for (const [batchIndex, batch] of batches.entries()) {
		try {
			const result = await requestWithTimeout<KioskCheckInResult>(
				'/api/v1/scanner/kiosk/check-in',
				{
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					cache: 'no-store',
					body: JSON.stringify({ primary_evacuee_id: primaryEvacueeId, evacuee_ids: batch })
				},
				async (response) => {
					if (!response.ok) throw await requestError(response);
					return (await response.json()) as KioskCheckInResult;
				},
				options.signal
			);
			shelterCode = result.shelter_code;
			members.push(...result.members);
		} catch (error) {
			if (members.length === 0) throw error;
			const notReturned = new Set(batches.slice(batchIndex).flat());
			throw new KioskPartialCheckInError({
				shelter_code: shelterCode,
				members: [...members],
				retryable_evacuee_ids: retryableIds(notReturned)
			});
		}
	}
	return { shelter_code: shelterCode, members, retryable_evacuee_ids: retryableIds() };
}
