import { getShelterCode } from '$lib/db/shelter';
import type { Referral, ReferralInput, ReferralStatus } from '../domain/referral.schema';

export async function listReferrals(filter?: {
	status?: ReferralStatus;
	evacuee_id?: string;
}): Promise<Referral[]> {
	const params = new URLSearchParams();
	params.set('shelter_code', getShelterCode());
	if (filter?.status) {
		params.set('status', filter.status);
	}
	if (filter?.evacuee_id) {
		params.set('evacuee_id', filter.evacuee_id);
	}

	const res = await fetch(`/api/back-office/referral?${params.toString()}`);
	if (!res.ok) {
		const data = await res.json().catch(() => null);
		throw new Error(data?.error || `Failed to fetch referrals (${res.status})`);
	}
	return res.json();
}

export async function getReferral(id: string): Promise<Referral> {
	const params = new URLSearchParams({ shelter_code: getShelterCode() });
	const res = await fetch(
		`/api/back-office/referral/${encodeURIComponent(id)}?${params.toString()}`
	);
	if (!res.ok) {
		const data = await res.json().catch(() => null);
		throw new Error(data?.error || `Failed to fetch referral (${res.status})`);
	}
	return res.json();
}

export async function createReferral(input: ReferralInput): Promise<Referral> {
	const params = new URLSearchParams({ shelter_code: getShelterCode() });
	const res = await fetch(`/api/back-office/referral?${params.toString()}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(input)
	});
	if (!res.ok) {
		const data = await res.json().catch(() => null);
		throw new Error(data?.error || `Failed to create referral (${res.status})`);
	}
	return res.json();
}

export async function transitionReferral(id: string, to: ReferralStatus): Promise<Referral> {
	const params = new URLSearchParams({ shelter_code: getShelterCode() });
	const res = await fetch(
		`/api/back-office/referral/${encodeURIComponent(id)}/transition?${params.toString()}`,
		{
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ to })
		}
	);
	if (!res.ok) {
		const data = await res.json().catch(() => null);
		throw new Error(data?.error || `Failed to transition referral (${res.status})`);
	}
	return res.json();
}
