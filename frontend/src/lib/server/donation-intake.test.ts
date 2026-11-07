import { describe, it, expect, vi, beforeEach } from 'vitest';
import { assertDonationLedgerRows, authorizeDonation } from './donation-intake';
import { requireShelterScopeOrSA, type Caller } from '$lib/server/couch-admin';
import type { StockLedger } from '$lib/features/operations/server';

vi.mock('$lib/server/couch-admin', () => ({
	adminRaw: vi.fn(),
	requireShelterScopeOrSA: vi.fn()
}));

const caller = (roles: string[], shelterCode: string | null, isSA = false): Caller => ({
	name: 'u',
	roles,
	isSA,
	shelterCode
});

async function outcome(c: Caller): Promise<number | 'allowed'> {
	vi.mocked(requireShelterScopeOrSA).mockResolvedValue(c);
	try {
		await authorizeDonation('cookie');
		return 'allowed';
	} catch (e) {
		return (e as { status: number }).status;
	}
}

describe('authorizeDonation', () => {
	beforeEach(() => vi.resetAllMocks());

	it('admits SA, shelter_manager and warehouse_staff as before', async () => {
		expect(await outcome(caller(['system_admin'], null, true))).toBe('allowed');
		expect(await outcome(caller(['shelter:SH001', 'SH001:shelter_manager'], 'SH001'))).toBe(
			'allowed'
		);
		expect(await outcome(caller(['shelter:SH001', 'SH001:warehouse_staff'], 'SH001'))).toBe(
			'allowed'
		);
		expect(await outcome(caller(['shelter:SH001', 'warehouse_staff'], 'SH001'))).toBe('allowed');
	});

	it('keeps warehouse_staff unscoped to a shelter (#477, unchanged)', async () => {
		expect(await outcome(caller(['shelter:SH001', 'SH002:warehouse_staff'], 'SH001'))).toBe(
			'allowed'
		);
	});

	it('admits donation_staff of its own shelter, compound or flat with one shelter', async () => {
		expect(await outcome(caller(['shelter:SH001', 'SH001:donation_staff'], 'SH001'))).toBe(
			'allowed'
		);
		expect(await outcome(caller(['shelter:SH001', 'donation_staff'], 'SH001'))).toBe('allowed');
	});

	it('refuses donation_staff of another shelter than the caller scope', async () => {
		expect(await outcome(caller(['shelter:SH001', 'SH002:donation_staff'], 'SH001'))).toBe(403);
		expect(
			await outcome(caller(['shelter:SH001', 'shelter:SH002', 'SH002:donation_staff'], 'SH001'))
		).toBe(403);
	});

	it('refuses donation_staff without a shelter scope', async () => {
		expect(await outcome(caller(['SH001:donation_staff'], null))).toBe(403);
	});

	it.each(['registration_staff', 'supply_coordinator', 'distribution_staff', 'kitchen_staff'])(
		'still refuses %s (supply_coordinator 403 is a known pre-existing gap)',
		async (cap) => {
			expect(await outcome(caller(['shelter:SH001', `SH001:${cap}`], 'SH001'))).toBe(403);
		}
	);
});

describe('assertDonationLedgerRows', () => {
	const row = (over: Partial<StockLedger> = {}) =>
		({
			_id: 'stock_ledger:01J',
			type: 'stock_ledger',
			reason: 'donation',
			qty: '5',
			...over
		}) as StockLedger;

	it('accepts positive donation rows', () => {
		expect(() => assertDonationLedgerRows([row(), row({ qty: '0.5' })])).not.toThrow();
	});

	it.each([
		['adjust', { reason: 'adjust' }],
		['distribute', { reason: 'distribute' }],
		['receive', { reason: 'receive' }],
		['a zero quantity', { qty: '0' }],
		['a negative quantity', { qty: '-5' }]
	] as [string, Partial<StockLedger>][])('rejects %s', (_label, over) => {
		expect(() => assertDonationLedgerRows([row(over)])).toThrow();
	});
});
