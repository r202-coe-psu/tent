import { describe, expect, it } from 'vitest';
import {
	evaluatePersonQr,
	looksLikePersonQr,
	parsePersonQr,
	personQrVerdictMessage
} from './evacuee-qr';

const ULID = '01JC8ZQ4V6M2N5R7T9XBDEFGH0';
const prints = [
	{ printed_at: '2026-11-03T02:10:00.000Z', hash: '289170' },
	{ printed_at: '2026-11-05T09:41:12.512Z', hash: '2d23a3' }
];

describe('parsePersonQr', () => {
	it('accepts legacy and hashed payloads', () => {
		expect(parsePersonQr(`evacuee:${ULID}`)).toEqual({
			evacuee_id: `evacuee:${ULID}`,
			hash6: null
		});
		expect(parsePersonQr(` evacuee:${ULID}@2D23A3 `)).toEqual({
			evacuee_id: `evacuee:${ULID}`,
			hash6: '2d23a3'
		});
	});
	it('normalizes case', () => {
		expect(parsePersonQr(`EVACUEE:${ULID.toLowerCase()}@abcdef`)?.evacuee_id).toBe(
			`evacuee:${ULID}`
		);
	});
	it('rejects malformed @ suffix', () => {
		expect(parsePersonQr(`evacuee:${ULID}@12345`)).toBeNull();
		expect(parsePersonQr(`evacuee:${ULID}@12345g`)).toBeNull();
		expect(parsePersonQr(`evacuee:${ULID}@`)).toBeNull();
		expect(parsePersonQr(ULID)).toBeNull();
		expect(looksLikePersonQr(`evacuee:${ULID}@zz`)).toBe(true);
		expect(looksLikePersonQr(ULID)).toBe(false);
	});
});

describe('evaluatePersonQr (FR-EQR-27)', () => {
	it('row 1: no @, empty log → valid', () => {
		expect(evaluatePersonQr(null, [])).toEqual({ status: 'valid' });
	});
	it('row 2: no @, has entries → expired with null issued_at', () => {
		expect(evaluatePersonQr(null, prints)).toEqual({
			status: 'expired',
			issued_at: null,
			current_printed_at: '2026-11-05T09:41:12.512Z'
		});
	});
	it('row 3: latest hash → valid', () => {
		expect(evaluatePersonQr('2d23a3', prints)).toEqual({ status: 'valid' });
	});
	it('row 4: older hash → expired', () => {
		expect(evaluatePersonQr('289170', prints)).toEqual({
			status: 'expired',
			issued_at: '2026-11-03T02:10:00.000Z',
			current_printed_at: '2026-11-05T09:41:12.512Z'
		});
	});
	it('row 5: unknown hash or empty log → invalid', () => {
		expect(evaluatePersonQr('ffffff', prints)).toEqual({ status: 'invalid' });
		expect(evaluatePersonQr('ffffff', [])).toEqual({ status: 'invalid' });
	});
});

describe('personQrVerdictMessage', () => {
	it('contains dates only', () => {
		expect(personQrVerdictMessage({ status: 'invalid' })).toBe('QR ไม่ถูกต้อง');
		expect(
			personQrVerdictMessage({
				status: 'expired',
				issued_at: null,
				current_printed_at: prints[1].printed_at
			})
		).toContain('ออกก่อนเปลี่ยนระบบ');
	});
});
