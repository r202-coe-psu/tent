import { describe, expect, it } from 'vitest';
import { countPendingTransfers, isTransferPending } from './transfer-pending';
import type { TransferStatus } from './operations';

const t = (from: string, to: string, status: TransferStatus) => ({
	from_shelter: from,
	to_shelter: to,
	status
});

describe('isTransferPending', () => {
	it('outgoing: requested and disputed need us, the rest do not', () => {
		expect(isTransferPending(t('A', 'B', 'requested'), 'A')).toBe(true);
		expect(isTransferPending(t('A', 'B', 'disputed'), 'A')).toBe(true);
		expect(isTransferPending(t('A', 'B', 'shipped'), 'A')).toBe(false);
		expect(isTransferPending(t('A', 'B', 'received'), 'A')).toBe(false);
		expect(isTransferPending(t('A', 'B', 'cancelled'), 'A')).toBe(false);
	});

	it('incoming: only shipped needs us', () => {
		expect(isTransferPending(t('B', 'A', 'shipped'), 'A')).toBe(true);
		expect(isTransferPending(t('B', 'A', 'requested'), 'A')).toBe(false);
		expect(isTransferPending(t('B', 'A', 'disputed'), 'A')).toBe(false);
	});

	it('ignores transfers between other shelters', () => {
		expect(isTransferPending(t('B', 'C', 'requested'), 'A')).toBe(false);
	});
});

describe('countPendingTransfers', () => {
	it('counts only the pending ones', () => {
		expect(
			countPendingTransfers(
				[
					t('A', 'B', 'requested'),
					t('B', 'A', 'shipped'),
					t('A', 'B', 'received'),
					t('B', 'A', 'requested')
				],
				'A'
			)
		).toBe(2);
	});

	it('is 0 for none', () => {
		expect(countPendingTransfers([], 'A')).toBe(0);
	});
});
