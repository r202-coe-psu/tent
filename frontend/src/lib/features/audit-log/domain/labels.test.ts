import { describe, expect, it } from 'vitest';
import { auditChangeValue, auditEntityLabel, auditEventLabel } from './labels';

describe('audit labels', () => {
	it('labels known events, role grants and falls back to the raw code', () => {
		expect(auditEventLabel('shelter.updated')).toBe('แก้ไขข้อมูลศูนย์');
		expect(auditEventLabel('role_grant.issued')).toBe('สิทธิ์ชั่วคราว (issued)');
		expect(auditEventLabel('something.new')).toBe('something.new');
		expect(auditEventLabel('evacuee.updated')).toBe('แก้ไขผู้อพยพ');
		expect(auditEventLabel('item_master.deleted')).toBe('ลบสินค้า');
		expect(auditEventLabel('user.staff_card_rotated')).toBe('หมุนบัตร QR เจ้าหน้าที่');
	});

	it('labels entity types', () => {
		expect(auditEntityLabel('shelter')).toBe('ศูนย์พักพิง');
		expect(auditEntityLabel('evacuee')).toBe('ผู้อพยพ');
		expect(auditEntityLabel('stock_transfer')).toBe('stock_transfer');
	});

	it('formats change values', () => {
		expect(auditChangeValue(null)).toBe('—');
		expect(auditChangeValue(['a', 'b'])).toBe('a, b');
		expect(auditChangeValue(true)).toBe('ใช่');
		expect(auditChangeValue(150)).toBe('150');
	});

	it('shows nested values as JSON instead of [object Object]', () => {
		expect(auditChangeValue({ status: 'arrived', zone: 'B' })).toBe(
			'{"status":"arrived","zone":"B"}'
		);
		expect(auditChangeValue([{ item_id: 'rice', qty: 2 }])).toBe('[{"item_id":"rice","qty":2}]');
		expect(auditChangeValue([])).toBe('—');
	});
});
