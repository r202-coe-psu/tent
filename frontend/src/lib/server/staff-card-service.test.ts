import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as couchAdmin from './couch-admin';
import * as publicWriter from './couch-public-writer';
import type { Caller } from './couch-admin';
import { ServiceError } from './couch-admin';
import { getMyCard, resolveStaffCard } from './staff-card-service';
import type { CouchUserDoc } from './user-service';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

const distributionStaff: Caller = {
	name: 'dist@x.com',
	roles: ['shelter:SH001', 'SH001:distribution_staff'],
	isSA: false,
	shelterCode: 'SH001'
};

const registrationStaff: Caller = {
	name: 'reg@x.com',
	roles: ['shelter:SH001', 'SH001:registration_staff'],
	isSA: false,
	shelterCode: 'SH001'
};

const otherShelterDistributionStaff: Caller = {
	name: 'dist2@x.com',
	roles: ['shelter:SH002', 'SH002:distribution_staff'],
	isSA: false,
	shelterCode: 'SH002'
};

async function rejection(promise: Promise<unknown>): Promise<ServiceError> {
	const err = await promise.then(
		() => null,
		(e: unknown) => e
	);
	expect(err).toBeInstanceOf(ServiceError);
	return err as ServiceError;
}

function userDoc(name: string, overrides: Partial<CouchUserDoc> = {}): CouchUserDoc {
	return {
		_id: `org.couchdb.user:${name}`,
		name,
		type: 'user',
		roles: ['shelter:SH001', 'SH001:registration_staff'],
		...overrides
	};
}

