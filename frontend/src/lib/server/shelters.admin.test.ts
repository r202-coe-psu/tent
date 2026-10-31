import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const adminRawMock = vi.hoisted(() => vi.fn());

vi.mock('./couch-admin', async (importOriginal) => ({
	...(await importOriginal<typeof import('./couch-admin')>()),
	adminRaw: adminRawMock
}));

import {
	buildSecurityMutationLock,
	deployDonationReceivedMangoIndex,
	updateMaster
} from './shelters.admin';

describe('buildSecurityMutationLock', () => {
	it('writes a regular CouchDB type field instead of the reserved _type member', () => {
		const lock = buildSecurityMutationLock({
			id: 'shelter_security_lock%3ASH001',
			ownerId: 'security:test',
			resource: 'SH001',
			leaseUntil: '2026-09-20T00:00:30.000Z',
			rev: '3-old'
		});

		expect(lock).toMatchObject({
			_id: 'shelter_security_lock%3ASH001',
			type: 'shelter_security_mutation_lock',
			_rev: '3-old'
		});
		expect(lock).not.toHaveProperty('_type');
	});
});

describe('updateMaster closed_at (CR-183 FR-14/FR-15)', () => {
	const STAMP = '2026-09-01T00:00:00.000Z';
	const NOW = '2026-10-25T00:00:00.000Z';

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(NOW));
		adminRawMock.mockReset();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	async function update(current: Record<string, unknown>, patch: Record<string, unknown>) {
		const doc = { _id: 'shelter:01', _rev: '1-a', schema_v: 3, code: 'SH001', ...current };
		adminRawMock.mockReset();
		adminRawMock.mockImplementation(async (_path: string, method: string) =>
			method === 'GET'
				? { status: 200, data: { rows: [{ doc }] } }
				: { status: 201, data: { id: doc._id, rev: '2-b' } }
		);
		await updateMaster('SH001', () => ({ patch }));
		const put = adminRawMock.mock.calls.find(([, method]) => method === 'PUT');
		return put?.[2] as Record<string, unknown>;
	}

	it('clears closed_at when an import duplicate-update moves a closed shelter to open', async () => {
		const written = await update(
			{ operation_status: 'closed', closed_at: STAMP },
			{ operation_status: 'open', capacity: 250 }
		);
		expect(written.closed_at).toBeNull();
		expect(written.capacity).toBe(250);
	});

	it('leaves closed_at unchanged when the update keeps the shelter closed', async () => {
		const written = await update(
			{ operation_status: 'closed', closed_at: STAMP },
			{ operation_status: 'closed', capacity: 250 }
		);
		expect(written.closed_at).toBe(STAMP);
	});

	it('leaves closed_at unchanged when the patch does not touch the status', async () => {
		const written = await update({ operation_status: 'closed', closed_at: STAMP }, { zones: [] });
		expect(written.closed_at).toBe(STAMP);
	});

	it('stamps closed_at when the status becomes closed', async () => {
		const written = await update({ operation_status: 'open' }, { operation_status: 'closed' });
		expect(written.closed_at).toBe(NOW);
	});

	it('ignores a closed_at carried in the patch', async () => {
		const forged = '2020-01-01T00:00:00.000Z';
		const written = await update(
			{ operation_status: 'open' },
			{ operation_status: 'closed', closed_at: forged }
		);
		expect(written.closed_at).toBe(NOW);
		const kept = await update(
			{ operation_status: 'closed', closed_at: STAMP },
			{ closed_at: forged }
		);
		expect(kept.closed_at).toBe(STAMP);
	});
});

describe('deployDonationReceivedMangoIndex (#821)', () => {
	beforeEach(() => adminRawMock.mockReset());

	it('creates the list, phone, booking-ref and ledger lot-number indexes on the shelter database', async () => {
		adminRawMock.mockResolvedValue({ status: 200, data: { result: 'created' } });

		await deployDonationReceivedMangoIndex('shelter_sh001');

		const posted = adminRawMock.mock.calls.map(([path, method, body]) => ({
			path,
			method,
			ddoc: body.ddoc,
			name: body.name,
			fields: body.index.fields
		}));
		expect(posted).toEqual([
			{
				path: '/shelter_sh001/_index',
				method: 'POST',
				ddoc: 'donation-received-list',
				name: 'donation-received-by-received-at',
				fields: [{ type: 'desc' }, { status: 'desc' }, { received_at: 'desc' }, { _id: 'desc' }]
			},
			{
				path: '/shelter_sh001/_index',
				method: 'POST',
				ddoc: 'donation-received-phone',
				name: 'donation-received-phone',
				fields: ['type', 'status', 'donor.phone_hash', 'received_at']
			},
			{
				path: '/shelter_sh001/_index',
				method: 'POST',
				ddoc: 'donation-booking-ref',
				name: 'donation-booking-ref',
				fields: ['type', 'booking_ref']
			},
			{
				path: '/shelter_sh001/_index',
				method: 'POST',
				ddoc: 'stock-ledger-lot-no',
				name: 'stock-ledger-lot-no',
				fields: ['type', 'lot.lot_no']
			}
		]);
	});

	it('fails, naming the index, when CouchDB refuses one', async () => {
		adminRawMock
			.mockResolvedValueOnce({ status: 200, data: { result: 'exists' } })
			.mockResolvedValueOnce({ status: 500, data: { reason: 'boom' } });

		await expect(deployDonationReceivedMangoIndex('shelter_sh001')).rejects.toThrow(
			'donation-received-phone'
		);
	});
});
