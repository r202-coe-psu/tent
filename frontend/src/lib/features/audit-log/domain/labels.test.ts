import { describe, expect, it } from 'vitest';
import { auditChangeValue, auditEntityLabel, auditEventLabel } from './labels';

describe('audit labels', () => {
	it('labels known events, role grants and falls back to the raw code', () => {
		expect(auditEventLabel('shelter.updated')).toBe('แก้ไขข้อมูลศูนย์');
		expect(auditEventLabel('role_grant.issued')).toBe('สิทธิ์ชั่วคราว (issued)');
		expect(auditEventLabel('something.new')).toBe('something.new');
	});

	it('labels entity types', () => {
		expect(auditEntityLabel('shelter')).toBe('ศูนย์พักพิง');
		expect(auditEntityLabel('evacuee')).toBe('evacuee');
	});

	it('formats change values', () => {
		expect(auditChangeValue(null)).toBe('—');
		expect(auditChangeValue(['a', 'b'])).toBe('a, b');
		expect(auditChangeValue(true)).toBe('ใช่');
		expect(auditChangeValue(150)).toBe('150');
	});
});
