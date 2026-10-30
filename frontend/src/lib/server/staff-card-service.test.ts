import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as couchAdmin from './couch-admin';
import * as publicWriter from './couch-public-writer';
import type { Caller } from './couch-admin';
import { ServiceError } from './couch-admin';
import {
	getMyCard,
	getStaffCardForAdmin,
	resolveStaffCard,
	rotateStaffCard
} from './staff-card-service';
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

function findUsers(usersDb: Record<string, object>, body: unknown) {
	const { selector, fields, limit } = body as {
		selector: Record<string, unknown>;
		fields?: string[];
		limit?: number;
	};
	const docs = Object.values(usersDb)
		.filter((doc) =>
			Object.entries(selector).every(([k, v]) => (doc as Record<string, unknown>)[k] === v)
		)
		.slice(0, limit)
		.map((doc) =>
			fields ? Object.fromEntries(Object.entries(doc).filter(([k]) => fields.includes(k))) : doc
		);
	return { status: 200, data: { docs } };
}

describe('resolveStaffCard', () => {
	let usersDb: Record<string, CouchUserDoc>;
	let shelterDb: Record<string, Record<string, unknown>>;

	beforeEach(() => {
		usersDb = {};
		shelterDb = {};
		vi.spyOn(couchAdmin, 'adminRaw').mockImplementation(async (path, method = 'GET', body) => {
			const cleanPath = path.split('?')[0];
			if (method === 'POST' && cleanPath === '/_users/_find') return findUsers(usersDb, body);
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
			role_label: 'เจ้าหน้าที่ลงทะเบียน',
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

	it('answers a card of staff from another shelter exactly like an unknown card', async () => {
		usersDb['org.couchdb.user:somchai@x.com'] = userDoc('somchai@x.com', {
			staff_token_hash: HASH_A,
			roles: ['shelter:SH002', 'SH002:registration_staff']
		});

		const otherShelter = await rejection(
			resolveStaffCard(distributionStaff, `TKT-STF-HASH-${HASH_A}`, 'SH001')
		);
		const unknown = await rejection(
			resolveStaffCard(distributionStaff, `TKT-STF-HASH-${HASH_B}`, 'SH001')
		);

		const response = (e: ServiceError) => ({
			code: e.code,
			message: e.message,
			description: e.description
		});
		expect(otherShelter.code).toBe('NOT_FOUND');
		expect(response(otherShelter)).toEqual(response(unknown));
	});

	it('rejects a volunteer-type account without a linked profile as CONFLICT', async () => {
		usersDb['org.couchdb.user:vol@x.com'] = userDoc('vol@x.com', {
			staff_token_hash: HASH_A,
			personnel_type: 'volunteer'
		});

		const err = await rejection(
			resolveStaffCard(distributionStaff, `TKT-STF-HASH-${HASH_A}`, 'SH001')
		);

		expect(err.code).toBe('CONFLICT');
	});

	it('resolves a system admin card without shelter scope', async () => {
		usersDb['org.couchdb.user:root@x.com'] = userDoc('root@x.com', {
			staff_token_hash: HASH_A,
			roles: ['system_admin']
		});

		const result = await resolveStaffCard(distributionStaff, `TKT-STF-HASH-${HASH_A}`, 'SH001');

		expect(result).toMatchObject({
			kind: 'staff',
			recipient_id: 'user:root@x.com',
			role_label: 'ผู้ดูแลระบบส่วนกลาง'
		});
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
			display_name: 'มานี มีน้ำใจ',
			role_label: 'เจ้าหน้าที่ลงทะเบียน'
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

	it('reports a CouchDB server admin session, which has no _users document, as none/server_admin', async () => {
		await expect(getMyCard('admin', ['_admin'])).resolves.toEqual({
			kind: 'none',
			reason: 'server_admin'
		});
	});

	it('rejects a non-admin session whose _users document is gone as UNAUTHENTICATED', async () => {
		const err = await rejection(getMyCard('ghost@x.com', []));

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

type StoredUser = CouchUserDoc & Record<string, unknown>;

const systemAdmin: Caller = {
	name: 'root@x.com',
	roles: ['system_admin'],
	isSA: true,
	shelterCode: null
};

const managerSH001: Caller = {
	name: 'mgr@x.com',
	roles: ['shelter:SH001', 'SH001:shelter_manager'],
	isSA: false,
	shelterCode: 'SH001'
};

const otherShelterManager: Caller = {
	name: 'mgr2@x.com',
	roles: ['shelter:SH002', 'SH002:shelter_manager'],
	isSA: false,
	shelterCode: 'SH002'
};

describe('staff card administration', () => {
	let usersDb: Record<string, StoredUser>;
	let puts: { path: string; body: StoredUser }[];

	function staffUser(name: string, overrides: Record<string, unknown> = {}): StoredUser {
		return { ...userDoc(name), _rev: '1-a', ...overrides } as StoredUser;
	}

	beforeEach(() => {
		usersDb = {};
		puts = [];
		vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected network call'));
		vi.spyOn(couchAdmin, 'adminRaw').mockImplementation(async (path, method = 'GET', body) => {
			const cleanPath = path.split('?')[0];
			if (method === 'POST' && cleanPath === '/_users/_find') return findUsers(usersDb, body);
			const userPath = cleanPath.match(/^\/_users\/(org\.couchdb\.user:.+)$/);
			if (userPath) {
				const id = decodeURIComponent(userPath[1]);
				const doc = usersDb[id];
				if (method === 'GET') {
					return doc
						? { status: 200, data: doc }
						: { status: 404, data: { error: 'not_found', reason: 'missing' } };
				}
				if (method === 'PUT') {
					const put = body as StoredUser;
					puts.push({ path: cleanPath, body: put });
					if (!doc || put._rev !== doc._rev) {
						return {
							status: 409,
							data: { error: 'conflict', reason: 'Document update conflict.' }
						};
					}
					usersDb[id] = { ...put, _rev: '2-b' };
					return { status: 201, data: { ok: true, id, rev: '2-b' } };
				}
			}
			throw new Error(`unexpected adminRaw ${method} ${path}`);
		});
	});

	describe('rotateStaffCard', () => {
		it('issues a new card for a staff user and invalidates the old one', async () => {
			usersDb['org.couchdb.user:somchai@x.com'] = staffUser('somchai@x.com', {
				display_name: 'สมชาย ใจดี',
				position: 'เจ้าหน้าที่ลงทะเบียน',
				staff_token_hash: HASH_A
			});

			const card = await rotateStaffCard(systemAdmin, 'somchai@x.com');

			expect(card).toMatchObject({
				name: 'somchai@x.com',
				display_name: 'สมชาย ใจดี',
				position: 'เจ้าหน้าที่ลงทะเบียน',
				roles: ['shelter:SH001', 'SH001:registration_staff']
			});
			expect(card.payload).toMatch(/^TKT-STF-HASH-[0-9a-f]{64}$/);
			expect(card.payload).not.toBe(`TKT-STF-HASH-${HASH_A}`);
			const err = await rejection(
				resolveStaffCard(distributionStaff, `TKT-STF-HASH-${HASH_A}`, 'SH001')
			);
			expect(err.code).toBe('NOT_FOUND');
			const resolved = await resolveStaffCard(distributionStaff, card.payload, 'SH001');
			expect(resolved).toMatchObject({ kind: 'staff', recipient_id: 'user:somchai@x.com' });
			expect(fetch).not.toHaveBeenCalled();
		});

		it('rejects a target user that does not exist as NOT_FOUND without writing', async () => {
			const err = await rejection(rotateStaffCard(systemAdmin, 'ghost@x.com'));

			expect(err.code).toBe('NOT_FOUND');
			expect(puts).toEqual([]);
		});

		it('rejects a user with a volunteer profile as CONFLICT without writing', async () => {
			usersDb['org.couchdb.user:vol@x.com'] = staffUser('vol@x.com', {
				volunteer_id: 'volunteer:01HZXVOL011',
				staff_token_hash: HASH_A
			});

			const err = await rejection(rotateStaffCard(systemAdmin, 'vol@x.com'));

			expect(err).toMatchObject({ code: 'CONFLICT', message: 'ผู้ใช้นี้ใช้บัตรจิตอาสา' });
			expect(puts).toEqual([]);
		});

		it('rejects a volunteer-type user without a linked profile as CONFLICT without writing', async () => {
			usersDb['org.couchdb.user:vol@x.com'] = staffUser('vol@x.com', {
				personnel_type: 'volunteer'
			});

			const err = await rejection(rotateStaffCard(systemAdmin, 'vol@x.com'));

			expect(err).toMatchObject({ code: 'CONFLICT', message: 'ผู้ใช้นี้ใช้บัตรจิตอาสา' });
			expect(puts).toEqual([]);
		});

		it.each([
			['a shelter the manager does not manage', ['shelter:SH001', 'shelter:SH002']],
			['only a shelter the manager does not manage', ['shelter:SH002', 'SH002:registration_staff']]
		])('forbids a manager from rotating staff who also belong to %s', async (_label, roles) => {
			usersDb['org.couchdb.user:somchai@x.com'] = staffUser('somchai@x.com', {
				roles,
				staff_token_hash: HASH_A
			});

			const err = await rejection(rotateStaffCard(managerSH001, 'somchai@x.com'));

			expect(err.code).toBe('FORBIDDEN');
			expect(puts).toEqual([]);
		});

		it('forbids a manager from rotating a user who belongs to no shelter', async () => {
			usersDb['org.couchdb.user:floating@x.com'] = staffUser('floating@x.com', {
				roles: [],
				staff_token_hash: HASH_A
			});

			const err = await rejection(rotateStaffCard(managerSH001, 'floating@x.com'));

			expect(err.code).toBe('FORBIDDEN');
			expect(puts).toEqual([]);
		});

		it.each([
			['another shelter manager', ['shelter:SH001', 'SH001:shelter_manager']],
			['a system admin', ['shelter:SH001', 'system_admin']]
		])('forbids a manager from rotating %s', async (_label, roles) => {
			usersDb['org.couchdb.user:boss@x.com'] = staffUser('boss@x.com', {
				roles,
				staff_token_hash: HASH_A
			});

			const err = await rejection(rotateStaffCard(managerSH001, 'boss@x.com'));

			expect(err.code).toBe('FORBIDDEN');
			expect(puts).toEqual([]);
		});

		it('reports a concurrent edit of the user document as CONFLICT and keeps the old card', async () => {
			usersDb['org.couchdb.user:somchai@x.com'] = staffUser('somchai@x.com', {
				staff_token_hash: HASH_A
			});
			const realAdminRaw = vi.mocked(couchAdmin.adminRaw).getMockImplementation()!;
			vi.mocked(couchAdmin.adminRaw).mockImplementation(async (path, method = 'GET', body) => {
				const result = await realAdminRaw(path, method, body);
				if (method === 'GET' && path.includes('somchai')) {
					usersDb['org.couchdb.user:somchai@x.com'] = {
						...usersDb['org.couchdb.user:somchai@x.com'],
						_rev: '1-concurrent'
					};
				}
				return result;
			});

			const err = await rejection(rotateStaffCard(systemAdmin, 'somchai@x.com'));

			expect(err.code).toBe('CONFLICT');
			expect(usersDb['org.couchdb.user:somchai@x.com'].staff_token_hash).toBe(HASH_A);
		});

		it('keeps every other field of the user document when storing the new hash', async () => {
			usersDb['org.couchdb.user:somchai@x.com'] = staffUser('somchai@x.com', {
				display_name: 'สมชาย ใจดี',
				staff_token_hash: HASH_A,
				password_scheme: 'pbkdf2',
				derived_key: 'dk-1',
				salt: 'salt-1',
				iterations: 10,
				phone: '0812345678'
			});
			const before = { ...usersDb['org.couchdb.user:somchai@x.com'] };

			await rotateStaffCard(systemAdmin, 'somchai@x.com');

			expect(puts).toHaveLength(1);
			const newHash = puts[0].body.staff_token_hash;
			expect(puts[0].body).toEqual({ ...before, staff_token_hash: newHash });
			expect(newHash).toMatch(/^[0-9a-f]{64}$/);
			expect(newHash).not.toBe(HASH_A);
			expect(puts[0].path).toBe('/_users/org.couchdb.user:somchai%40x.com');
		});

		it('lets a manager rotate staff who belong only to shelters the manager manages', async () => {
			usersDb['org.couchdb.user:somchai@x.com'] = staffUser('somchai@x.com', {
				staff_token_hash: HASH_A
			});

			const card = await rotateStaffCard(managerSH001, 'somchai@x.com');

			const resolved = await resolveStaffCard(distributionStaff, card.payload, 'SH001');
			expect(resolved).toMatchObject({ kind: 'staff', recipient_id: 'user:somchai@x.com' });
		});

		it('lets a system admin rotate a manager who has no shelter restriction', async () => {
			usersDb['org.couchdb.user:boss@x.com'] = staffUser('boss@x.com', {
				roles: ['shelter:SH001', 'SH001:shelter_manager', 'shelter:SH002']
			});

			const card = await rotateStaffCard(systemAdmin, 'boss@x.com');

			expect(card.payload).toMatch(/^TKT-STF-HASH-[0-9a-f]{64}$/);
		});

		it('issues the first card for a staff user who has none', async () => {
			usersDb['org.couchdb.user:newbie@x.com'] = staffUser('newbie@x.com');

			const card = await rotateStaffCard(systemAdmin, 'newbie@x.com');

			const resolved = await resolveStaffCard(distributionStaff, card.payload, 'SH001');
			expect(resolved).toMatchObject({ kind: 'staff', recipient_id: 'user:newbie@x.com' });
		});
	});

	describe('getStaffCardForAdmin', () => {
		it('returns the print payload and display fields of a staff user for a system admin', async () => {
			usersDb['org.couchdb.user:somchai@x.com'] = staffUser('somchai@x.com', {
				display_name: 'สมชาย ใจดี',
				position: 'เจ้าหน้าที่ลงทะเบียน',
				staff_token_hash: HASH_A
			});

			const card = await getStaffCardForAdmin(systemAdmin, 'somchai@x.com');

			expect(card).toEqual({
				name: 'somchai@x.com',
				display_name: 'สมชาย ใจดี',
				position: 'เจ้าหน้าที่ลงทะเบียน',
				roles: ['shelter:SH001', 'SH001:registration_staff'],
				payload: `TKT-STF-HASH-${HASH_A}`
			});
			expect(puts).toEqual([]);
			expect(fetch).not.toHaveBeenCalled();
		});

		it('rejects a target user that does not exist as NOT_FOUND', async () => {
			const err = await rejection(getStaffCardForAdmin(systemAdmin, 'ghost@x.com'));

			expect(err.code).toBe('NOT_FOUND');
		});

		it.each([
			['a manager of an unrelated shelter', otherShelterManager, ['shelter:SH001']],
			['a manager when the user belongs to no shelter', managerSH001, []]
		])('forbids %s from fetching the card', async (_label, caller, roles) => {
			usersDb['org.couchdb.user:somchai@x.com'] = staffUser('somchai@x.com', {
				roles,
				staff_token_hash: HASH_A
			});

			const err = await rejection(getStaffCardForAdmin(caller, 'somchai@x.com'));

			expect(err.code).toBe('FORBIDDEN');
		});

		it.each([
			['another manager of the same shelter', ['shelter:SH001', 'SH001:shelter_manager']],
			['a system admin', ['shelter:SH001', 'system_admin']]
		])('forbids a manager from fetching the card of %s', async (_label, roles) => {
			usersDb['org.couchdb.user:somchai@x.com'] = staffUser('somchai@x.com', {
				roles,
				staff_token_hash: HASH_A
			});

			const err = await rejection(getStaffCardForAdmin(managerSH001, 'somchai@x.com'));

			expect(err.code).toBe('FORBIDDEN');
		});

		it.each([
			['no token hash', undefined],
			['a malformed token hash', 'not-a-hash']
		])('rejects a user with %s as NOT_FOUND asking to rotate', async (_label, hash) => {
			usersDb['org.couchdb.user:somchai@x.com'] = staffUser('somchai@x.com', {
				staff_token_hash: hash
			});

			const err = await rejection(getStaffCardForAdmin(systemAdmin, 'somchai@x.com'));

			expect(err).toMatchObject({
				code: 'NOT_FOUND',
				message: 'ยังไม่มี QR กรุณาหมุน QR เพื่อออกบัตร'
			});
			expect(puts).toEqual([]);
		});

		it('lets a manager fetch the card of staff in a shelter the manager manages', async () => {
			usersDb['org.couchdb.user:somchai@x.com'] = staffUser('somchai@x.com', {
				roles: ['shelter:SH001', 'shelter:SH002'],
				staff_token_hash: HASH_A,
				phone: '0812345678',
				email: 'somchai@x.com'
			});

			const card = await getStaffCardForAdmin(managerSH001, 'somchai@x.com');

			expect(card.payload).toBe(`TKT-STF-HASH-${HASH_A}`);
			expect(Object.keys(card).sort()).toEqual([
				'display_name',
				'name',
				'payload',
				'position',
				'roles'
			]);
			expect(JSON.stringify(card)).not.toMatch(/0812345678/);
		});

		it('rejects a user with a volunteer profile as CONFLICT', async () => {
			usersDb['org.couchdb.user:vol@x.com'] = staffUser('vol@x.com', {
				volunteer_id: 'volunteer:01HZXVOL011',
				staff_token_hash: HASH_A
			});

			const err = await rejection(getStaffCardForAdmin(systemAdmin, 'vol@x.com'));

			expect(err).toMatchObject({ code: 'CONFLICT', message: 'ผู้ใช้นี้ใช้บัตรจิตอาสา' });
		});

		it('rejects a volunteer-type user without a linked profile as CONFLICT', async () => {
			usersDb['org.couchdb.user:vol@x.com'] = staffUser('vol@x.com', {
				personnel_type: 'volunteer',
				staff_token_hash: HASH_A
			});

			const err = await rejection(getStaffCardForAdmin(systemAdmin, 'vol@x.com'));

			expect(err).toMatchObject({ code: 'CONFLICT', message: 'ผู้ใช้นี้ใช้บัตรจิตอาสา' });
		});
	});
});
