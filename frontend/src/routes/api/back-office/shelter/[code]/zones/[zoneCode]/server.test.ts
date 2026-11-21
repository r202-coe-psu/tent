import { describe, it, expect, beforeEach, vi } from 'vitest';

type Zone = Record<string, unknown> & { code: string; status: string };
type Doc = Record<string, unknown> & { zones: Zone[] };

const state = vi.hoisted(() => ({
	doc: null as unknown as Record<string, unknown>,
	actor: null as string | null,
	legacyAudit: null as Record<string, unknown> | null
}));

vi.mock('$lib/server/couch-admin', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/couch-admin')>();
	return {
		...actual,
		requireShelterManagerOrSA: vi.fn(async () => ({
			name: 'sm01',
			roles: ['shelter:SH001', 'SH001:shelter_manager'],
			isSA: false,
			shelterCode: 'SH001'
		})),
		adminRaw: vi.fn(async (_path: string, _method: string, body?: unknown) => {
			state.legacyAudit = body as Record<string, unknown>;
			return { status: 201, data: { ok: true } };
		})
	};
});

vi.mock('$lib/server/shelters.admin', () => ({
	nowIso: () => '2026-11-19T00:00:00.000Z',
	updateMaster: vi.fn(
		async (
			_code: string,
			actor: string,
			mutator: (c: Doc) => { patch: Record<string, unknown>; meta: unknown }
		) => {
			state.actor = actor;
			const before = state.doc;
			const { patch, meta } = mutator(state.doc as Doc);
			const after = { ...state.doc, ...patch };
			state.doc = after;
			return { meta, before, after };
		}
	)
}));

const recordAuditedWrite = vi.hoisted(() => vi.fn(async () => true));
vi.mock('$lib/server/audit-log', () => ({ recordAuditedWrite }));

import { POST as CLOSE } from './+server';
import { POST as REOPEN } from './reopen/+server';

function ctx(body: unknown) {
	const request = new Request('http://localhost/api/back-office/shelter/SH001/zones/Z1', {
		method: 'POST',
		headers: { cookie: 'AuthSession=abc', 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
	return { request, params: { code: 'SH001', zoneCode: 'Z1' } } as Parameters<typeof CLOSE>[0];
}

const zones = (status: string): Zone[] => [
	{ code: 'Z1', name: 'โซน 1', status, closed_by: null, reopened_by: null }
];

beforeEach(() => {
	vi.clearAllMocks();
	state.actor = null;
	state.legacyAudit = null;
	state.doc = { _id: 'shelter:SH001', _rev: '1-a', name: 'ศูนย์ A', zones: zones('active') };
});

describe('POST zones/[zoneCode] — CR-259 the actor is the caller, never the body', () => {
	it('ignores closed_by from the body and stamps the signed-in caller', async () => {
		const res = await CLOSE(ctx({ reason: 'น้ำท่วม', closed_by: 'someone-else' }));

		expect(res.status).toBe(200);
		const zone = (state.doc as Doc).zones[0];
		expect(zone.status).toBe('closed');
		expect(zone.closed_by).toBe('sm01');
		expect(state.actor).toBe('sm01');
	});

	it('writes the same actor to the legacy audit doc and the central event', async () => {
		await CLOSE(ctx({ reason: 'น้ำท่วม', closed_by: 'someone-else' }));

		expect((state.legacyAudit?.context as { actor?: string }).actor).toBe('sm01');
		expect(recordAuditedWrite).toHaveBeenCalledTimes(1);
		expect(recordAuditedWrite.mock.calls[0][0]).toMatchObject({
			actor: 'sm01',
			action: 'status_change',
			entityType: 'shelter',
			entityId: 'SH001',
			shelterCode: 'SH001'
		});
	});

	it('answers 409 and records nothing when the zone is already closed', async () => {
		state.doc = { ...state.doc, zones: zones('closed') };

		const res = await CLOSE(ctx({ reason: 'ซ้ำ' }));

		expect(res.status).toBe(409);
		expect(recordAuditedWrite).not.toHaveBeenCalled();
	});
});

describe('POST zones/[zoneCode]/reopen — CR-259', () => {
	it('ignores reopened_by from the body and stamps the signed-in caller', async () => {
		state.doc = { ...state.doc, zones: zones('closed') };

		const res = await REOPEN(ctx({ reopened_by: 'someone-else' }));

		expect(res.status).toBe(200);
		const zone = (state.doc as Doc).zones[0];
		expect(zone.status).toBe('active');
		expect(zone.reopened_by).toBe('sm01');
		expect(recordAuditedWrite.mock.calls[0][0]).toMatchObject({ actor: 'sm01' });
	});

	it('answers 409 and records nothing when the zone is already active', async () => {
		const res = await REOPEN(ctx({}));

		expect(res.status).toBe(409);
		expect(recordAuditedWrite).not.toHaveBeenCalled();
	});
});
