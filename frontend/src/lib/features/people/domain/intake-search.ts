/**
 * Station 1 search-first intake helpers (#251).
 * Pure classification for federated local Couch + Central Pool results.
 */

import type { StayStatus } from './people';
import { STATUS_LABELS } from './people';

/** CTA when a local shelter hit is `pre_registered`. */
export const REPORT_IN_CTA_LABEL = 'รับรายงานตัว (Report-in)';

/** Prominent not-found / walk-in CTA (#251 AC). */
export const NEW_REGISTRATION_CTA_LABEL = '+ ลงทะเบียนใหม่';

/** Quick-search placeholder: National ID / Passport / Name / Phone. */
export const INTAKE_SEARCH_PLACEHOLDER =
	'เลขบัตรประชาชน / หนังสือเดินทาง / ชื่อ-นามสกุล / เบอร์โทร';

export type ShelterHitAction = 'report_in' | 'show_status';

/**
 * Local shelter hit → desk action.
 * `pre_registered` opens Report-in; every other stay status is shown to block duplicates.
 */
export function resolveShelterHitAction(status: StayStatus): ShelterHitAction {
	return status === 'pre_registered' ? 'report_in' : 'show_status';
}

/** Thai label for the stay status shown on already-registered hits. */
export function shelterHitStatusLabel(status: StayStatus): string {
	return STATUS_LABELS[status] ?? status;
}

/**
 * True when staff have completed a search and neither plane returned hits.
 * Drives the prominent `[ + ลงทะเบียนใหม่ ]` empty state.
 */
export function isIntakeNotFoundState(args: {
	hasSearched: boolean;
	localHitCount: number;
	centralPoolHitCount: number;
}): boolean {
	if (!args.hasSearched) return false;
	return args.localHitCount === 0 && args.centralPoolHitCount === 0;
}

/** True when at least one plane still has hits (blocks treating the query as not-found). */
export function hasFederatedIntakeHits(
	localHitCount: number,
	centralPoolHitCount: number
): boolean {
	return localHitCount > 0 || centralPoolHitCount > 0;
}