describe('resolveStaffCard', () => {
	let usersDb: Record<string, CouchUserDoc>;
	let shelterDb: Record<string, Record<string, unknown>>;

	beforeEach(() => {
		usersDb = {};
		shelterDb = {};
		vi.spyOn(couchAdmin, 'adminRaw').mockImplementation(async (path, method = 'GET') => {
			const cleanPath = path.split('?')[0];
			if (method === 'GET' && cleanPath === '/_users/_all_docs') {
				const rows = Object.values(usersDb).map((doc) => ({ id: doc._id, key: doc._id, doc }));
				return { status: 200, data: { rows } };
			}
			const shelterDoc = cleanPath.match(/^\/shelter_sh001\/(.+)$/);
			if (method === 'GET' && shelterDoc) {
				const doc = shelterDb[decodeURIComponent(shelterDoc[1])];
				if (doc) return { status: 200, data: doc };
			}
			return { status: 404, data: { error: 'not_found', reason: 'missing' } };
		});
	});

	it('resolves a staff card to a staff recipient with only the public fields', async () => {
		usersDb['org.couchdb.user:somchai@x.com'] = userDoc('somchai@x.com', {
			display_name: 'สมชาย ใจดี',
			position: 'เจ้าหน้าที่ลงทะเบียน',
			staff_token_hash: HASH_A,
			phone: '0812345678',
			email: 'somchai@x.com'
		});

		const result = await resolveStaffCard(distributionStaff, `TKT-STF-HASH-${HASH_A}`, 'SH001');

		expect(result).toEqual({
			kind: 'staff',
			recipient_id: 'user:somchai@x.com',
			display_name: 'สมชาย ใจดี',
			position: 'เจ้าหน้าที่ลงทะเบียน'
		});
		expect(JSON.stringify(result)).not.toMatch(/0812345678|registration_staff|aaaaaaaa/);
	});

	it.each([
		['registration staff', registrationStaff],
		['distribution staff of another shelter', otherShelterDistributionStaff]
	])('rejects %s who cannot distribute in the shelter as FORBIDDEN', async (_label, caller) => {
		usersDb['org.couchdb.user:somchai@x.com'] = userDoc('somchai@x.com', {
			staff_token_hash: HASH_A
		});

		const err = await rejection(resolveStaffCard(caller, `TKT-STF-HASH-${HASH_A}`, 'SH001'));

		expect(err.code).toBe('FORBIDDEN');
	});

	it('rejects a payload that is not a staff card as VALIDATION', async () => {
		const err = await rejection(resolveStaffCard(distributionStaff, 'TKT-STF-HASH-nope', 'SH001'));

		expect(err.code).toBe('VALIDATION');
	});

	it('rejects a card whose hash matches no user as NOT_FOUND', async () => {
		usersDb['org.couchdb.user:somchai@x.com'] = userDoc('somchai@x.com', {
			staff_token_hash: HASH_B
		});

		const err = await rejection(
			resolveStaffCard(distributionStaff, `TKT-STF-HASH-${HASH_A}`, 'SH001')
		);

		expect(err.code).toBe('NOT_FOUND');
	});

	it('rejects a hash shared by two users as CONFLICT', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		usersDb['org.couchdb.user:a@x.com'] = userDoc('a@x.com', { staff_token_hash: HASH_A });
		usersDb['org.couchdb.user:b@x.com'] = userDoc('b@x.com', { staff_token_hash: HASH_A });

		const err = await rejection(
			resolveStaffCard(distributionStaff, `TKT-STF-HASH-${HASH_A}`, 'SH001')
		);

		expect(err.code).toBe('CONFLICT');
	});

	it('rejects a deactivated account as FORBIDDEN', async () => {
		usersDb['org.couchdb.user:somchai@x.com'] = userDoc('somchai@x.com', {
			staff_token_hash: HASH_A,
			active: false
		});

		const err = await rejection(
			resolveStaffCard(distributionStaff, `TKT-STF-HASH-${HASH_A}`, 'SH001')
		);

		expect(err).toMatchObject({ code: 'FORBIDDEN', message: 'บัญชีถูกปิดใช้งาน' });
	});

	it('rejects a card of staff who do not belong to the shelter as FORBIDDEN', async () => {
		usersDb['org.couchdb.user:somchai@x.com'] = userDoc('somchai@x.com', {
			staff_token_hash: HASH_A,
			roles: ['shelter:SH002', 'SH002:registration_staff']
		});

		const err = await rejection(
			resolveStaffCard(distributionStaff, `TKT-STF-HASH-${HASH_A}`, 'SH001')
		);

		expect(err).toMatchObject({ code: 'FORBIDDEN', message: 'ไม่ใช่เจ้าหน้าที่ของศูนย์นี้' });
	});

	it('resolves a system admin card without shelter scope', async () => {
		usersDb['org.couchdb.user:root@x.com'] = userDoc('root@x.com', {
			staff_token_hash: HASH_A,
			roles: ['system_admin']
		});

		const result = await resolveStaffCard(distributionStaff, `TKT-STF-HASH-${HASH_A}`, 'SH001');

		expect(result).toMatchObject({ kind: 'staff', recipient_id: 'user:root@x.com' });
	});

	it('resolves a staff card linked to a volunteer profile to that volunteer', async () => {
		usersDb['org.couchdb.user:vol@x.com'] = userDoc('vol@x.com', {
			staff_token_hash: HASH_A,
			volunteer_id: 'volunteer:01HZXVOL011'
		});
		shelterDb['volunteer:01HZXVOL011'] = {
			_id: 'volunteer:01HZXVOL011',
			type: 'volunteer',
			user_name: 'vol@x.com',
			first_name: 'มานี',
			last_name: 'มีน้ำใจ'
		};

		const result = await resolveStaffCard(distributionStaff, `TKT-STF-HASH-${HASH_A}`, 'SH001');

		expect(result).toEqual({
			kind: 'volunteer',
			recipient_id: 'volunteer:01HZXVOL011',
			display_name: 'มานี มีน้ำใจ'
		});
	});

	it('rejects a card whose volunteer profile is missing as CONFLICT', async () => {
		usersDb['org.couchdb.user:vol@x.com'] = userDoc('vol@x.com', {
			staff_token_hash: HASH_A,
			volunteer_id: 'volunteer:01HZXVOL011'
		});

		const err = await rejection(
			resolveStaffCard(distributionStaff, `TKT-STF-HASH-${HASH_A}`, 'SH001')
		);

		expect(err.code).toBe('CONFLICT');
	});

	it('rejects a card whose volunteer profile belongs to another user as CONFLICT', async () => {
		usersDb['org.couchdb.user:vol@x.com'] = userDoc('vol@x.com', {
			staff_token_hash: HASH_A,
			volunteer_id: 'volunteer:01HZXVOL011'
		});
		shelterDb['volunteer:01HZXVOL011'] = {
			_id: 'volunteer:01HZXVOL011',
			type: 'volunteer',
			user_name: 'someone-else@x.com',
			first_name: 'มานี',
			last_name: 'มีน้ำใจ'
		};

		const err = await rejection(
			resolveStaffCard(distributionStaff, `TKT-STF-HASH-${HASH_A}`, 'SH001')
		);

		expect(err.code).toBe('CONFLICT');
	});
});

