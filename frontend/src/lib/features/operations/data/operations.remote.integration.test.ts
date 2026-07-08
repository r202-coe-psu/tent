// @vitest-environment happy-dom
/**
 * Integration test for T-11 DoD #4: balance correctness under concurrent writes
 * against a real CouchDB instance.
 *
 * Skips when COUCHDB_TEST_URL is not set or unreachable.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createReceiveEntry, stockBalance, type StockLedger } from '../domain/operations';
import type { AuthorContext } from '$lib/db/model';
import { putDoc, allDocsByType } from '$lib/db/couch-db';
import { OperationsRemoteRepository } from './operations.remote';

const COUCH_URL = process.env.COUCHDB_TEST_URL ?? '';
let couchReachable = false;

async function probe(): Promise<boolean> {
	if (!COUCH_URL) return false;
	try {
		const res = await fetch(`${COUCH_URL.replace(/\/$/, '')}/_up`);
		return res.ok;
	} catch {
		return false;
	}
}

const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'tester' };

describe('OperationsRemoteRepository — CouchDB integration (T-11 DoD #4)', () => {
	let dbName: string;

	beforeAll(async () => {
		couchReachable = await probe();
	});

	afterEach(async () => {
		if (!couchReachable || !dbName) return;
		try {
			await fetch(`${COUCH_URL.replace(/\/$/, '')}/${dbName}`, { method: 'DELETE' });
		} catch {
			// ignore cleanup errors
		}
	});

	it.skipIf(!couchReachable)(
		'balance stays correct under 100 concurrent HTTP writes to CouchDB',
		async () => {
			dbName = `test-t11-concurrent-${Date.now()}-${Math.random().toString(36).slice(2)}`;
			const base = COUCH_URL.replace(/\/$/, '');
			await fetch(`${base}/${dbName}`, { method: 'PUT' });

			const N = 100;
			const entries = Array.from({ length: N }, () =>
				createReceiveEntry(
					{ item_id: 'item:concurrent', qty: 5, unit: 'kg', source: 'donation' },
					ctx
				)
			);

			await Promise.all(entries.map((e) => putDoc(dbName, e)));

			const docs = await allDocsByType<StockLedger>(
				dbName,
				'stock_ledger',
				(d): d is StockLedger =>
					!!d && typeof d === 'object' && (d as StockLedger).type === 'stock_ledger'
			);
			const balance = stockBalance(docs);

			expect(balance.get('item:concurrent')).toBe(N * 5);
		},
		30_000
	);

	it.skipIf(!couchReachable)('OperationsRemoteRepository routes through HTTP cleanly', async () => {
		dbName = `test-t11-repo-http-${Date.now()}-${Math.random().toString(36).slice(2)}`;
		const base = COUCH_URL.replace(/\/$/, '');
		await fetch(`${base}/${dbName}`, { method: 'PUT' });

		const repo = new OperationsRemoteRepository(dbName);
		const entry = createReceiveEntry(
			{ item_id: 'item:rice', qty: 42, unit: 'kg', source: 'donation' },
			ctx
		);
		await repo.addLedgerEntry(entry);

		const balance = await repo.getBalance();
		expect(balance.get('item:rice')).toBe(42);
	});
});
