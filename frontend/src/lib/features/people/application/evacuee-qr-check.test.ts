import { describe, expect, it, vi } from 'vitest';
import { checkPersonQr, staffPersonQrRejectionMessage } from './evacuee-qr-check';

const ID = 'evacuee:01JC8ZQ4V6M2N5R7T9XBDEFGH0';
const OLD = { printed_at: '2026-11-03T02:10:00.000Z', hash: '289170' };
const NEW = { printed_at: '2026-11-05T09:41:12.512Z', hash: '2d23a3' };

describe('checkPersonQr', () => {
	it('reads the log of the scanned evacuee and applies the 5-row rule', async () => {
		const read = vi.fn().mockResolvedValue([OLD, NEW]);
		expect(await checkPersonQr({ evacuee_id: ID, hash6: '2d23a3' }, read)).toEqual({
			status: 'valid'
		});
		expect(read).toHaveBeenCalledWith(ID);
		expect(await checkPersonQr({ evacuee_id: ID, hash6: '289170' }, read)).toEqual({
			status: 'expired',
			issued_at: OLD.printed_at,
			current_printed_at: NEW.printed_at
		});
		expect(await checkPersonQr({ evacuee_id: ID, hash6: 'ffffff' }, read)).toEqual({
			status: 'invalid'
		});
		expect(await checkPersonQr({ evacuee_id: ID, hash6: null }, read)).toMatchObject({
			status: 'expired',
			issued_at: null
		});
	});

	it('treats a missing doc (empty log) as valid for legacy and invalid for hashed', async () => {
		const read = vi.fn().mockResolvedValue([]);
		expect(await checkPersonQr({ evacuee_id: ID, hash6: null }, read)).toEqual({ status: 'valid' });
		expect(await checkPersonQr({ evacuee_id: ID, hash6: '2d23a3' }, read)).toEqual({
			status: 'invalid'
		});
	});

	it('propagates read errors instead of reporting valid', async () => {
		const read = vi.fn().mockRejectedValue(new Error('network'));
		await expect(checkPersonQr({ evacuee_id: ID, hash6: null }, read)).rejects.toThrow('network');
	});
});

describe('staffPersonQrRejectionMessage', () => {
	it('adds the search-by-name hint to the shared copy', () => {
		expect(staffPersonQrRejectionMessage({ status: 'invalid' })).toBe(
			'QR ไม่ถูกต้อง — ลองค้นหาด้วยชื่อแทน'
		);
		const expired = staffPersonQrRejectionMessage({
			status: 'expired',
			issued_at: null,
			current_printed_at: NEW.printed_at
		});
		expect(expired).toContain('มีใบใหม่วันที่');
		expect(expired).toContain('ค้นหาด้วยชื่อ');
		expect(staffPersonQrRejectionMessage({ status: 'invalid' }, 'en')).toBe(
			'Invalid QR — try searching by name instead'
		);
		expect(
			staffPersonQrRejectionMessage(
				{ status: 'expired', issued_at: null, current_printed_at: NEW.printed_at },
				'en'
			)
		).toContain('A new one was issued on');
	});
});
