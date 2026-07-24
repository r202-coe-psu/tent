import { describe, it, expect } from 'vitest';
import { buildValidateDocUpdate } from './shelter-access-design';

type UserCtx = { name: string; roles: string[] };
type Doc = Record<string, unknown>;
type ValidateFn = (newDoc: Doc, oldDoc: Doc | null, userCtx: UserCtx) => void;

/** Compile the generated source so the rules are exercised, not just string-matched. */
function compile(code = 'SH001'): ValidateFn {
	return new Function(`return ${buildValidateDocUpdate(code)}`)() as ValidateFn;
}

/**
 * CouchDB validators reject by throwing a plain `{ forbidden }` object, not an
 * Error — `expect(...).toThrow(/re/)` cannot read those, so assert the field.
 */
function expectForbidden(run: () => void, match: RegExp): void {
	try {
		run();
	} catch (e) {
		expect((e as { forbidden?: string }).forbidden ?? String(e)).toMatch(match);
		return;
	}
	throw new Error(`Expected a forbidden error matching ${match}, but nothing was thrown`);
}

const WAREHOUSE: UserCtx = { name: 'ws', roles: ['shelter:SH001', 'warehouse_staff'] };
const REGISTRATION: UserCtx = { name: 'reg', roles: ['shelter:SH001', 'registration_staff'] };

const envelope = {
	schema_v: 2,
	shelter_code: 'SH001',
	created_at: '2026-07-22T00:00:00.000Z',
	updated_at: '2026-07-22T00:00:00.000Z',
	created_by: 'ws'
};

const ledger = (over: Doc = {}): Doc => ({
	_id: 'stock_ledger:01J',
	type: 'stock_ledger',
	item_id: 'item:01H',
	qty: '10',
	unit: 'kg',
	reason: 'donation',
	...envelope,
	...over
});

const donation = (over: Doc = {}): Doc => ({
	_id: 'donation:01J',
	type: 'donation',
	status: 'declared',
	...envelope,
	schema_v: 3,
	...over
});

describe('buildValidateDocUpdate', () => {
	it('includes audit in the allowed doc type whitelist', () => {
		const validateFn = buildValidateDocUpdate('SH001');
		expect(validateFn).toContain("'audit'");
		expect(validateFn).toMatch(
			/var allowed = \['evacuee', 'donation', 'donation_campaign', 'stock_ledger', 'donation_slot', 'audit'\]/
		);
	});

	it('accepts a new stock_ledger entry from warehouse staff', () => {
		expect(() => compile()(ledger(), null, WAREHOUSE)).not.toThrow();
	});

	it('rejects a doc whose shelter_code belongs to another shelter', () => {
		expectForbidden(
			() => compile()(ledger({ shelter_code: 'SH002' }), null, WAREHOUSE),
			/shelter_code must be SH001/
		);
	});

	describe('append-only (schema.md §6.2)', () => {
		it('rejects updating an existing stock_ledger', () => {
			expectForbidden(
				() => compile()(ledger({ qty: '99' }), ledger(), WAREHOUSE),
				/Cannot update append-only stock_ledger/
			);
		});

		it('rejects deleting an existing stock_ledger', () => {
			expectForbidden(
				() => compile()({ _id: 'stock_ledger:01J', _deleted: true }, ledger(), WAREHOUSE),
				/Cannot delete append-only stock_ledger/
			);
		});

		it('rejects updating an existing audit entry', () => {
			const audit = { ...envelope, schema_v: 1, _id: 'audit:01J', type: 'audit' };
			expectForbidden(
				() => compile()({ ...audit, reason: 'edited' }, audit, WAREHOUSE),
				/Cannot update append-only audit/
			);
		});
	});

	describe('donation status is forward-only (schema.md §2.3)', () => {
		it('allows declared → received', () => {
			expect(() =>
				compile()(donation({ status: 'received' }), donation(), WAREHOUSE)
			).not.toThrow();
		});

		it('rejects received → declared', () => {
			expectForbidden(
				() =>
					compile()(donation({ status: 'declared' }), donation({ status: 'received' }), WAREHOUSE),
				/Cannot revert donation status back to declared/
			);
		});
	});

	describe('stock_ledger role gate', () => {
		it('rejects a writer without a warehouse/manager role', () => {
			expectForbidden(
				() => compile()(ledger(), null, REGISTRATION),
				/Only warehouse staff or managers can write stock ledger/
			);
		});

		it('allows shelter_manager', () => {
			expect(() =>
				compile()(ledger(), null, { name: 'sm', roles: ['shelter:SH001', 'shelter_manager'] })
			).not.toThrow();
		});

		it('never blocks the CouchDB server admin (provisioning/seed)', () => {
			expect(() =>
				compile()(ledger({ shelter_code: 'SH999' }), ledger(), {
					name: 'admin',
					roles: ['_admin']
				})
			).not.toThrow();
		});
	});
});
