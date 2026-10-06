/**
 * Pure helpers for Intake Pipeline queues (Station 1 next-queue labels + Station 3 tabs).
 * No I/O — unit-tested.
 */
import type { Evacuee, TriageLevel } from './people';

export type NextQueueLabel = 'รอแพทย์' | 'รอโซน' | 'รอยืนยันถึงโซน' | 'พักแล้ว' | '—';

export type ZoningQueueTab = 'pending' | 'awaiting_confirm' | 'assigned';

export type ScreeningQueueTab = 'pending' | 'screened';

export type ZoningRecommendKind = 'quarantine' | 'vulnerable' | 'general';

/**
 * 「คิวถัดไป」 column for Station 1 registration desk.
 * Flag on: arriving without screening → รอแพทย์; arriving with screening (or any arriving when
 * flag off) → รอโซน (a stale zone on arriving is ignored); active + zone → รอยืนยันถึงโซน; room_confirmed /
 * temporary_leave (and other legacy zoned stays) → พักแล้ว.
 */
export function nextQueueLabel(
	evacuee: Evacuee,
	opts: { enableMedicalScreening: boolean; hasScreening: boolean }
): NextQueueLabel {
	const status = evacuee.current_stay?.status;
	const zone = evacuee.current_stay?.zone;
	const hasZone = zone != null && zone !== '';

	// Arriving wins over a stale zone left on legacy / hand-edited docs — still in the intake pipeline
	if (status === 'arriving') {
		if (opts.enableMedicalScreening && !opts.hasScreening) {
			return 'รอแพทย์';
		}
		return 'รอโซน';
	}

	if (status === 'active' && hasZone) {
		return 'รอยืนยันถึงโซน';
	}

	if (status === 'room_confirmed' || status === 'temporary_leave' || hasZone) {
		return 'พักแล้ว';
	}

	if (status === 'pre_registered') {
		return '—';
	}

	return '—';
}

/**
 * 「พักในศูนย์แล้ว」 on the Station 1 desk: checked in (active) or zone arrival confirmed.
 * Never includes arriving / pre_registered — those are still in the intake pipeline.
 */
