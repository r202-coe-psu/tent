import { describe, expect, it } from 'vitest';
import { CentralWarehouseError } from '../data/central-warehouse.remote';
import { formatQty, m6ErrorMessage, warehouseMapHref } from './central-warehouse.ui';

describe('m6ErrorMessage', () => {
	it('maps a known code to Thai', () => {
		expect(m6ErrorMessage(new CentralWarehouseError(409, 'M6_NOT_CANCELLABLE', 'x'))).toContain(
			'ประสาน M6'
		);
		expect(m6ErrorMessage(new CentralWarehouseError(403, 'M6_FORBIDDEN', 'x'))).toBe(
			'ยังไม่ได้รับสิทธิ์เบิกของจาก M6 ติดต่อผู้ดูแลระบบ'
		);
	});

	it('names the expected unit on a unit mismatch', () => {
		const err = new CentralWarehouseError(422, 'M6_UNIT_MISMATCH', 'x', { expected_unit: 'ลัง' });
		expect(m6ErrorMessage(err)).toContain('ลัง');
	});

	it('keeps the server text for SHELTER_LOCATION_MISSING and unknown codes', () => {
		expect(
			m6ErrorMessage(new CentralWarehouseError(422, 'SHELTER_LOCATION_MISSING', 'ตั้งพิกัดก่อน'))
		).toBe('ตั้งพิกัดก่อน');
		expect(m6ErrorMessage(new Error('boom'))).toBe('boom');
		expect(m6ErrorMessage('x')).toBe('เกิดข้อผิดพลาด');
	});
});

describe('helpers', () => {
	it('formats quantities and tolerates null', () => {
		expect(formatQty(1200)).toBe('1,200');
		expect(formatQty(null)).toBe('–');
	});

	it('links a map only when the warehouse has coordinates', () => {
		expect(warehouseMapHref({ lat: 7.9, lng: 98.4 })).toContain('mlat=7.9&mlon=98.4');
		expect(warehouseMapHref({ lat: null, lng: 98.4 })).toBeNull();
		expect(warehouseMapHref({})).toBeNull();
	});
});
