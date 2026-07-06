// @vitest-environment happy-dom
/**
 * Integration test for T-11 DoD #4: balance correctness under concurrent writes
 * against a real CouchDB instance (not just the in-memory adapter).
 *
 * Skips automatically when COUCHDB_TEST_URL is not set or unreachable, so the
 * default local test run still passes without docker. CI can opt in by setting
 * COUCHDB_TEST_URL=http://admin:password@localhost:5984 before running tests.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import PouchDB from 'pouchdb-browser';
import { OperationsPouchRepository } from './operations.pouch';
import { createReceiveEntry, stockBalance, type StockLedger } from '../domain/operations';
import type { AuthorContext } from '$lib/db/model';

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

describe('OperationsPouchRepository — CouchDB integration (T-11 DoD #4)', () => {
	let dbName: string;
	let httpDb: PouchDB.Database | null = null;

	beforeAll(async () => {
		couchReachable = await probe();
	});

	afterEach(async () => {
		if (httpDb) {
			try {
				await httpDb.destroy();
			} catch {
				// ignore cleanup errors
			}
			httpDb = null;
		}
	});

	it.skipIf(!couchReachable)(
		'balance stays correct under 100 concurrent HTTP writes to CouchDB',
		async () => {
			dbName = `test-t11-concurrent-${Date.now()}-${Math.random().toString(36).slice(2)}`;
			const dbUrl = `${COUCH_URL.replace(/\/$/, '')}/${dbName}`;

			httpDb = new PouchDB(dbUrl);
			await httpDb.info();

			const N = 100;
			const entries = Array.from({ length: N }, () =>
				createReceiveEntry(
					{ item_id: 'item:concurrent', qty: 5, unit: 'kg', source: 'donation' },
					ctx
				)
			);

			await Promise.all(entries.map((e) => httpDb!.put(e)));

			const rows = await httpDb.allDocs({ include_docs: true });
			const docs = rows.rows
				.map((r) => r.doc as unknown as StockLedger)
				.filter((d): d is StockLedger => d?.type === 'stock_ledger');
			const balance = stockBalance(docs);

			expect(balance.get('item:concurrent')).toBe(N * 5);
		},
		30_000
	);

	it.skipIf(!couchReachable)(
		'OperationsPouchRepository routes through HTTP adapter cleanly',
		async () => {
			dbName = `test-t11-repo-http-${Date.now()}-${Math.random().toString(36).slice(2)}`;
			const dbUrl = `${COUCH_URL.replace(/\/$/, '')}/${dbName}`;
			httpDb = new PouchDB(dbUrl);
			await httpDb.info();

			const repo = new OperationsPouchRepository(dbUrl);
			const entry = createReceiveEntry(
				{ item_id: 'item:rice', qty: 42, unit: 'kg', source: 'donation' },
				ctx
			);
			await repo.addLedgerEntry(entry);

			const balance = await repo.getBalance();
			expect(balance.get('item:rice')).toBe(42);
		}
	);
});
