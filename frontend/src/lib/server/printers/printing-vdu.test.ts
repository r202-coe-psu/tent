import { describe, expect, it } from 'vitest';
// eslint-disable-next-line no-restricted-imports -- server-safe domain rule; feature barrel pulls client UI/query code
import { canPrintSource } from '$lib/features/printers/domain/print-permission';
import { buildPrintingValidateDocUpdate } from './printing-vdu';

type Doc = Record<string, unknown>;
interface UserCtx {
	db: string;
	name: string | null;
	roles: string[];
}
type Vdu = (newDoc: Doc, oldDoc: Doc | null, userCtx: UserCtx, secObj: unknown) => void;

/** Compile the generated source exactly the way CouchDB's JS engine receives it. */
const vdu = new Function('return ' + buildPrintingValidateDocUpdate())() as Vdu;

const ACCEPTED = { ok: true };
const REJECTED = { forbidden: expect.any(String) as unknown };

/** CouchDB reports a VDU rejection as a thrown `{forbidden}` object; anything else is a bug. */
function verdict(newDoc: Doc, oldDoc: Doc | null, userCtx: UserCtx): unknown {
	try {
		vdu(newDoc, oldDoc, userCtx, { admins: {}, members: {} });
		return ACCEPTED;
	} catch (error) {
		if (typeof error === 'object' && error !== null && 'forbidden' in error) return error;
		throw error;
	}
}

const DB = 'printing_sh001';
const REG = ['shelter:SH001', 'SH001:registration_staff'];
const SM = ['shelter:SH001', 'SH001:shelter_manager'];
const KITCHEN = ['shelter:SH001', 'SH001:kitchen_staff'];
const OTHER_SHELTER = ['shelter:SH001', 'SH002:registration_staff'];

const ctx = (roles: string[], name: string | null = 'alice', db = DB): UserCtx => ({
	db,
	name,
	roles
});
const SERVICE = ctx([], 'printing_service');

function attachments(count: number, length = 2048): Record<string, Doc> {
	return Object.fromEntries(
		Array.from({ length: count }, (_, i) => [
			`label-${String(i).padStart(3, '0')}.png`,
			{ content_type: 'image/png', revpos: 1, length, stub: true }
		])
	);
}

function newJob(overrides: Doc = {}): Doc {
	return {
		_id: 'print_job:01J0000000000000000000000A',
		type: 'print_job',
		schema_v: 1,
		shelter_code: 'SH001',
		printer_id: 'print_device:dev-1',
		status: 'pending',
		label_count: 2,
		source: 'walk_in',
		created_at: '2026-11-01T00:00:00.000Z',
		created_by: 'alice',
		expires_at: '2026-11-01T01:00:00.000Z',
		claimed_at: null,
		lease_until: null,
		finished_at: null,
		printed: 0,
		error_code: null,
		_attachments: attachments(2),
		...overrides
	};
}

const stored = (overrides: Doc = {}): Doc => ({ ...newJob(), _rev: '1-abc', ...overrides });

