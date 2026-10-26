import { describe, expectTypeOf, it } from 'vitest';
import { createLegacyFlow2StockLedger, createStockLedger } from './operations';
import type { AdjustReason, LedgerReason, StockLedgerInput } from './operations';
import type { AuthorContext } from '$lib/db/model';

/**
 * #780 — CR-143 §C as a compile-time rule. These assertions are checked by `pnpm check`
 * (svelte-check), not by the vitest run: a `@ts-expect-error` that stops erroring fails the check.
 * The runtime guard (Zod `superRefine`) is covered in `adjust-reason.test.ts`.
 */
const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'staff1' };
const base = { item_id: 'item:rice', qty: '-2', unit: 'kg', ref_id: null } as const;
const lot = { lot_ref: 'stock_ledger:01J' } as const;

describe('StockLedgerInput is discriminated on reason (#780)', () => {
	it('requires adjust_reason on reason=adjust', () => {
		expectTypeOf<
			Extract<StockLedgerInput, { reason: 'adjust' }>['adjust_reason']
		>().toEqualTypeOf<AdjustReason>();

		const accepted: StockLedgerInput = { ...base, reason: 'adjust', adjust_reason: 'lost' };
		const withNote: StockLedgerInput = {
			...base,
			reason: 'adjust',
			adjust_reason: 'other',
			note: 'spilled'
		};
		expectTypeOf(accepted).toExtend<StockLedgerInput>();
		expectTypeOf(withNote).toExtend<StockLedgerInput>();

		// @ts-expect-error -- adjust without adjust_reason
		const missing: StockLedgerInput = { ...base, reason: 'adjust' };
		// @ts-expect-error -- adjust without adjust_reason (call site)
		void (() => createStockLedger({ ...base, reason: 'adjust' }, ctx));
		// @ts-expect-error -- adjust without adjust_reason (legacy Flow 2 writer)
		void (() => createLegacyFlow2StockLedger({ ...base, reason: 'adjust' }, ctx));
		void missing;
	});

	it('forbids adjust_reason and note on every other reason', () => {
		expectTypeOf<Exclude<StockLedgerInput['reason'], 'adjust'>>().toEqualTypeOf<
			Exclude<LedgerReason, 'adjust'>
		>();

		const plain: StockLedgerInput = { ...base, reason: 'distribute', ...lot };
		expectTypeOf(plain).toExtend<StockLedgerInput>();

		const withReason: StockLedgerInput = {
			...base,
			reason: 'distribute',
			...lot,
			// @ts-expect-error -- distribute with adjust_reason
			adjust_reason: 'lost'
		};
		// @ts-expect-error -- distribute with note
		const withNote: StockLedgerInput = { ...base, reason: 'distribute', ...lot, note: 'x' };
		// @ts-expect-error -- adjust_reason on a non-adjust reason (call site)
		void (() => createStockLedger({ ...base, reason: 'donation', adjust_reason: 'lost' }, ctx));
		void (() =>
			createLegacyFlow2StockLedger(
				// @ts-expect-error -- adjust_reason on a non-adjust reason (legacy Flow 2 writer)
				{ ...base, reason: 'donation', adjust_reason: 'lost' },
				ctx
			));
		void withReason;
		void withNote;
	});

	it('rejects a widened LedgerReason that is not narrowed first', () => {
		const reason = 'adjust' as LedgerReason;
		// @ts-expect-error -- a non-literal reason must be narrowed before choosing the shape
		void (() => createStockLedger({ ...base, reason }, ctx));
	});
});
