/**
 * Pure helpers for Intake Pipeline queues (Station 1 next-queue labels + Station 3 tabs).
 * No I/O — unit-tested.
 */
import type { Evacuee, TriageLevel } from './people';

export type NextQueueLabel = 'รอแพทย์' | 'รอโซน' | 'พักแล้ว' | '—';

export type ZoningQueueTab = 'pending' | 'assigned';

export type ScreeningQueueTab = 'pending' | 'screened';

export type ZoningRecommendKind = 'quarantine' | 'vulnerable' | 'general';

/**
 * 「คิวถัดไป」 column for Station 1 registration desk.
 * Flag on: arriving without screening → รอแพทย์; arriving with screening (or any arriving when
 * flag off) and no zone → รอโซน; active (or zoned) → พักแล้ว.
 */
export function nextQueueLabel(
	evacuee: Evacuee,
	opts: { enableMedicalScreening: boolean; hasScreening: boolean }
): NextQueueLabel {
	const status = evacuee.current_stay?.status;
	const zone = evacuee.current_stay?.zone;

	if (status === 'active' || (zone != null && zone !== '')) {
		return 'พักแล้ว';
	}

	if (status === 'arriving') {
		if (opts.enableMedicalScreening && !opts.hasScreening) {
			return 'รอแพทย์';
		}
		return 'รอโซน';
	}

	if (status === 'pre_registered') {
		return '—';
	}

	return '—';
}

/**
 * Station 2 queue tab classification.
 * - pending (รอตรวจ): arriving/pre_registered with no screening yet
 * - screened (ตรวจแล้ว): has screening and still in the intake pipeline (arriving/pre_registered)
 * - null: checked-in / left pipeline — cleared from medical waiting queues
 */
export function classifyScreeningQueueTab(
	evacuee: Evacuee,
	screenedEvacueeIds: Set<string>
): ScreeningQueueTab | null {
	const status = evacuee.current_stay?.status;
	if (status !== 'arriving' && status !== 'pre_registered') {
		return null;
	}
	if (screenedEvacueeIds.has(evacuee._id)) {
		return 'screened';
	}
	return 'pending';
}

/**
 * Station 3 queue tab classification ("Cleared for Zoning" = pending).
 * - pending (รอจัด / พร้อมจัดโซน): arriving, zone null; when flag on also requires a screening doc
 * - assigned (จัดแล้ว): has a zone (typically active after check-in)
 */
export function classifyZoningQueueTab(
	evacuee: Evacuee,
	opts: { enableMedicalScreening: boolean; hasScreening: boolean }
): ZoningQueueTab | null {
	const status = evacuee.current_stay?.status;
	const zone = evacuee.current_stay?.zone;
	const hasZone = zone != null && zone !== '';

	if (hasZone && (status === 'active' || status === 'temporary_leave')) {
		return 'assigned';
	}

	if (status === 'arriving' && !hasZone) {
		if (opts.enableMedicalScreening && !opts.hasScreening) {
			return null;
		}
		return 'pending';
	}

	return null;
}

/**
 * Zone type recommendation for Station 3:
 * red/yellow triage → quarantine; else special_needs → vulnerable; else general.
 */
export function recommendZoneKind(
	evacuee: Pick<Evacuee, 'special_needs'>,
	triageLevel: TriageLevel | null | undefined
): ZoningRecommendKind {
	if (triageLevel === 'red' || triageLevel === 'yellow') {
		return 'quarantine';
	}
	if (evacuee.special_needs && evacuee.special_needs.length > 0) {
		return 'vulnerable';
	}
	return 'general';
}

/** Count active (or temporary_leave) occupants per zone code. */
export function countOccupantsByZone(evacuees: readonly Evacuee[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const e of evacuees) {
		const status = e.current_stay?.status;
		const zone = e.current_stay?.zone;
		if (!zone) continue;
		if (status !== 'active' && status !== 'temporary_leave') continue;
		counts.set(zone, (counts.get(zone) ?? 0) + 1);
	}
	return counts;
}

/**
 * Parses scanned QR text for Station 3: zoning path, medical path, or bare evacuee id.
 */
export function parseZoningQrCode(input: string): string | null {
	if (!input) return null;
	const trimmed = input.trim();
	if (!trimmed) return null;

	const zoningMatch = trimmed.match(/\/onsite\/zoning\/([^/?#]+)/);
	if (zoningMatch?.[1]) {
		return decodeURIComponent(zoningMatch[1]).trim() || null;
	}

	const medicalMatch = trimmed.match(/\/onsite\/medical-screening\/([^/?#]+)/);
	if (medicalMatch?.[1]) {
		return decodeURIComponent(medicalMatch[1]).trim() || null;
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

	if (
		trimmed === '/onsite/zoning' ||
		trimmed.endsWith('/onsite/zoning') ||
		trimmed === '/onsite/medical-screening' ||
		trimmed.endsWith('/onsite/medical-screening')
	) {
		return null;
	}

	return trimmed;
}

export function buildZoningPath(evacueeId: string): string {
	return `/onsite/zoning/${evacueeId}`;
}