describe('print_access VDU: staff create', () => {
	it('accepts a well-formed job from registration staff of the shelter', () => {
		expect(verdict(newJob(), null, ctx(REG))).toEqual(ACCEPTED);
	});

	it('accepts a system_admin', () => {
		expect(verdict(newJob(), null, ctx(['system_admin']))).toEqual(ACCEPTED);
	});

	it('rejects editing an existing job', () => {
		expect(verdict(newJob({ _rev: '2-x' }), stored(), ctx(REG))).toEqual(REJECTED);
	});

	it('rejects deleting a job', () => {
		const tombstone = { _id: 'print_job:01J0000000000000000000000A', _rev: '2-x', _deleted: true };
		expect(verdict(tombstone, stored(), ctx(REG))).toEqual(REJECTED);
	});

	it.each(['printed', 'failed', 'expired'])('rejects deleting a %s job', (status) => {
		const old = stored({ status, finished_at: '2026-11-01T00:03:00.000Z' });
		const tombstone = { _id: old._id, _rev: '2-x', _deleted: true };
		expect(verdict(tombstone, old, ctx(REG))).toEqual(REJECTED);
	});

	it('rejects a system_admin editing a job', () => {
		expect(verdict(newJob({ _rev: '2-x' }), stored(), ctx(['system_admin']))).toEqual(REJECTED);
	});

	it('rejects a doc id outside the print_job: namespace', () => {
		expect(verdict(newJob({ _id: 'print_device:x' }), null, ctx(REG))).toEqual(REJECTED);
	});

	it('rejects a doc type other than print_job', () => {
		expect(verdict(newJob({ type: 'print_device' }), null, ctx(REG))).toEqual(REJECTED);
	});

	it('rejects an unknown schema_v', () => {
		expect(verdict(newJob({ schema_v: 2 }), null, ctx(REG))).toEqual(REJECTED);
	});

	it.each(['printing', 'printed', 'failed', 'expired'])('rejects a job created as %s', (status) => {
		expect(verdict(newJob({ status }), null, ctx(REG))).toEqual(REJECTED);
	});

	it('rejects a forged created_by', () => {
		expect(verdict(newJob({ created_by: 'bob' }), null, ctx(REG))).toEqual(REJECTED);
	});

	it('rejects an anonymous caller even when created_by is null', () => {
		expect(verdict(newJob({ created_by: null }), null, ctx(REG, null))).toEqual(REJECTED);
	});

	it('rejects a shelter_code other than the database shelter', () => {
		expect(verdict(newJob({ shelter_code: 'SH002' }), null, ctx(REG))).toEqual(REJECTED);
	});

	it('accepts a lower-case shelter_code equal to the database shelter ignoring case', () => {
		expect(verdict(newJob({ shelter_code: 'sh001' }), null, ctx(REG))).toEqual(ACCEPTED);
	});

	it('rejects a role that does not match the job source (kitchen_staff)', () => {
		expect(verdict(newJob(), null, ctx(KITCHEN))).toEqual(REJECTED);
	});

	it('rejects a user whose role belongs to another shelter', () => {
		expect(verdict(newJob(), null, ctx(OTHER_SHELTER))).toEqual(REJECTED);
	});

	it('rejects a capability role without the shelter scope role', () => {
		expect(verdict(newJob(), null, ctx(['SH001:registration_staff']))).toEqual(REJECTED);
	});

	it('rejects a legacy flat role', () => {
		expect(verdict(newJob(), null, ctx(['shelter:SH001', 'registration_staff']))).toEqual(REJECTED);
	});

	it('rejects a test job from registration staff', () => {
		expect(verdict(newJob({ source: 'test' }), null, ctx(REG))).toEqual(REJECTED);
	});

	it('accepts a test job from a shelter manager', () => {
		expect(verdict(newJob({ source: 'test' }), null, ctx(SM))).toEqual(ACCEPTED);
	});

	it('rejects an unknown source', () => {
		expect(verdict(newJob({ source: 'bogus' }), null, ctx(SM))).toEqual(REJECTED);
	});

	it('rejects an inherited-property source such as constructor', () => {
		expect(verdict(newJob({ source: 'constructor' }), null, ctx(SM))).toEqual(REJECTED);
	});

	it.each([
		['created_at', 12345],
		['created_at', null],
		['expires_at', { $date: 'x' }],
		['expires_at', undefined]
	])('rejects a job whose %s is %j (not an ISO string)', (field, value) => {
		expect(verdict(newJob({ [field]: value }), null, ctx(REG))).toEqual(REJECTED);
	});

	it('rejects a printer_id outside print_device:', () => {
		expect(verdict(newJob({ printer_id: 'dev-1' }), null, ctx(REG))).toEqual(REJECTED);
	});

	it.each([0, 21, 1.5, '2', null])('rejects label_count %j', (label_count) => {
		expect(verdict(newJob({ label_count }), null, ctx(REG))).toEqual(REJECTED);
	});

	it('accepts the maximum of 20 labels', () => {
		const job = newJob({ label_count: 20, _attachments: attachments(20) });
		expect(verdict(job, null, ctx(REG))).toEqual(ACCEPTED);
	});

	it('rejects a job without attachments', () => {
		const job = newJob();
		delete job._attachments;
		expect(verdict(job, null, ctx(REG))).toEqual(REJECTED);
	});

	it('rejects fewer attachments than label_count', () => {
		expect(verdict(newJob({ label_count: 3 }), null, ctx(REG))).toEqual(REJECTED);
	});

	it('rejects more attachments than label_count', () => {
		expect(verdict(newJob({ _attachments: attachments(3) }), null, ctx(REG))).toEqual(REJECTED);
	});

	it('rejects attachments that are not named label-000.png, label-001.png, …', () => {
		const all = attachments(1);
		const wrong = { 'label-000.png': all['label-000.png'], 'a.png': all['label-000.png'] };
		expect(verdict(newJob({ _attachments: wrong }), null, ctx(REG))).toEqual(REJECTED);
	});

	it('rejects a gap in the attachment numbering', () => {
		const all = attachments(3);
		const gap = { 'label-000.png': all['label-000.png'], 'label-002.png': all['label-002.png'] };
		expect(verdict(newJob({ _attachments: gap }), null, ctx(REG))).toEqual(REJECTED);
	});

	it('rejects an attachment that is not image/png', () => {
		const bad = attachments(2);
		bad['label-001.png'] = { ...bad['label-001.png'], content_type: 'image/jpeg' };
		expect(verdict(newJob({ _attachments: bad }), null, ctx(REG))).toEqual(REJECTED);
	});

	it('accepts an attachment of exactly 64 KB', () => {
		const job = newJob({ _attachments: attachments(2, 65536) });
		expect(verdict(job, null, ctx(REG))).toEqual(ACCEPTED);
	});

	it('rejects an attachment of 64 KB + 1 byte', () => {
		const job = newJob({ _attachments: attachments(2, 65537) });
		expect(verdict(job, null, ctx(REG))).toEqual(REJECTED);
	});

	it('rejects an attachment without a numeric length', () => {
		const bad = attachments(2);
		bad['label-001.png'] = { content_type: 'image/png', revpos: 1, stub: true };
		expect(verdict(newJob({ _attachments: bad }), null, ctx(REG))).toEqual(REJECTED);
	});

	it('rejects a design doc from staff, even a system_admin', () => {
		const ddoc = { _id: '_design/x', views: {} };
		expect(verdict(ddoc, null, ctx(['system_admin']))).toEqual(REJECTED);
	});
});

