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

/** Override confirm when staff insist the federated hit is a different person. */
export const OVERRIDE_NEW_REG_TITLE = 'ยืนยันลงทะเบียนใหม่?';
export const OVERRIDE_NEW_REG_BODY =
	'ระบบพบรายการที่ตรงกับการค้นหา หากเป็นคนละบุคคล กดยืนยันเพื่อลงทะเบียนใหม่';
export const OVERRIDE_NEW_REG_CONFIRM = 'ยืนยันลงทะเบียนใหม่';
export const OVERRIDE_NEW_REG_CANCEL = 'ยกเลิก';

/** Minimal pool-error copy — cannot verify central queue. */
export const POOL_VERIFY_ERROR_COPY = 'ตรวจสอบคิวกลางไม่ได้ — ลองอีกครั้ง';

/** Hint when hits lock new-reg (before override). */
export const NEW_REG_LOCKED_HINT = 'พบรายการที่ตรงกัน — ใช้รายการด้านบน หรือยืนยันว่าเป็นคนละบุคคล';

/** Trigger that opens the override confirm dialog. */
export const NEW_REG_OVERRIDE_TRIGGER_LABEL = 'ไม่ใช่คนนี้ — ลงทะเบียนใหม่';

/** Non-claim roles see pool rows without a claim button. */
export const POOL_CLAIM_FORBIDDEN_HINT = 'ต้องมีสิทธิ์รับเข้าศูนย์เพื่อ claim';

export type ShelterHitAction = 'report_in' | 'show_status';

/** Station 1 new-registration CTA after federated search (#251 grill). */
export type NewRegistrationCtaKind = 'hidden' | 'prominent' | 'outlined_override';

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

/** True when at least one plane still has hits (hard anti-dupe predicate). */
export function hasFederatedIntakeHits(
	localHitCount: number,
	centralPoolHitCount: number
): boolean {
	return localHitCount > 0 || centralPoolHitCount > 0;
}

/**
 * Hard anti-dupe gate for `[ + ลงทะเบียนใหม่ ]`.
 * - Pool error → hidden (cannot verify central queue)
 * - Zero hits → prominent not-found CTA
 * - Any federated hit → hidden until sticky override, then outlined/warned
 */
export function resolveNewRegistrationCta(args: {
	hasSearched: boolean;
	poolError: boolean;
	hasFederatedHits: boolean;
	overrideConfirmed: boolean;
}): NewRegistrationCtaKind {
	if (!args.hasSearched) return 'hidden';
	if (args.poolError) return 'hidden';
	if (!args.hasFederatedHits) return 'prominent';
	if (args.overrideConfirmed) return 'outlined_override';
	return 'hidden';
}
