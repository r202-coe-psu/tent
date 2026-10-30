import { describe, expect, it } from 'vitest';
import { planStaffCardBackfill, type StaffCardBackfillDoc } from './staff-card-backfill';

const VALID_HASH = '0123456789abcdef'.repeat(4);
const NO_SERVICE = { serviceNames: [] as string[] };

describe('planStaffCardBackfill', () => {
	it('plans a mint for a plain staff user', () => {
		const docs: StaffCardBackfillDoc[] = [{ _id: 'org.couchdb.user:somchai', name: 'somchai' }];
		const plan = planStaffCardBackfill(docs, NO_SERVICE);
		expect(plan.mint).toEqual(['org.couchdb.user:somchai']);
		expect(plan.skipped).toEqual({ design: 0, volunteer: 0, has_hash: 0, service: 0 });
	});

	it('counts each skip bucket and mints only the plain staff user', () => {
		const docs: StaffCardBackfillDoc[] = [
			{ _id: '_design/_auth' },
			{ _id: 'org.couchdb.user:public_writer', name: 'public_writer' },
			{ _id: 'org.couchdb.user:volunteer1', name: 'volunteer1', volunteer_id: 'volunteer:v1' },
			{ _id: 'org.couchdb.user:carded', name: 'carded', staff_token_hash: VALID_HASH },
			{ _id: 'org.couchdb.user:somchai', name: 'somchai' }
		];
		const plan = planStaffCardBackfill(docs, { serviceNames: ['public_writer'] });
		expect(plan.mint).toEqual(['org.couchdb.user:somchai']);
		expect(plan.skipped).toEqual({ design: 1, volunteer: 1, has_hash: 1, service: 1 });
	});

	it('skips a volunteer-type user who has no volunteer_id', () => {
		const docs: StaffCardBackfillDoc[] = [
			{ _id: 'org.couchdb.user:vol', name: 'vol', personnel_type: 'volunteer' }
		];
		const plan = planStaffCardBackfill(docs, NO_SERVICE);
		expect(plan.mint).toEqual([]);
		expect(plan.skipped.volunteer).toBe(1);
	});

	it('still mints an inactive user', () => {
		const docs = [{ _id: 'org.couchdb.user:retired', name: 'retired', active: false }];
		const plan = planStaffCardBackfill(docs, NO_SERVICE);
		expect(plan.mint).toEqual(['org.couchdb.user:retired']);
		expect(plan.skipped).toEqual({ design: 0, volunteer: 0, has_hash: 0, service: 0 });
	});

	it('re-mints a doc whose stored hash is uppercase or too short', () => {
		const docs: StaffCardBackfillDoc[] = [
			{ _id: 'org.couchdb.user:upper', name: 'upper', staff_token_hash: VALID_HASH.toUpperCase() },
			{ _id: 'org.couchdb.user:short', name: 'short', staff_token_hash: 'abc123' }
		];
		const plan = planStaffCardBackfill(docs, NO_SERVICE);
		expect(plan.mint).toEqual(['org.couchdb.user:upper', 'org.couchdb.user:short']);
		expect(plan.skipped.has_hash).toBe(0);
	});

	it('plans nothing on a second run once every minted doc has a valid hash', () => {
		const docs: StaffCardBackfillDoc[] = [
			{ _id: 'org.couchdb.user:a', name: 'a' },
			{ _id: 'org.couchdb.user:b', name: 'b', staff_token_hash: 'zz' }
		];
		const first = planStaffCardBackfill(docs, NO_SERVICE);
		expect(first.mint).toEqual(['org.couchdb.user:a', 'org.couchdb.user:b']);
		const carded = docs.map((doc) =>
			first.mint.includes(doc._id) ? { ...doc, staff_token_hash: VALID_HASH } : doc
		);
		const second = planStaffCardBackfill(carded, NO_SERVICE);
		expect(second.mint).toEqual([]);
		expect(second.skipped.has_hash).toBe(2);
	});
});
