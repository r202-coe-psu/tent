import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as couchAdmin from './couch-admin';
import { ServiceError } from './couch-admin';
import { evaluatePersonQr, parsePersonQr } from '$lib/utils/evacuee-qr';
import {
	getEvacueeQrPrints,
	hash6Of,
	issueEvacueeQr,
	type EvacueeQrDoc
} from './evacuee-qr-service';

const EVACUEE = 'evacuee:01JC8ZQ4V6M2N5R7T9XBDEFGH0';
const DOC_ID = 'evacuee_qr:01JC8ZQ4V6M2N5R7T9XBDEFGH0';
const DB = '/shelter_sh001';

type Fake = {
	evacuee: boolean;
	doc: EvacueeQrDoc | null;
	rev: number;
	puts: EvacueeQrDoc[];
	conflicts: number;
};

function install(fake: Fake) {
	vi.spyOn(couchAdmin, 'adminRaw').mockImplementation(async (path, method = 'GET', body) => {
		if (path === `${DB}/${encodeURIComponent(EVACUEE)}`) {
			return fake.evacuee
				? { status: 200, data: { _id: EVACUEE } }
				: { status: 404, data: { error: 'not_found' } };
		}
		if (path !== `${DB}/${encodeURIComponent(DOC_ID)}`) throw new Error(`unexpected ${path}`);
		if (method === 'GET') {
			return fake.doc
				? { status: 200, data: { ...fake.doc, _rev: `${fake.rev}-x` } }
				: { status: 404, data: { error: 'not_found' } };
		}
		const put = body as EvacueeQrDoc;
		if (fake.conflicts > 0) {
			fake.conflicts--;
			return { status: 409, data: { error: 'conflict' } };
		}
		fake.puts.push(put);
		fake.rev++;
		fake.doc = put;
		return { status: 201, data: { ok: true } };
	});
}

const fresh = (over: Partial<Fake> = {}): Fake => ({
	evacuee: true,
	doc: null,
	rev: 0,
	puts: [],
	conflicts: 0,
	...over
});

const input = {
	shelter_code: 'SH001',
	evacuee_id: EVACUEE,
	source: 'profile' as const,
	printed_by: 'staff01'
};

