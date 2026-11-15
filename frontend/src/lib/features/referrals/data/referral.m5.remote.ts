/**
 * Browser → BFF calls for the M5 dispatch mode (draft CR — referral M5 integration §2, §5).
 * The browser never sends national IDs or talks to FastAPI/M5; it sends the batch form and
 * batch ids only.
 */
import { getShelterCode } from '$lib/db/shelter';
import { isReferral, type Referral } from '../domain/referral.schema';
import type { M5BatchInput } from '../domain/referral.m5';

export type M5Facility = {
	facility_id: number;
	name: string;
	category: string;
	district?: string | null;
	province: string;
	readiness?: { beds_surge: number; er_capacity: number; vital: number; updated_at: string } | null;
};

export type M5MemberFailure = { id: string; error: string };

/** A BFF failure with its machine code (`CANCEL_NEEDS_MOPH`, `M5_UNAVAILABLE`, …). */
export class M5RequestError extends Error {
	constructor(
		readonly status: number,
		readonly code: string | undefined,
		message: string
	) {
		super(message);
		this.name = 'M5RequestError';
	}
}

async function bff<T>(path: string, init: RequestInit = {}): Promise<T> {
	const qs = new URLSearchParams({ shelter_code: getShelterCode() });
	const sep = path.includes('?') ? '&' : '?';
	const res = await fetch(`${path}${sep}${qs}`, {
		credentials: 'include',
		...init,
		headers: {
			Accept: 'application/json',
			...(init.body ? { 'Content-Type': 'application/json' } : {}),
			...init.headers
		}
	});
	const payload: unknown = await res.json().catch(() => null);
	if (!res.ok) {
		const p = (payload ?? {}) as { error?: unknown; code?: unknown };
		throw new M5RequestError(
			res.status,
			typeof p.code === 'string' ? p.code : undefined,
			typeof p.error === 'string' ? p.error : `คำขอไม่สำเร็จ (${res.status})`
		);
	}
	return payload as T;
}

const referrals = (items: unknown): Referral[] =>
	(Array.isArray(items) ? items : []).filter((d): d is Referral => isReferral(d));

export async function fetchM5Facilities(q: string): Promise<M5Facility[]> {
	const path = `/api/back-office/referral/m5/facilities${q ? `?q=${encodeURIComponent(q)}` : ''}`;
	const res = await bff<{ data?: M5Facility[] }>(path);
	return res.data ?? [];
}

export type M5BatchCreateResult = {
	batch_id: string;
	items: Referral[];
	submit:
		| null
		| { ok: true; code: string; status: string; failed: M5MemberFailure[] }
		| { ok: false; error: string; code?: string };
};

export async function createM5BatchRemote(input: M5BatchInput): Promise<M5BatchCreateResult> {
	const res = await bff<M5BatchCreateResult>('/api/back-office/referral/batch', {
		method: 'POST',
		body: JSON.stringify(input)
	});
	return { ...res, items: referrals(res.items) };
}

const batchPath = (batchId: string, action: string) =>
	`/api/back-office/referral/batch/${encodeURIComponent(batchId)}/m5/${action}`;

export async function submitM5BatchRemote(
	batchId: string
): Promise<{ code: string; status: string; items: Referral[]; failed: M5MemberFailure[] }> {
	const res = await bff<{
		code: string;
		status: string;
		items: unknown;
		failed: M5MemberFailure[];
	}>(batchPath(batchId, 'submit'), { method: 'POST', body: '{}' });
	return { ...res, items: referrals(res.items) };
}

export async function startM5BatchRemote(
	batchId: string
): Promise<{ items: Referral[]; failed: M5MemberFailure[] }> {
	const res = await bff<{ items: unknown; failed: M5MemberFailure[] }>(
		batchPath(batchId, 'start'),
		{
			method: 'POST',
			body: '{}'
		}
	);
	return { ...res, items: referrals(res.items) };
}

export async function cancelM5BatchRemote(
	batchId: string,
	reason: string,
	resubmitWithout?: string[]
): Promise<{ items: Referral[]; failed: M5MemberFailure[]; new_batch_id: string | null }> {
	const res = await bff<{ items: unknown; failed: M5MemberFailure[]; new_batch_id: string | null }>(
		batchPath(batchId, 'cancel'),
		{
			method: 'POST',
			body: JSON.stringify({
				reason,
				...(resubmitWithout ? { resubmit_without: resubmitWithout } : {})
			})
		}
	);
	return { ...res, items: referrals(res.items) };
}