describe('print_access VDU: printing_service', () => {
	const claimed = (): Doc =>
		stored({
			status: 'printing',
			claimed_at: '2026-11-01T00:01:00.000Z',
			lease_until: '2026-11-01T00:02:00.000Z'
		});

	function finish(from: Doc, status: string, overrides: Doc = {}): Doc {
		const next: Doc = { ...from, status, finished_at: '2026-11-01T00:03:00.000Z', ...overrides };
		delete next._attachments;
		return next;
	}

	/** What CouchDB passes as newDoc on a delete: only id, rev and the flag. */
	const deletion = (old: Doc): Doc => ({ _id: old._id, _rev: '2-x', _deleted: true });

	it('may claim a pending job (pending -> printing) keeping its attachments', () => {
		expect(verdict(claimed(), stored(), SERVICE)).toEqual(ACCEPTED);
	});

	it.each(['printed', 'failed'])('may finish a printing job as %s', (status) => {
		expect(verdict(finish(claimed(), status), claimed(), SERVICE)).toEqual(ACCEPTED);
	});

	it.each(['expired', 'failed'])('may close a pending job as %s', (status) => {
		expect(verdict(finish(stored(), status), stored(), SERVICE)).toEqual(ACCEPTED);
	});

	it.each([3, -1, 1.5, '2', null])('rejects a terminal write with printed = %j', (printed) => {
		// label_count is 2: printed must be an integer within 0..label_count
		expect(verdict(finish(claimed(), 'failed', { printed }), claimed(), SERVICE)).toEqual(REJECTED);
	});

	it.each([0, 1, 2])('accepts a terminal write with printed = %j within label_count', (printed) => {
		expect(verdict(finish(claimed(), 'failed', { printed }), claimed(), SERVICE)).toEqual(ACCEPTED);
	});

	it('rejects pending -> printed', () => {
		expect(verdict(finish(stored(), 'printed'), stored(), SERVICE)).toEqual(REJECTED);
	});

	it('rejects printing -> expired', () => {
		expect(verdict(finish(claimed(), 'expired'), claimed(), SERVICE)).toEqual(REJECTED);
	});

	it('rejects printing -> pending', () => {
		expect(verdict(stored({ status: 'pending' }), claimed(), SERVICE)).toEqual(REJECTED);
	});

	it('rejects a same-status rewrite', () => {
		expect(verdict(stored({ printed: 1 }), stored(), SERVICE)).toEqual(REJECTED);
	});

	it.each(['printed', 'failed', 'expired'])('rejects moving a %s job anywhere', (terminal) => {
		const done = finish(claimed(), terminal);
		for (const to of ['pending', 'printing', 'printed', 'failed', 'expired']) {
			const next = { ...done, status: to };
			expect(verdict(next, done, SERVICE)).toEqual(REJECTED);
		}
	});

	it.each(['printed', 'failed', 'expired'])(
		'rejects a terminal %s write that keeps attachments',
		(status) => {
			const from = status === 'expired' ? stored() : claimed();
			const next = { ...finish(from, status), _attachments: attachments(2) };
			expect(verdict(next, from, SERVICE)).toEqual(REJECTED);
		}
	);

	it('rejects a terminal write without finished_at', () => {
		const next = finish(claimed(), 'printed', { finished_at: null });
		expect(verdict(next, claimed(), SERVICE)).toEqual(REJECTED);
	});

	it('rejects creating a job', () => {
		expect(verdict(newJob({ created_by: 'printing_service' }), null, SERVICE)).toEqual(REJECTED);
	});

	it('rejects deleting a printing job', () => {
		expect(verdict(deletion(claimed()), claimed(), SERVICE)).toEqual(REJECTED);
	});

	it('rejects deleting a pending job', () => {
		expect(verdict(deletion(stored()), stored(), SERVICE)).toEqual(REJECTED);
	});

	it.each(['printed', 'failed', 'expired'])('may delete a %s job (retention)', (status) => {
		const old = finish(claimed(), status);
		expect(verdict(deletion(old), old, SERVICE)).toEqual(ACCEPTED);
	});

	it('rejects deleting when there is no stored doc', () => {
		const tombstone = { _id: 'print_job:01J0000000000000000000000A', _rev: '1-a', _deleted: true };
		expect(verdict(tombstone, null, SERVICE)).toEqual(REJECTED);
	});

	it('rejects deleting a terminal doc that is not a print_job', () => {
		const old = { _id: 'print_device:dev-1', _rev: '1-a', type: 'print_device', status: 'printed' };
		expect(verdict(deletion(old), old, SERVICE)).toEqual(REJECTED);
	});

	it('rejects a type change', () => {
		const next = { ...claimed(), type: 'print_device' };
		expect(verdict(next, stored(), SERVICE)).toEqual(REJECTED);
	});

	it('rejects touching a doc that is not a print_job', () => {
		const old = { _id: 'x', _rev: '1-a', type: 'other', status: 'pending' };
		expect(verdict({ ...old, status: 'printing' }, old, SERVICE)).toEqual(REJECTED);
	});

	it.each([
		['created_by', 'mallory'],
		['shelter_code', 'SH002'],
		['printer_id', 'print_device:other'],
		['source', 'test'],
		['label_count', 3],
		['created_at', '2020-01-01T00:00:00.000Z'],
		['expires_at', '2099-01-01T00:00:00.000Z']
	])('rejects changing immutable field %s', (field, value) => {
		const next = { ...claimed(), [field]: value };
		expect(verdict(next, stored(), SERVICE)).toEqual(REJECTED);
	});

	it('rejects a design doc', () => {
		expect(verdict({ _id: '_design/x' }, null, SERVICE)).toEqual(REJECTED);
	});
});

