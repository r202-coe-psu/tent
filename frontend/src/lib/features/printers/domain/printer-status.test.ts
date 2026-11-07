import { describe, expect, it } from 'vitest';
import { isPrinterOnline } from './printer-status';

describe('isPrinterOnline', () => {
	const serverNow = new Date('2026-10-22T03:00:00.000Z');
	const ready = {
		status: 'active' as const,
		last_seen_at: '2026-10-22T02:58:30.000Z', // exactly 90 s before serverNow
		queue_state: 'ready' as const
	};

	it('is online when last seen exactly 90 s ago', () => {
		expect(isPrinterOnline(ready, serverNow)).toBe(true);
	});

	it('is offline when last seen 91 s ago', () => {
		expect(isPrinterOnline({ ...ready, last_seen_at: '2026-10-22T02:58:29.000Z' }, serverNow)).toBe(
			false
		);
	});

	it('is offline when the printer is inactive', () => {
		expect(isPrinterOnline({ ...ready, status: 'inactive' }, serverNow)).toBe(false);
	});

	it('is offline when the queue is not ready', () => {
		expect(isPrinterOnline({ ...ready, queue_state: 'disabled' }, serverNow)).toBe(false);
	});

	it('is offline when never seen', () => {
		expect(isPrinterOnline({ ...ready, last_seen_at: null }, serverNow)).toBe(false);
	});
});