export function isInShelterStatus(evacuee: Evacuee): boolean {
	const status = evacuee.current_stay?.status;
	return status === 'active' || status === 'room_confirmed';
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
 * Next person for the Station 2 「คนถัดไปในคิว」 button: first `arriving` person still waiting
 * for screening (queue order), skipping `excludeId`. Pre-registered people are not on site yet,
 * so they are never auto-opened.
 */
export function nextScreeningQueueEvacuee<T extends Evacuee>(
	evacuees: readonly T[],
	screenedEvacueeIds: Set<string>,
	excludeId?: string | null
): T | null {
	return (
		evacuees.find(
			(e) =>
				e._id !== excludeId &&
				e.current_stay?.status === 'arriving' &&
				classifyScreeningQueueTab(e, screenedEvacueeIds) === 'pending'
		) ?? null
	);
}

/**
 * Station 3 queue tab classification ("Cleared for Zoning" = pending).
 * - pending (รอจัด / พร้อมจัดโซน): arriving, zone null; when flag on also requires a screening doc
 * - awaiting_confirm (รอยืนยันถึงโซน): active with zone — Zone Arrival Confirmation pending
 * - assigned (จัดแล้ว / ยืนยันแล้ว): room_confirmed with zone only
 *   (temporary_leave keeps Present occupancy but is not Zone Arrival Confirmation)
 */
export function classifyZoningQueueTab(
	evacuee: Evacuee,
	opts: { enableMedicalScreening: boolean; hasScreening: boolean }
): ZoningQueueTab | null {
	const status = evacuee.current_stay?.status;
	const zone = evacuee.current_stay?.zone;
	const hasZone = zone != null && zone !== '';

	if (hasZone && status === 'active') {
		return 'awaiting_confirm';
	}

	if (hasZone && status === 'room_confirmed') {
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
 * Zone type recommendation for Station 3 (CR-106):
 * EWAR surveillance symptoms → quarantine; else Vulnerable Groups / Special Needs → vulnerable; else general.
 * Supports legacy TriageLevel for backward compatibility.
 */
export function recommendZoneKind(
	evacuee: Pick<Evacuee, 'vulnerable_groups' | 'special_needs'>,
	ewarSymptomsOrTriage?: readonly string[] | TriageLevel | null
): ZoningRecommendKind {
	if (Array.isArray(ewarSymptomsOrTriage)) {
		if (ewarSymptomsOrTriage.length > 0) {
			return 'quarantine';
		}
	} else if (ewarSymptomsOrTriage === 'red' || ewarSymptomsOrTriage === 'yellow') {
		return 'quarantine';
	}
	if (evacuee.vulnerable_groups && evacuee.vulnerable_groups.length > 0) {
		return 'vulnerable';
	}
	// Legacy docs may still carry coded tags in special_needs until staff re-save.
	if (evacuee.special_needs && evacuee.special_needs.length > 0) {
		return 'vulnerable';
	}
	return 'general';
}

/** Zone type names shared by Station 2 (screening summary) and Station 3 (zone picker). */
export const ZONE_KIND_LABELS: Record<ZoningRecommendKind, string> = {
	quarantine: 'โซนกักตัว (มีอาการเฝ้าระวัง)',
	vulnerable: 'โซนกลุ่มเปราะบาง',
	general: 'โซนทั่วไป'
};

/**
 * First open zone whose type matches `kind` (zones without a type count as general).
 * Returns null when none matches — callers must not fall back to an unrelated zone,
 * or the recommendation text would contradict the zone shown.
 */
export function pickRecommendedZone<Z extends { type?: string; status?: string }>(
	zones: readonly Z[],
	kind: ZoningRecommendKind
): Z | null {
	return zones.find((z) => z.status !== 'closed' && (z.type || 'general') === kind) ?? null;
}

export type PreferredZoneOutcome =
	| { kind: 'none' }
	| { kind: 'use'; code: string }
	/** EWAR symptoms: quarantine is recommended instead, the suggestion is shown read-only (FR-07). */
	| { kind: 'quarantine_overrides'; code: string }
	/** The suggested zone is closed or no longer in the shelter (FR-08). */
	| { kind: 'unavailable'; code: string };

/**
 * CR-155: what Station 3 does with the zone Station 1 suggested.
 * Only `use` pre-selects it; staff can always pick another zone.
 */
export function resolvePreferredZone<Z extends { code: string; status?: string }>(
	preferredZone: string | null | undefined,
	zones: readonly Z[],
	recommendKind: ZoningRecommendKind
): PreferredZoneOutcome {
	const code = preferredZone?.trim();
	if (!code) return { kind: 'none' };
	if (recommendKind === 'quarantine') return { kind: 'quarantine_overrides', code };
	const zone = zones.find((z) => z.code === code);
	if (!zone || zone.status === 'closed') return { kind: 'unavailable', code };
	return { kind: 'use', code };
}

/**
 * Present occupancy per zone: occupants whose stay is still "present"
 * (`active` | `room_confirmed` | `temporary_leave`) — not In-zone-only.
 * Includes Zone Arrival Confirmation pending (`active` + zone).
 */
export function countPresentOccupantsByZone(evacuees: readonly Evacuee[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const e of evacuees) {
		const status = e.current_stay?.status;
		const zone = e.current_stay?.zone;
		if (!zone) continue;
		if (status !== 'active' && status !== 'room_confirmed' && status !== 'temporary_leave') {
			continue;
		}
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

export function buildZoningPath(evacueeId: string, opts: { focusZone?: boolean } = {}): string {
	const path = `/onsite/zoning/${evacueeId}`;
	return opts.focusZone ? `${path}?focus=zone` : path;
}

/**
 * When a person joined the Station 3 「พร้อมจัดโซน」 queue: their latest screening time when
 * medical screening produced one, otherwise the last update of the arriving record.
 */
export function zoningQueueSince(evacuee: Evacuee, latestScreeningAt?: string | null): string {
	return latestScreeningAt || evacuee.updated_at || evacuee.created_at;
}

/** Oldest-waiting first for the 「พร้อมจัดโซน」 queue. Does not mutate the input. */
export function sortByZoningQueueSince<T extends Evacuee>(
	evacuees: readonly T[],
	latestScreeningAt: Readonly<Record<string, string>>
): T[] {
	return [...evacuees].sort((a, b) =>
		zoningQueueSince(a, latestScreeningAt[a._id]).localeCompare(
			zoningQueueSince(b, latestScreeningAt[b._id])
		)
	);
}

/** 「รอ 5 นาที」 / 「รอ 2 ชม. 10 นาที」 / 「รอ 1 วัน 3 ชม.」 — elapsed time since `sinceIso`. */
export function formatQueueWait(sinceIso: string | null | undefined, now: Date): string {
	if (!sinceIso) return '—';
	const since = new Date(sinceIso).getTime();
	if (Number.isNaN(since)) return '—';
	const minutes = Math.max(0, Math.floor((now.getTime() - since) / 60_000));
	if (minutes < 1) return 'เพิ่งเข้าคิว';
	if (minutes < 60) return `รอ ${minutes} นาที`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) {
		const rest = minutes % 60;
		return rest > 0 ? `รอ ${hours} ชม. ${rest} นาที` : `รอ ${hours} ชม.`;
	}
	const days = Math.floor(hours / 24);
	const restHours = hours % 24;
	return restHours > 0 ? `รอ ${days} วัน ${restHours} ชม.` : `รอ ${days} วัน`;
}
