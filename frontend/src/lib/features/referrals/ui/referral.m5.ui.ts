/**
 * Labels and messages for the M5 dispatch mode (draft CR — referral M5 integration §2, §4).
 * Status is always shown as text + icon, never by colour alone.
 */
import type { IntegrationState } from '../data/referral.m5.remote';
import { M5RequestError } from '../data/referral.m5.remote';
import type { Acuity, M5TransferStatus, VehicleType } from '../domain/referral.schema';

/** User-facing text of each health-gate state (CR §2 table). `ready` has none. */
export const M5_GATE_MESSAGES: Record<Exclude<IntegrationState, 'ready'>, string> = {
	central_unreachable: 'เชื่อมต่อกับระบบกลางไม่ได้',
	m5_unavailable: 'เชื่อมต่อ OneData ระบบส่งต่อผู้ป่วย (M5) ไม่ได้ ชั่วคราว',
	m5_not_configured: 'OneData ระบบส่งต่อผู้ป่วย (M5) ยังไม่พร้อม ติดต่อผู้ดูแลระบบ',
	m5_credential_invalid: 'OneData ระบบส่งต่อผู้ป่วย (M5) ยังไม่พร้อม ติดต่อผู้ดูแลระบบ'
};

export type M5StatusTone = 'sky' | 'emerald' | 'red' | 'amber' | 'muted';

export const M5_STATUS_META: Record<M5TransferStatus, { label: string; tone: M5StatusTone }> = {
	awaiting_review: { label: 'รอ สธ. พิจารณา', tone: 'amber' },
	pending: { label: 'สธ. อนุมัติแล้ว รอรถออก', tone: 'sky' },
	rejected: { label: 'สธ. ไม่อนุมัติ', tone: 'red' },
	in_transit: { label: 'กำลังเดินทางไปโรงพยาบาล', tone: 'sky' },
	arrived: { label: 'ถึงโรงพยาบาลแล้ว', tone: 'emerald' },
	cancelled: { label: 'ยกเลิกแล้ว', tone: 'muted' }
};

export const M5_TONE_BADGE: Record<M5StatusTone, string> = {
	sky: 'border border-sky-200 bg-sky-50 text-sky-900',
	emerald: 'border border-emerald-200 bg-emerald-50 text-emerald-900',
	red: 'border border-red-200 bg-red-50 text-red-900',
	amber: 'border border-amber-200 bg-amber-50 text-amber-900',
	muted: 'border border-slate-200 bg-slate-100 text-slate-700'
};

export const ACUITY_OPTIONS: readonly { value: Acuity; label: string; selected: string }[] = [
	{ value: 'red', label: 'แดง', selected: 'border-red-600 bg-red-600 text-white' },
	{ value: 'yellow', label: 'เหลือง', selected: 'border-amber-500 bg-amber-400 text-amber-950' },
	{ value: 'green', label: 'เขียว', selected: 'border-emerald-600 bg-emerald-600 text-white' },
	{ value: 'black', label: 'ดำ', selected: 'border-slate-900 bg-slate-900 text-white' }
];

export const VEHICLE_OPTIONS: readonly { value: VehicleType; label: string }[] = [
	{ value: 'ambulance', label: 'รถพยาบาล' },
	{ value: 'van', label: 'รถตู้' },
	{ value: 'helicopter', label: 'เฮลิคอปเตอร์' },
	{ value: 'other', label: 'อื่น ๆ' }
];

const M5_ERROR_MESSAGES: Record<string, string> = {
	CANCEL_NEEDS_MOPH: 'ใบนี้ สธ. อนุมัติแล้ว โทรประสาน สธ. เพื่อยกเลิก',
	NOT_PENDING: 'แจ้งรถออกได้หลัง สธ. อนุมัติแล้วเท่านั้น',
	ALREADY_CLOSED: 'ใบนี้จบไปแล้วใน OneData ระบบจะอัปเดตสถานะให้อัตโนมัติ',
	CENTRAL_UNAVAILABLE: 'เชื่อมต่อกับระบบกลางไม่ได้',
	M5_UNAVAILABLE: 'เชื่อมต่อ OneData ระบบส่งต่อผู้ป่วย (M5) ไม่ได้ ชั่วคราว',
	M5_CREDENTIAL_INVALID: 'OneData ระบบส่งต่อผู้ป่วย (M5) ยังไม่พร้อม ติดต่อผู้ดูแลระบบ',
	M5_NOT_CONFIGURED: 'OneData ระบบส่งต่อผู้ป่วย (M5) ยังไม่พร้อม ติดต่อผู้ดูแลระบบ',
	M5_DESTINATION_NOT_FOUND: 'ไม่พบโรงพยาบาลปลายทางใน OneData กรุณาเลือกใหม่',
	EXTERNALLY_MANAGED: 'ใบนี้จัดการผ่าน OneData (M5) เป็นชุด'
};

/** Toast text for a failed M5 action: the known code's message, else the server's. */
export function m5ErrorMessage(err: unknown): string {
	if (err instanceof M5RequestError && err.code && M5_ERROR_MESSAGES[err.code]) {
		return M5_ERROR_MESSAGES[err.code];
	}
	return err instanceof Error ? err.message : 'เกิดข้อผิดพลาด';
}
