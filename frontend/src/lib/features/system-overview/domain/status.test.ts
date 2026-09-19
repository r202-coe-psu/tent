import { describe, expect, it } from 'vitest';
import { getPreRegStatusInfo } from './status';

describe('getPreRegStatusInfo', () => {
	it('identifies active as entered into shelter', () => {
		const res = getPreRegStatusInfo('active', 'checked_in@SH001', true);
		expect(res.label).toBe('เข้าศูนย์แล้ว (อยู่ในศูนย์)');
		expect(res.isEntered).toBe(true);
		expect(res.dotColor).toBe('bg-emerald-500');
	});

	it('identifies room_confirmed as entered and zoned', () => {
		const res = getPreRegStatusInfo('room_confirmed', 'room_confirmed@SH001', true);
		expect(res.label).toBe('เข้าศูนย์แล้ว (จัดห้องแล้ว)');
		expect(res.isEntered).toBe(true);
	});

	it('identifies arriving as not yet entered', () => {
		const res = getPreRegStatusInfo('arriving', 'arriving@SH001', true);
		expect(res.label).toBe('กำลังรายงานตัว');
		expect(res.isEntered).toBe(false);
	});

	it('identifies pre_registered with shelter as bound waiting', () => {
		const res = getPreRegStatusInfo('pre_registered', 'pre_registered@SH001', true);
		expect(res.label).toBe('รอเข้าศูนย์ (ผูกศูนย์แล้ว)');
		expect(res.isEntered).toBe(false);
	});

	it('identifies unassigned or shelter-less pre-registration', () => {
		const res = getPreRegStatusInfo('unassigned', 'unassigned', false);
		expect(res.label).toBe('ยังไม่ผูกศูนย์');
		expect(res.isEntered).toBe(false);
	});

	it('identifies temporary_leave', () => {
		const res = getPreRegStatusInfo('temporary_leave', 'temporary_leave@SH001', true);
		expect(res.label).toBe('ออกชั่วคราว');
		expect(res.isEntered).toBe(true);
	});

	it('identifies checked_out', () => {
		const res = getPreRegStatusInfo('checked_out', 'checked_out@SH001', true);
		expect(res.label).toBe('ออกจากศูนย์แล้ว');
		expect(res.isEntered).toBe(true);
	});

	it('falls back to parsing queue_status when stay_status is null', () => {
		const res = getPreRegStatusInfo(null, 'checked_in@SH002', true);
		expect(res.label).toBe('เข้าศูนย์แล้ว (อยู่ในศูนย์)');
		expect(res.isEntered).toBe(true);
	});
});