describe('getMyCard', () => {
	let usersDb: Record<string, CouchUserDoc>;
	let shelterDb: Record<string, Record<string, unknown>>;
	let writes: { path: string; body: Record<string, unknown> }[];

	beforeEach(() => {
		usersDb = {};
		shelterDb = {};
		writes = [];
		vi.spyOn(couchAdmin, 'adminRaw').mockImplementation(async (path, method = 'GET') => {
			const userDoc = path.match(/^\/_users\/org\.couchdb\.user:(.+)$/);
			if (method === 'GET' && userDoc) {
				const doc = usersDb[`org.couchdb.user:${decodeURIComponent(userDoc[1])}`];
				if (doc) return { status: 200, data: doc };
			}
			const shelterDoc = path.match(/^\/shelter_(sh\d+)\/(.+)$/);
			if (method === 'GET' && shelterDoc) {
				const doc = shelterDb[`${shelterDoc[1]}/${decodeURIComponent(shelterDoc[2])}`];
				if (doc) return { status: 200, data: doc };
			}
			return { status: 404, data: { error: 'not_found', reason: 'missing' } };
		});
		vi.spyOn(publicWriter, 'putAsPublicWriter').mockImplementation(async (dbName, docId, doc) => {
			writes.push({ path: `/${dbName}/${encodeURIComponent(docId)}`, body: doc as never });
			shelterDb[`${dbName.replace('shelter_', '')}/${docId}`] = {
				...(doc as Record<string, unknown>),
				_rev: '2-written'
			};
			return { status: 201, data: { ok: true, rev: '2-written' } };
		});
	});

	it('returns the staff card payload for a user without a volunteer profile', async () => {
		usersDb['org.couchdb.user:somchai@x.com'] = userDoc('somchai@x.com', {
			display_name: 'สมชาย ใจดี',
			position: 'เจ้าหน้าที่ลงทะเบียน',
			staff_token_hash: HASH_A,
			phone: '0812345678',
			email: 'somchai@x.com'
		});

		const result = await getMyCard('somchai@x.com');

		expect(result).toEqual({
			kind: 'staff',
			payload: `TKT-STF-HASH-${HASH_A}`,
			display_name: 'สมชาย ใจดี',
			position: 'เจ้าหน้าที่ลงทะเบียน',
			roles: ['shelter:SH001', 'SH001:registration_staff']
		});
		expect(JSON.stringify(result)).not.toMatch(/0812345678/);
	});

	it('rejects a caller whose user document does not exist as UNAUTHENTICATED', async () => {
		const err = await rejection(getMyCard('ghost@x.com'));

		expect(err.code).toBe('UNAUTHENTICATED');
	});

	it('reports a deactivated account as none/inactive', async () => {
		usersDb['org.couchdb.user:somchai@x.com'] = userDoc('somchai@x.com', {
			staff_token_hash: HASH_A,
			active: false
		});

		const result = await getMyCard('somchai@x.com');

		expect(result).toEqual({ kind: 'none', reason: 'inactive' });
	});

	it('reports a volunteer-type account without a linked profile as none/volunteer_unlinked', async () => {
		usersDb['org.couchdb.user:vol@x.com'] = userDoc('vol@x.com', {
			personnel_type: 'volunteer',
			staff_token_hash: HASH_A
		});

		const result = await getMyCard('vol@x.com');

		expect(result).toEqual({ kind: 'none', reason: 'volunteer_unlinked' });
	});

	it.each([
		['no token hash', undefined],
		['a malformed token hash', 'not-a-hash']
	])('reports staff with %s as none/no_token without minting one', async (_label, hash) => {
		usersDb['org.couchdb.user:somchai@x.com'] = userDoc('somchai@x.com', {
			staff_token_hash: hash
		});

		const result = await getMyCard('somchai@x.com');

		expect(result).toEqual({ kind: 'none', reason: 'no_token' });
		expect(couchAdmin.adminRaw).not.toHaveBeenCalledWith(
			expect.anything(),
			'PUT',
			expect.anything()
		);
		expect(writes).toEqual([]);
	});

	it.each([
		['the volunteer profile is missing', undefined],
		['the volunteer profile belongs to another user', 'someone-else@x.com']
	])('reports a linked account as none/volunteer_unlinked when %s', async (_label, owner) => {
		usersDb['org.couchdb.user:vol@x.com'] = userDoc('vol@x.com', {
			volunteer_id: 'volunteer:01HZXVOL011'
		});
		if (owner) {
			shelterDb['sh001/volunteer:01HZXVOL011'] = {
				_id: 'volunteer:01HZXVOL011',
				_rev: '1-a',
				type: 'volunteer',
				user_name: owner,
				tracking_token_hash: HASH_B
			};
		}

		const result = await getMyCard('vol@x.com');

		expect(result).toEqual({ kind: 'none', reason: 'volunteer_unlinked' });
	});

	it('returns the existing volunteer role-card payload without rewriting the volunteer', async () => {
		usersDb['org.couchdb.user:vol@x.com'] = userDoc('vol@x.com', {
			display_name: 'มานี มีน้ำใจ',
			roles: ['shelter:SH002', 'shelter:SH001', 'SH001:registration_staff'],
			volunteer_id: 'volunteer:01HZXVOL011',
			staff_token_hash: HASH_A,
			phone: '0812345678'
		});
		shelterDb['sh001/volunteer:01HZXVOL011'] = {
			_id: 'volunteer:01HZXVOL011',
			_rev: '1-a',
			type: 'volunteer',
			user_name: 'vol@x.com',
			volunteer_code: 'VOL-0007',
			phone: '0812345678',
			tracking_token_hash: HASH_B
		};

		const result = await getMyCard('vol@x.com');

		expect(result).toEqual({
			kind: 'volunteer',
			payload: `TKT-VOL-HASH-${HASH_B.toUpperCase()}`,
			display_name: 'มานี มีน้ำใจ',
			volunteer_code: 'VOL-0007',
			roles: ['shelter:SH002', 'shelter:SH001', 'SH001:registration_staff']
		});
		expect(writes).toEqual([]);
		expect(shelterDb['sh001/volunteer:01HZXVOL011']).toMatchObject({
			_rev: '1-a',
			tracking_token_hash: HASH_B
		});
		expect(JSON.stringify(result)).not.toMatch(/0812345678|aaaaaaaa/);
	});

	it('mints and stores a role-card token for a linked volunteer who has none', async () => {
		usersDb['org.couchdb.user:vol@x.com'] = userDoc('vol@x.com', {
			volunteer_id: 'volunteer:01HZXVOL011'
		});
		shelterDb['sh001/volunteer:01HZXVOL011'] = {
			_id: 'volunteer:01HZXVOL011',
			_rev: '1-a',
			type: 'volunteer',
			user_name: 'vol@x.com',
			volunteer_code: null
		};

		const result = await getMyCard('vol@x.com');

		expect(result).toMatchObject({ kind: 'volunteer', volunteer_code: null });
		const { payload } = result as { payload: string };
		expect(payload).toMatch(/^TKT-VOL-[0-9A-Z]+$/);
		expect(writes).toHaveLength(1);
		expect(writes[0].path).toBe('/shelter_sh001/volunteer%3A01HZXVOL011');
		expect(writes[0].body).toMatchObject({
			_id: 'volunteer:01HZXVOL011',
			_rev: '1-a',
			user_name: 'vol@x.com'
		});
		expect(writes[0].body.tracking_token_hash).toMatch(/^[0-9a-f]{64}$/);

		const again = await getMyCard('vol@x.com');

		expect(again).toMatchObject({
			kind: 'volunteer',
			payload: `TKT-VOL-HASH-${(writes[0].body.tracking_token_hash as string).toUpperCase()}`
		});
		expect(writes).toHaveLength(1);
	});
});