describe('issueEvacueeQr', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-11-06T08:15:30.123Z'));
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('hash6 matches the FR-EQR-3 test vector', () => {
		expect(hash6Of('2026-11-06T08:15:30.123Z')).toBe('683508');
	});

	it('creates the doc with the first entry and returns the payload', async () => {
		const fake = fresh();
		install(fake);
		const out = await issueEvacueeQr(input);
		expect(out).toEqual({
			evacuee_id: EVACUEE,
			qr_payload: `${EVACUEE}@683508`,
			printed_at: '2026-11-06T08:15:30.123Z'
		});
		expect(fake.puts[0]).toEqual({
			_id: DOC_ID,
			type: 'evacuee_qr',
			schema_v: 1,
			shelter_code: 'SH001',
			evacuee_id: EVACUEE,
			prints: [
				{
					printed_at: '2026-11-06T08:15:30.123Z',
					hash: '683508',
					printed_by: 'staff01',
					source: 'profile'
				}
			],
			created_at: '2026-11-06T08:15:30.123Z',
			updated_at: '2026-11-06T08:15:30.123Z',
			created_by: 'staff01'
		});
		expect(parsePersonQr(out.qr_payload)?.hash6).toBe('683508');
	});

	it('appends with _rev, keeps old entries, and expires the previous payload', async () => {
		const fake = fresh();
		install(fake);
		const first = await issueEvacueeQr(input);
		vi.setSystemTime(new Date('2026-11-06T09:00:00.000Z'));
		const second = await issueEvacueeQr({
			...input,
			source: 'family_batch',
			printed_by: 'staff02'
		});
		expect(fake.puts).toHaveLength(2);
		expect(fake.puts[1].prints[0]).toEqual(fake.puts[0].prints[0]);
		expect(fake.puts[1].prints).toHaveLength(2);
		expect(fake.puts[1].updated_at).toBe('2026-11-06T09:00:00.000Z');
		expect(fake.puts[1].created_at).toBe(fake.puts[0].created_at);
		expect(fake.puts[1]._rev).toBe('1-x');

		const prints = await getEvacueeQrPrints('SH001', EVACUEE);
		const verdict = (p: string) => evaluatePersonQr(parsePersonQr(p)!.hash6, prints).status;
		expect(verdict(first.qr_payload)).toBe('expired');
		expect(verdict(second.qr_payload)).toBe('valid');
	});

	it('keeps printed_at strictly increasing when the clock goes backwards', async () => {
		const fake = fresh();
		install(fake);
		await issueEvacueeQr(input);
		vi.setSystemTime(new Date('2026-11-06T08:00:00.000Z'));
		const second = await issueEvacueeQr(input);
		expect(second.printed_at).toBe('2026-11-06T08:15:30.124Z');
		expect(fake.puts[1].prints[1].hash).toBe(hash6Of('2026-11-06T08:15:30.124Z'));
	});

	it('re-rolls +1 ms when the hash collides with an existing entry', async () => {
		const now = '2026-11-06T08:15:30.123Z';
		const fake = fresh();
		// Existing entry from before "now" whose hash equals hash6Of(now): force the collision.
		fake.doc = {
			_id: DOC_ID,
			type: 'evacuee_qr',
			schema_v: 1,
			shelter_code: 'SH001',
			evacuee_id: EVACUEE,
			prints: [
				{
					printed_at: '2026-11-06T08:00:00.000Z',
					hash: hash6Of(now),
					printed_by: 'a',
					source: 'profile'
				}
			],
			created_at: '2026-11-06T08:00:00.000Z',
			updated_at: '2026-11-06T08:00:00.000Z',
			created_by: 'a'
		};
		install(fake);
		const out = await issueEvacueeQr(input);
		expect(out.printed_at).toBe('2026-11-06T08:15:30.124Z');
		const hashes = fake.puts[0].prints.map((p) => p.hash);
		expect(new Set(hashes).size).toBe(2);
	});

	it('retries on 409 and re-reads the doc', async () => {
		const fake = fresh({ conflicts: 2 });
		install(fake);
		const out = await issueEvacueeQr(input);
		expect(out.qr_payload).toMatch(/@[0-9a-f]{6}$/);
		expect(fake.puts).toHaveLength(1);
	});

	it('throws CONFLICT after 5 conflicting attempts', async () => {
		const fake = fresh({ conflicts: 99 });
		install(fake);
		const err = await issueEvacueeQr(input).catch((e) => e);
		expect(err).toBeInstanceOf(ServiceError);
		expect((err as ServiceError).code).toBe('CONFLICT');
		const puts = vi.mocked(couchAdmin.adminRaw).mock.calls.filter((c) => c[1] === 'PUT');
		expect(puts).toHaveLength(5);
	});

	it('writes nothing when the evacuee is missing', async () => {
		const fake = fresh({ evacuee: false });
		install(fake);
		const err = await issueEvacueeQr(input).catch((e) => e);
		expect((err as ServiceError).code).toBe('NOT_FOUND');
		expect(vi.mocked(couchAdmin.adminRaw).mock.calls.some((c) => c[1] === 'PUT')).toBe(false);
	});

	it('rejects a malformed evacuee_id', async () => {
		install(fresh());
		const err = await issueEvacueeQr({ ...input, evacuee_id: 'evacuee:nope@abc' }).catch((e) => e);
		expect((err as ServiceError).code).toBe('VALIDATION');
	});
});

describe('getEvacueeQrPrints', () => {
	afterEach(() => vi.restoreAllMocks());

	it('returns [] for a missing doc', async () => {
		install(fresh());
		expect(await getEvacueeQrPrints('SH001', EVACUEE)).toEqual([]);
	});
});
