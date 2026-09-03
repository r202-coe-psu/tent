import type { Evacuee, Household } from '$lib/features/people';
import {
	classifyScreeningQueueTab,
	matchesEvacueeSearch,
	type ScreeningQueueTab
} from '$lib/features/people';

export type { ScreeningQueueTab };
export { classifyScreeningQueueTab };

/** Path-only deep link for Station 2 clinical form. */
export function buildMedicalScreeningPath(evacueeId: string): string {
	return `/onsite/medical-screening/${evacueeId}`;
}

/**
 * Parses a scanned QR code text or barcode input to extract the evacuee ID.
 * Prefers path form `/onsite/medical-screening/{id}`; also accepts legacy
 * `?evacuee_id=` slips when scanned, and bare evacuee ids.
 */
export function parseMedicalScreeningQrCode(input: string): string | null {
	if (!input) return null;
	const trimmed = input.trim();
	if (!trimmed) return null;

	const pathMatch = trimmed.match(/\/onsite\/medical-screening\/([^/?#]+)/);
	if (pathMatch?.[1]) {
		return decodeURIComponent(pathMatch[1]).trim() || null;
	}

	if (trimmed.includes('evacuee_id=')) {
		try {
			const url =
				trimmed.startsWith('http://') || trimmed.startsWith('https://')
					? new URL(trimmed)
					: new URL(trimmed, 'http://dummy.local');
			const id = url.searchParams.get('evacuee_id');
			return id ? id.trim() : null;
		} catch {
			const match = trimmed.match(/[?&]evacuee_id=([^&#]+)/);
			return match ? decodeURIComponent(match[1]).trim() : null;
		}
	}

	if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
		return null;
	}

	if (trimmed === '/onsite/medical-screening' || trimmed.endsWith('/onsite/medical-screening')) {
		return null;
	}

	return trimmed;
}

/** Dirty-leave confirm: only when there are unsaved edits and save is not in flight. */
export function shouldConfirmLeave(opts: { isDirty: boolean; isSubmitting?: boolean }): boolean {
	return opts.isDirty && !opts.isSubmitting;
}

/**
 * Filters an evacuee by first name, last name, phone, citizen ID, or address.
 */
export function matchesMedicalScreeningSearch(
	evacuee: Evacuee,
	query: string,
	household?: Household | null
): boolean {
	const q = query.trim().toLowerCase();
	if (!q) return true;

	if (matchesEvacueeSearch(evacuee, q)) {
		return true;
	}

	if (household) {
		const addressParts = [
			household.address_no,
			household.village_no ? `หมู่ ${household.village_no}` : null,
			household.village_no,
			household.subdistrict,
			household.district,
			household.province,
			household.postal_code,
			household.label
		].filter(Boolean) as string[];

		const fullAddress = addressParts.join(' ').toLowerCase();
		if (fullAddress.includes(q)) {
			return true;
		}
	}

	return false;
}
