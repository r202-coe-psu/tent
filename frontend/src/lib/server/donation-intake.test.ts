import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	assertDonationLedgerRows,
	authorizeDonation,
	donationScopeCodes,
	isInCallerScope,
	resolveDonationWriteShelter
} from './donation-intake';
import type { PublicDonationDoc } from '$lib/features/donations';
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

	it('refuses warehouse_staff held only in a shelter the caller is not in (#477)', async () => {
		expect(await outcome(caller(['shelter:SH001', 'SH002:warehouse_staff'], 'SH001'))).toBe(403);
	});

	it('admits a multi-shelter caller whose capability is not in the first shelter (#477)', async () => {
		expect(
			await outcome(caller(['shelter:SH001', 'shelter:SH002', 'SH002:warehouse_staff'], 'SH001'))
		).toBe('allowed');
	});

	it('admits donation_staff of its own shelter, compound or flat with one shelter', async () => {
		expect(await outcome(caller(['shelter:SH001', 'SH001:donation_staff'], 'SH001'))).toBe(
			'allowed'
		);
		expect(await outcome(caller(['shelter:SH001', 'donation_staff'], 'SH001'))).toBe('allowed');
	});

	it('refuses donation_staff of a shelter the caller is not in', async () => {
		expect(await outcome(caller(['shelter:SH001', 'SH002:donation_staff'], 'SH001'))).toBe(403);
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

describe('active-shelter scoping (#477)', () => {
	// warehouse_staff in SH002 only; a member of SH001 with no capability there.
	const multi = caller(
		['shelter:SH001', 'shelter:SH002', 'SH002:warehouse_staff', 'SH003:shelter_manager'],
		'SH001'
	);
	const both = caller(
		['shelter:SH001', 'shelter:SH002', 'SH001:warehouse_staff', 'SH002:donation_staff'],
		'SH001'
	);
	const donationIn = (code: string) => ({ shelter_code: code }) as PublicDonationDoc;

	it('isInCallerScope checks the capability in the donation shelter, not the first one', () => {
		expect(isInCallerScope(multi, donationIn('SH002'))).toBe(true);
		expect(isInCallerScope(multi, donationIn('SH001'))).toBe(false);
		expect(isInCallerScope(caller(['system_admin'], null, true), donationIn('SH009'))).toBe(true);
	});

	it('isInCallerScope refuses a shelter the caller only holds scope in without a capability', () => {
		expect(
			isInCallerScope(caller(['shelter:SH001', 'kitchen_staff'], 'SH001'), donationIn('SH001'))
		).toBe(false);
	});

	it('donationScopeCodes lists every shelter with a capability when none is requested', () => {
		expect(donationScopeCodes(both, null)).toEqual(['SH001', 'SH002']);
		expect(donationScopeCodes(multi, undefined)).toEqual(['SH002']);
	});

	it('donationScopeCodes narrows to the requested shelter and 403s on one without capability', () => {
		expect(donationScopeCodes(both, 'SH002')).toEqual(['SH002']);
		expect(() => donationScopeCodes(multi, 'SH001')).toThrow(
			expect.objectContaining({ status: 403 })
		);
		expect(() => donationScopeCodes(both, 'SH009')).toThrow(
			expect.objectContaining({ status: 403 })
		);
	});

	it('resolveDonationWriteShelter picks the requested or only shelter, null when ambiguous', () => {
		expect(resolveDonationWriteShelter(both, 'SH002')).toBe('SH002');
		expect(resolveDonationWriteShelter(multi, null)).toBe('SH002');
		expect(resolveDonationWriteShelter(both, null)).toBeNull();
		expect(() => resolveDonationWriteShelter(multi, 'SH001')).toThrow(
			expect.objectContaining({ status: 403 })
		);
	});
});
