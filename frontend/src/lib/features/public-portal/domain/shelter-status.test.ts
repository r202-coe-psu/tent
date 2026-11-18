import { describe, expect, it } from 'vitest';
import { shelterStatusClass, shelterStatusLabel } from './shelter-status';

const labels = {
	statusOpen: 'เปิด',
	statusFull: 'เต็ม',
	statusPrepare: 'เตรียมพร้อม',
	statusUnknown: 'ไม่ทราบสถานะ',
	statusClosed: 'ปิด'
};

describe('shelterStatusClass', () => {
	it('colours each known status', () => {
		expect(shelterStatusClass('OPEN')).toContain('text-success');
		expect(shelterStatusClass('FULL')).toContain('text-danger');
		expect(shelterStatusClass('PREPARE')).toContain('text-warning');
	});

	it('keeps UNKNOWN neutral and apart from the yellow of standby (CR-252 FR-20)', () => {
		expect(shelterStatusClass('UNKNOWN')).toContain('slate');
		expect(shelterStatusClass('UNKNOWN')).not.toContain('warning');
	});

	it('falls back to muted for CLOSED and anything unrecognised', () => {
		expect(shelterStatusClass('CLOSED')).toContain('text-muted-foreground');
		expect(shelterStatusClass('whatever')).toContain('text-muted-foreground');
	});
});

describe('shelterStatusLabel', () => {
	it('reads each known status from the labels', () => {
		expect(shelterStatusLabel('OPEN', labels)).toBe('เปิด');
		expect(shelterStatusLabel('FULL', labels)).toBe('เต็ม');
		expect(shelterStatusLabel('PREPARE', labels)).toBe('เตรียมพร้อม');
		expect(shelterStatusLabel('UNKNOWN', labels)).toBe('ไม่ทราบสถานะ');
	});

	it('reads anything else as closed', () => {
		expect(shelterStatusLabel('CLOSED', labels)).toBe('ปิด');
		expect(shelterStatusLabel('???', labels)).toBe('ปิด');
	});
});
