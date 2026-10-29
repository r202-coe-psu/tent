import { describe, expect, it, vi } from 'vitest';
import type { CouchReq } from './ensure-public-writer';
import {
	USERS_GUARD_DESIGN_ID,
	USERS_GUARD_DESIGN_VERSION,
	buildUsersGuardDesignDoc,
	buildUsersGuardValidateDocUpdate,
	deployUsersGuardDesign
} from './users-guard-design';

type Doc = Record<string, unknown>;
type Vdu = (newDoc: Doc, oldDoc: Doc | null, userCtx: { name: string; roles: string[] }) => void;

/** The deployed function text, run as CouchDB would (a plain function, no TS). */
const vdu = new Function(`return ${buildUsersGuardValidateDocUpdate()}`)() as Vdu;

const ADMIN = { name: 'admin', roles: ['_admin'] };
const SELF = { name: 'vol@example.com', roles: ['shelter:SH001', 'SH001:kitchen_staff'] };

const GRANT = {
	shelter_code: 'SH001',
	role: 'kitchen_staff',
	expires_at: '2026-10-31T16:59:59.999Z',
	granted_by: 'staff03',
	granted_at: '2026-10-28T01:30:00.000Z',
	verified_by: { shelter_code: 'SH001', volunteer_id: 'volunteer:V1' }
};

const stored = (): Doc => ({
	_id: 'org.couchdb.user:vol@example.com',
	_rev: '3-a',
	type: 'user',
	name: 'vol@example.com',
	roles: ['shelter:SH001', 'SH001:kitchen_staff'],
	personnel_type: 'volunteer',
	volunteer_id: 'volunteer:V1',
	active: true,
	role_grants: [GRANT],
	display_name: 'สมชาย',
	derived_key: 'k',
	salt: 's'
});

const write = (over: Doc, userCtx = SELF, old: Doc | null = stored()) =>
	vdu({ ...(old ?? stored()), ...over }, old, userCtx);

describe('_users/_design/tent_guard validate_doc_update (FR-11, AC-7)', () => {
	it.each([
		['removing role_grants', { role_grants: undefined }],
		['emptying role_grants', { role_grants: [] }],
		['pushing the expiry out', { role_grants: [{ ...GRANT, expires_at: '2099-01-01T00:00:00Z' }] }],
		['dropping verified_by', { role_grants: [{ ...GRANT, verified_by: undefined }] }],
		['adding a grant', { role_grants: [GRANT, { ...GRANT, role: 'facility_staff' }] }],
		['changing active', { active: false }],
		['changing personnel_type', { personnel_type: 'staff' }],
		['changing volunteer_id', { volunteer_id: 'volunteer:OTHER' }],
		['removing volunteer_id', { volunteer_id: undefined }]
	])('refuses a user %s on their own doc', (_label, over) => {
		expect(() => write(over)).toThrow();
		try {
			write(over);
		} catch (e) {
			expect(e).toMatchObject({ forbidden: expect.stringContaining('administrator') });
		}
	});

	it('refuses a user giving themselves grants they never had', () => {
		const old = { ...stored(), role_grants: undefined };
		expect(() => write({ role_grants: [GRANT] }, SELF, old)).toThrow();
	});

	it('refuses a non-admin creating a doc with guarded fields', () => {
		expect(() =>
			vdu({ _id: 'org.couchdb.user:new', name: 'new', active: true }, null, {
				name: null as never,
				roles: []
			})
		).toThrow();
	});

	it('lets a user change their password and other profile fields', () => {
		expect(() =>
			write({ password: 'New-Pass-123!', display_name: 'ชื่อใหม่', phone: '0812345678' })
		).not.toThrow();
		expect(() => write({ derived_key: 'k2', salt: 's2', password_scheme: 'pbkdf2' })).not.toThrow();
	});

	it('ignores key order and a missing field equal to null', () => {
		const reordered = {
			...GRANT,
			verified_by: { volunteer_id: 'volunteer:V1', shelter_code: 'SH001' },
			role: 'kitchen_staff'
		};
		expect(() => write({ role_grants: [reordered] })).not.toThrow();
		const old = { ...stored(), role_grants: undefined, volunteer_id: null };
		expect(() => write({ role_grants: [], volunteer_id: undefined }, SELF, old)).not.toThrow();
	});

	it('lets an admin (the BFF and the worker) change every guarded field', () => {
		expect(() =>
			write({ role_grants: [], active: false, personnel_type: 'staff', volunteer_id: null }, ADMIN)
		).not.toThrow();
	});

	it('does not look at deletions or at docs that are not users', () => {
		expect(() =>
			vdu({ _id: 'org.couchdb.user:vol@example.com', _deleted: true }, stored(), SELF)
		).not.toThrow();
		expect(() => vdu({ _id: '_design/other', active: true }, null, SELF)).not.toThrow();
	});
});

describe('deployUsersGuardDesign', () => {
	const respond = (existing: unknown) =>
		vi.fn<CouchReq>(async (method) =>
			method === 'GET'
				? existing
					? { status: 200, data: existing }
					: { status: 404, data: { error: 'not_found' } }
				: { status: 201, data: { ok: true } }
		);

	it('creates the design doc when missing', async () => {
		const couchReq = respond(null);
		await expect(deployUsersGuardDesign(couchReq, false)).resolves.toBe('deployed');
		expect(couchReq).toHaveBeenLastCalledWith(
			'PUT',
			`/_users/${USERS_GUARD_DESIGN_ID}`,
			buildUsersGuardDesignDoc()
		);
	});

	it('does not write when the version and function are current (idempotent)', async () => {
		const couchReq = respond({ ...buildUsersGuardDesignDoc(), _rev: '1-a' });
		await expect(deployUsersGuardDesign(couchReq, false)).resolves.toBe('current');
		expect(couchReq).toHaveBeenCalledTimes(1);
	});

	it('replaces a stale version, keeping the _rev', async () => {
		const couchReq = respond({
			...buildUsersGuardDesignDoc(),
			version: USERS_GUARD_DESIGN_VERSION - 1,
			_rev: '1-a'
		});
		await expect(deployUsersGuardDesign(couchReq, false)).resolves.toBe('deployed');
		expect(couchReq).toHaveBeenLastCalledWith(
			'PUT',
			`/_users/${USERS_GUARD_DESIGN_ID}`,
			expect.objectContaining({ _rev: '1-a' })
		);
	});

	it('only reports on a dry run', async () => {
		const couchReq = respond(null);
		await expect(deployUsersGuardDesign(couchReq, true)).resolves.toBe('deployed');
		expect(couchReq).toHaveBeenCalledTimes(1);
	});

	it('fails loudly when CouchDB refuses', async () => {
		const couchReq = vi.fn<CouchReq>(async (method) =>
			method === 'GET' ? { status: 404, data: null } : { status: 403, data: { reason: 'nope' } }
		);
		await expect(deployUsersGuardDesign(couchReq, false)).rejects.toThrow(/nope/);
	});
});
