import type { EvacueeQrSource } from '$lib/utils/evacuee-qr';

/** Sources a staff client may request (`kiosk_*` are issued by kiosk endpoints only). */
export type StaffEvacueeQrSource = Extract<EvacueeQrSource, 'profile' | 'family_batch'>;

export type EvacueeQrIssueItem = {
	evacuee_id: string;
	/** `issued` is the only success value; every other status is a failure (FR-EQR-21b). */
	status: string;
	qr_payload?: string;
	printed_at?: string;
};

export type EvacueeQrIssueInput = {
	shelter_code: string;
	source: StaffEvacueeQrSource;
	evacuee_ids: string[];
};

/**
 * `POST /api/v1/evacuee-qr/issue` (CR-233 §2.8): the server writes the log entry and returns the
 * payload. Plain same-origin fetch with the session cookie; never cached.
 */
export async function issueEvacueeQrs(input: EvacueeQrIssueInput): Promise<EvacueeQrIssueItem[]> {
	const response = await fetch('/api/v1/evacuee-qr/issue', {
		method: 'POST',
		cache: 'no-store',
		credentials: 'same-origin',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(input)
	});
	const payload: unknown = await response.json().catch(() => null);
	if (!response.ok) {
		const error = (payload as { error?: { message?: unknown } } | null)?.error;
		throw new Error(
			typeof error?.message === 'string' ? error.message : `Request failed (${response.status})`
		);
	}
	const items = (payload as { items?: unknown } | null)?.items;
	if (!Array.isArray(items)) throw new Error('Malformed issue response');
	return items.flatMap((raw): EvacueeQrIssueItem[] => {
		const item = raw as Partial<EvacueeQrIssueItem> | null;
		if (typeof item?.evacuee_id !== 'string' || typeof item.status !== 'string') return [];
		return [
			{
				evacuee_id: item.evacuee_id,
				status: item.status,
				qr_payload: typeof item.qr_payload === 'string' ? item.qr_payload : undefined,
				printed_at: typeof item.printed_at === 'string' ? item.printed_at : undefined
			}
		];
	});
}
