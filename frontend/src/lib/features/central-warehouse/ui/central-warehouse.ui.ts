/**
 * Labels and messages for the central warehouse (M6) page (draft CR M6 §2, §4).
 * Status is always shown as text + icon, never by colour alone.
 */
import { CentralWarehouseError } from '../data/central-warehouse.remote';
import type { M6StatusTone } from '../domain/central-warehouse.schema';

export const M6_TONE_BADGE: Record<M6StatusTone, string> = {
	sky: 'border border-sky-200 bg-sky-50 text-sky-900',
	emerald: 'border border-emerald-200 bg-emerald-50 text-emerald-900',
	red: 'border border-red-200 bg-red-50 text-red-900',
	amber: 'border border-amber-200 bg-amber-50 text-amber-900',
	muted: 'border border-slate-200 bg-slate-100 text-slate-700'
};

/** A key that holds no resource type may not request anything (CR §4). */
export const M6_NO_RESOURCE_TYPES_MESSAGE = 'ยังไม่ได้รับสิทธิ์เบิกของจาก M6 ติดต่อผู้ดูแลระบบ';

const M6_ERROR_MESSAGES: Record<string, string> = {
	M6_ITEM_NOT_IN_WAREHOUSE: 'มีบางรายการที่คลังนี้ไม่มี กรุณาตรวจสอบสต็อกของคลังอีกครั้ง',
	M6_REFERENCE_NOT_FOUND: 'ไม่พบสินค้าบางรายการในระบบ M6 กรุณาเลือกรายการใหม่',
	M6_BAD_REQUEST: 'M6 ไม่รับคำขอนี้ กรุณาตรวจสอบข้อมูลในตะกร้า',
	M6_NOT_CANCELLABLE: 'M6 พิจารณาใบนี้แล้ว ยกเลิกไม่ได้ กรุณาประสาน M6',
	M6_STOCK_INSUFFICIENT: 'สต็อกของคลังต้นทางไม่พอสำหรับบางรายการ',
	M6_FORBIDDEN: M6_NO_RESOURCE_TYPES_MESSAGE,
	M6_NOT_FOUND: 'ไม่พบข้อมูลที่ขอใน M6',
	CENTRAL_UNAVAILABLE: 'เชื่อมต่อกับระบบกลางไม่ได้',
	M6_UNAVAILABLE: 'เชื่อมต่อ OneData ระบบบริหารทรัพยากร (M6) ไม่ได้ ชั่วคราว',
	M6_CREDENTIAL_INVALID: 'OneData ระบบบริหารทรัพยากร (M6) ยังไม่พร้อม ติดต่อผู้ดูแลระบบ',
	M6_NOT_CONFIGURED: 'OneData ระบบบริหารทรัพยากร (M6) ยังไม่พร้อม ติดต่อผู้ดูแลระบบ'
};

/** Toast text for a failed M6 action: the known code's message, else the server's own. */
export function m6ErrorMessage(err: unknown): string {
	if (err instanceof CentralWarehouseError && err.code) {
		if (err.code === 'M6_UNIT_MISMATCH') {
			const expected = err.extra.expected_unit;
			return typeof expected === 'string' && expected
				? `หน่วยไม่ตรงกับคลัง (หน่วยที่ถูกต้อง: ${expected})`
				: 'หน่วยไม่ตรงกับคลัง กรุณาเลือกรายการใหม่';
		}
		const known = M6_ERROR_MESSAGES[err.code];
		if (known) return known;
	}
	return err instanceof Error ? err.message : 'เกิดข้อผิดพลาด';
}

const NUMBER = new Intl.NumberFormat('th-TH');

/** Whole-number quantity with thousands separators. */
export function formatQty(n: number | null | undefined): string {
	return n == null ? '–' : NUMBER.format(n);
}

/** OpenStreetMap link for a warehouse with coordinates, else `null`. */
export function warehouseMapHref(w: { lat?: number | null; lng?: number | null }): string | null {
	if (typeof w.lat !== 'number' || typeof w.lng !== 'number') return null;
	return `https://www.openstreetmap.org/?mlat=${w.lat}&mlon=${w.lng}#map=15/${w.lat}/${w.lng}`;
}
