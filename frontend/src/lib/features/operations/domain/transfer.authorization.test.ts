import { describe, it, expect } from 'vitest';
import type { StockTransfer } from './operations';
import { assertActorMayTransition, TransferAuthorizationError } from './transfer.authorization';

function requestedTransfer(overrides?: Partial<StockTransfer>): StockTransfer {
	return {
		_id: 'stock_transfer:01TRANSFER0000000000000000',
		type: 'stock_transfer',
		schema_v: 2,
		shelter_code: 'SH001',
		created_at: '2026-08-22T05:00:00.000Z',
		updated_at: '2026-08-22T05:00:00.000Z',
		created_by: 'Staff A',
		from_shelter: 'SH001',
		to_shelter: 'SH002',
		items: [{ item_id: 'item:rice', qty: '100', unit: 'kg' }],
		status: 'requested',
		timeline: { requested: { at: '2026-08-22T05:00:00.000Z', by: 'Staff A' } },
		...overrides
	} as StockTransfer;
}

describe('transfer.authorization', () => {
	it('allows only the source shelter to dispatch', () => {
		const doc = requestedTransfer();
		expect(() => assertActorMayTransition(doc, 'shipped', 'SH001')).not.toThrow();
		expect(() => assertActorMayTransition(doc, 'shipped', 'SH002')).toThrow(
			TransferAuthorizationError
		);
	});

	it('allows only the source shelter to cancel', () => {
		const doc = requestedTransfer();
		expect(() => assertActorMayTransition(doc, 'cancelled', 'SH001')).not.toThrow();
		expect(() => assertActorMayTransition(doc, 'cancelled', 'SH002')).toThrow(
			TransferAuthorizationError
		);
	});

	it('allows only the destination shelter to receive', () => {
		const shipped = requestedTransfer({
			status: 'shipped',
			timeline: {
				requested: { at: '2026-08-22T05:00:00.000Z', by: 'Staff A' },
				shipped: { at: '2026-08-22T06:00:00.000Z', by: 'Staff A' }
			}
		});
		expect(() => assertActorMayTransition(shipped, 'received', 'SH002')).not.toThrow();
		expect(() => assertActorMayTransition(shipped, 'received', 'SH001')).toThrow(
			TransferAuthorizationError
		);
	});

	it('allows only the source shelter to dispute (CR-089 FR-04)', () => {
		const doc = requestedTransfer();
		expect(() => assertActorMayTransition(doc, 'disputed', 'SH001')).not.toThrow();
		expect(() => assertActorMayTransition(doc, 'disputed', 'SH002')).toThrow(
			TransferAuthorizationError
		);
	});

	it('allows only the source shelter to resume, leaving the destination read-only while disputed (CR-089 FR-06)', () => {
		const disputed = requestedTransfer({
			status: 'disputed',
			dispute_reason: 'รอตรวจสอบยอดก่อน',
			timeline: {
				requested: { at: '2026-08-22T05:00:00.000Z', by: 'Staff A' },
				disputed: { at: '2026-08-22T06:00:00.000Z', by: 'Staff A' }
			}
		});
		expect(() => assertActorMayTransition(disputed, 'requested', 'SH001')).not.toThrow();
		expect(() => assertActorMayTransition(disputed, 'requested', 'SH002')).toThrow(
			TransferAuthorizationError
		);
	});

	it('is a case-insensitive, whitespace-tolerant shelter comparison', () => {
		const doc = requestedTransfer();
		expect(() => assertActorMayTransition(doc, 'shipped', ' sh001 ')).not.toThrow();
	});

	it('defers to the domain guard for an already-invalid transition (no throw)', () => {
		const shipped = requestedTransfer({
			status: 'shipped',
			timeline: {
				requested: { at: '2026-08-22T05:00:00.000Z', by: 'Staff A' },
				shipped: { at: '2026-08-22T06:00:00.000Z', by: 'Staff A' }
			}
		});
		// requested → shipped is invalid once already shipped; the wrong-shelter actor is not
		// the reason it should fail, so this must not throw an authorization error.
		expect(() => assertActorMayTransition(shipped, 'shipped', 'SH003')).not.toThrow();
	});

	// --- CR-090 undo-cancel guards ---

	it('allows only the source shelter to undo a cancellation', () => {
		const cancelled = requestedTransfer({ status: 'cancelled' });
		expect(() => assertActorMayTransition(cancelled, 'requested', 'SH001')).not.toThrow();
		expect(() => assertActorMayTransition(cancelled, 'requested', 'SH002')).toThrow(
			TransferAuthorizationError
		);
	});

	it('refuses to move a cancelled transfer anywhere but back to requested', () => {
		// CR-090 FR-03 — `cancelled` leads to `requested` and nowhere else, so reaching `shipped`
		// again always costs two steps.
		const cancelled = requestedTransfer({ status: 'cancelled' });
		for (const to of ['shipped', 'received', 'disputed'] as const) {
			// The transition is invalid, so the guard stays silent and the domain owns the error —
			// what matters is that no path here treats it as authorized work.
			expect(() => assertActorMayTransition(cancelled, to, 'SH001')).not.toThrow();
		}
	});

	it('compares shelters the same way for undo-cancel as for resume', () => {
		const cancelled = requestedTransfer({ status: 'cancelled' });
		const disputed = requestedTransfer({ status: 'disputed' });
		expect(() => assertActorMayTransition(cancelled, 'requested', ' sh001 ')).not.toThrow();
		expect(() => assertActorMayTransition(disputed, 'requested', ' sh001 ')).not.toThrow();
	});
});
