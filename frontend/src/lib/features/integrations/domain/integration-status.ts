/**
 * Health gate shared by the OneData integrations (draft CR — referral M5 §2, central warehouse M6 §4).
 *
 * Pure TypeScript — No I/O, No Svelte. Mirrors the BFF `GET /api/back-office/integrations/status`
 * answer; `state` is already mapped from FastAPI's per-system check on the server.
 */

export type M5State =
	| 'ready'
	| 'central_unreachable'
	| 'm5_unavailable'
	| 'm5_not_configured'
	| 'm5_credential_invalid';

export type M6State =
	| 'ready'
	| 'central_unreachable'
	| 'm6_unavailable'
	| 'm6_not_configured'
	| 'm6_credential_invalid';

export type IntegrationState = M5State | M6State;

export type IntegrationStatus = {
	m5: { state: M5State; checked_at: string | null };
	m6: { state: M6State; checked_at: string | null; resource_types: string[] };
};

/** Every non-ready state: the gate is closed and actions must be disabled. */
export type BlockedState = Exclude<IntegrationState, 'ready'>;

/** User-facing text of each gate state. `ready` has none. */
export const INTEGRATION_GATE_MESSAGES: Record<BlockedState, string> = {
	central_unreachable: 'เชื่อมต่อกับระบบกลางไม่ได้',
	m5_unavailable: 'เชื่อมต่อ OneData ระบบส่งต่อผู้ป่วย (M5) ไม่ได้ ชั่วคราว',
	m5_not_configured: 'OneData ระบบส่งต่อผู้ป่วย (M5) ยังไม่พร้อม ติดต่อผู้ดูแลระบบ',
	m5_credential_invalid: 'OneData ระบบส่งต่อผู้ป่วย (M5) ยังไม่พร้อม ติดต่อผู้ดูแลระบบ',
	m6_unavailable: 'เชื่อมต่อ OneData ระบบบริหารทรัพยากร (M6) ไม่ได้ ชั่วคราว',
	m6_not_configured: 'OneData ระบบบริหารทรัพยากร (M6) ยังไม่พร้อม ติดต่อผู้ดูแลระบบ',
	m6_credential_invalid: 'OneData ระบบบริหารทรัพยากร (M6) ยังไม่พร้อม ติดต่อผู้ดูแลระบบ'
};

/** The gate is open only when the system answered `ready`. */
export function isGateReady(state: IntegrationState | undefined): boolean {
	return state === 'ready';
}

/** The blocked state to show, or `null` when ready or not yet known. */
export function blockedStateOf(state: IntegrationState | undefined): BlockedState | null {
	return state && state !== 'ready' ? state : null;
}