describe('print_access VDU: server admin', () => {
	const ADMIN = ctx(['_admin'], 'admin');

	it('allows creating anything', () => {
		expect(verdict(newJob({ created_by: 'someone-else', status: 'printed' }), null, ADMIN)).toEqual(
			ACCEPTED
		);
	});

	it('allows deleting', () => {
		const tombstone = { _id: 'print_job:x', _rev: '2-x', _deleted: true };
		expect(verdict(tombstone, stored(), ADMIN)).toEqual(ACCEPTED);
	});

	it('allows writing the design doc', () => {
		expect(verdict({ _id: '_design/print_access', validate_doc_update: '' }, null, ADMIN)).toEqual(
			ACCEPTED
		);
	});
});

describe('print_access VDU: one table with the BFF', () => {
	const roleSets: Record<string, string[]> = {
		none: [],
		system_admin: ['system_admin'],
		registration_staff: REG,
		shelter_manager: SM,
		kitchen_staff: KITCHEN,
		other_shelter: OTHER_SHELTER,
		no_scope: ['SH001:registration_staff'],
		legacy_flat: ['shelter:SH001', 'registration_staff'],
		other_shelter_manager: ['shelter:SH001', 'shelter:SH002', 'SH002:shelter_manager'],
		registration_plus_other_manager: [
			'shelter:SH001',
			'SH001:registration_staff',
			'SH002:shelter_manager'
		]
	};
	const sources = ['walk_in', 'evacuee_qr', 'test', 'bogus'];

	for (const [label, roles] of Object.entries(roleSets)) {
		for (const source of sources) {
			it(`${label} x ${source}: canPrintSource matches the VDU create verdict`, () => {
				const expected = canPrintSource(roles, 'SH001', source);
				const actual = verdict(newJob({ source }), null, ctx(roles)) === ACCEPTED;
				expect(actual).toBe(expected);
			});
		}
	}
});
