import { describe, it, expect, beforeEach, vi } from 'vitest';

// #1186: warehouse staff manage a shelter's storage points through an endpoint that writes
// `common_areas.sub_storage` and nothing else. The registry is an in-memory doc; `updateMaster`
// runs the route's mutator against it like the real one (patch over the doc, bumped `_rev`).

type Doc = Record<string, unknown> & { _rev: string; common_areas: { sub_storage: unknown[] } };
type Selector = { item_id: string | { $gt: null }; 'lot.storage_point_id'?: string };
type FindBody = { selector: Selector; limit: number; bookmark?: string };
type Row = Record<string, unknown> & { item_id: string };

const state = vi.hoisted(() => ({
	roles: [] as string[],
	doc: null as unknown as Record<string, unknown>,
	ledger: [] as Record<string, unknown>[]
}));

vi.mock('$lib/server/couch-admin', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/couch-admin')>();
	return {
		...actual,
		authorizeSession: vi.fn(async () => ({
			name: 'u',
			roles: state.roles,
			isSA: state.roles.includes('system_admin'),
			shelterCode: null
		})),
		// Like `_find`: filter, then a page of `limit` rows from the `bookmark` (an offset here).
		adminRaw: vi.fn(async (_path: string, _method: string, body: FindBody) => {
			const sel = body.selector;
			const all = (state.ledger as Row[]).filter((r) =>
				'lot.storage_point_id' in sel
					? (r.lot as { storage_point_id?: string } | undefined)?.storage_point_id ===
						sel['lot.storage_point_id']
					: r.item_id === sel.item_id
			);
			const from = Number(body.bookmark ?? 0);
			const docs = all.slice(from, from + body.limit);
			return {
				status: 200,
				data: {
					docs: 'lot.storage_point_id' in sel ? docs.map((r) => ({ item_id: r.item_id })) : docs,
					bookmark: String(from + docs.length)
				}
			};
		})
	};
});

vi.mock('$lib/server/shelters.admin', () => ({
	findMasterByCode: vi.fn(async () => state.doc),
	migrate: (d: unknown) => d,
	nowIso: () => '2026-11-05T00:00:00.000Z',
	updateMaster: vi.fn(
		async (_code: string, mutator: (c: Doc) => Promise<{ patch: Record<string, unknown> }>) => {
			const { patch } = await mutator(state.doc as Doc);
			const rev = `${Number.parseInt(String(state.doc._rev), 10) + 1}-new`;
			state.doc = { ...state.doc, ...patch, _rev: rev };
			return { id: 'shelter:SH001', rev };
		}
	)
}));

import { GET, POST } from './+server';
import { PATCH, DELETE } from './[pointId]/+server';

const WS = ['shelter:SH001', 'SH001:warehouse_staff'];
const point = (id: string, name = 'ห้อง') => ({
	id,
	name,
	types: ['general'],
	area_m2: null,
	accepts_donations: false,
	lat: null,
	lng: null,
	location_note: null
});

function ctx(method: string, code: string, body?: unknown, pointId?: string) {
	const request = new Request(`http://localhost/api/back-office/shelter/${code}/storage-points`, {
		method,
		headers: { cookie: 'AuthSession=abc', 'content-type': 'application/json' },
		...(body !== undefined ? { body: JSON.stringify(body) } : {})
	});
	return { request, params: { code, pointId } } as never;
}

const subStorage = () =>
	(state.doc as Doc).common_areas.sub_storage as { id: string; name: string }[];

beforeEach(() => {
	state.roles = WS;
	state.ledger = [];
	state.doc = {
		_id: 'shelter:SH001',
		_rev: '1-a',
		type: 'shelter',
		code: 'SH001',
		name: 'ศูนย์ 1',
		capacity: 100,
		common_areas: { central_kitchen: true, sub_storage: [point('P1', 'ห้อง 1')] }
	};
});

describe('POST /storage-points (add)', () => {
	it('lets the shelter warehouse_staff add a point, with a server-issued ULID id', async () => {
		const res = await POST(
			ctx('POST', 'SH001', { _rev: '1-a', point: { ...point('hacked', 'คลังใหม่') } })
		);
		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.point.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
		expect(body.point.id).not.toBe('hacked');
		expect(subStorage().map((p) => p.name)).toEqual(['ห้อง 1', 'คลังใหม่']);
		expect(body.rev).toBe('2-new');
	});

	it.each([['warehouse_staff'], ['shelter_manager']])('allows %s of the shelter', async (cap) => {
		state.roles = ['shelter:SH001', `SH001:${cap}`];
		expect((await POST(ctx('POST', 'SH001', { _rev: '1-a', point: point('x') }))).status).toBe(201);
	});

	it('refuses warehouse_staff of another shelter with 403 and writes nothing', async () => {
		state.roles = ['shelter:SH002', 'SH002:warehouse_staff'];
		const res = await POST(ctx('POST', 'SH001', { _rev: '1-a', point: point('x') }));
		expect(res.status).toBe(403);
		expect(subStorage()).toHaveLength(1);
	});

	it.each([['supply_coordinator'], ['kitchen_staff'], ['donation_staff'], ['registration_staff']])(
		'refuses %s of the shelter with 403',
		async (cap) => {
			state.roles = ['shelter:SH001', `SH001:${cap}`];
			expect((await POST(ctx('POST', 'SH001', { _rev: '1-a', point: point('x') }))).status).toBe(
				403
			);
			expect(subStorage()).toHaveLength(1);
		}
	);

	it('ignores other shelter fields in the body — only sub_storage changes', async () => {
		const res = await POST(
			ctx('POST', 'SH001', {
				_rev: '1-a',
				point: point('x', 'คลังใหม่'),
				name: 'ถูกแก้',
				capacity: 9999,
				operation_status: 'closed',
				common_areas: { central_kitchen: false, sub_storage: [] }
			})
		);
		expect(res.status).toBe(201);
		expect(state.doc.name).toBe('ศูนย์ 1');
		expect(state.doc.capacity).toBe(100);
		expect(state.doc).not.toHaveProperty('operation_status');
		expect((state.doc as Doc).common_areas).toMatchObject({ central_kitchen: true });
		expect(subStorage()).toHaveLength(2);
	});

	it('answers 409 for a stale _rev and leaves the doc alone', async () => {
		const res = await POST(ctx('POST', 'SH001', { _rev: '0-old', point: point('x') }));
		expect(res.status).toBe(409);
		expect(subStorage()).toHaveLength(1);
		expect(state.doc._rev).toBe('1-a');
	});

	it('answers 422 for an invalid point (no name)', async () => {
		const res = await POST(
			ctx('POST', 'SH001', { _rev: '1-a', point: { ...point('x'), name: '  ' } })
		);
		expect(res.status).toBe(422);
	});
});

describe('PATCH /storage-points/[pointId] (edit)', () => {
	it('edits the point by path id, ignoring an id in the body', async () => {
		const res = await PATCH(
			ctx('PATCH', 'SH001', { _rev: '1-a', point: point('other', 'ชื่อใหม่') }, 'P1')
		);
		expect(res.status).toBe(200);
		expect(subStorage()).toEqual([expect.objectContaining({ id: 'P1', name: 'ชื่อใหม่' })]);
	});

	it('refuses another shelter warehouse_staff and kitchen_staff', async () => {
		for (const roles of [
			['shelter:SH002', 'SH002:warehouse_staff'],
			['shelter:SH001', 'SH001:kitchen_staff']
		]) {
			state.roles = roles;
			expect(
				(await PATCH(ctx('PATCH', 'SH001', { _rev: '1-a', point: point('P1') }, 'P1'))).status
			).toBe(403);
		}
		expect(subStorage()[0].name).toBe('ห้อง 1');
	});

	it('answers 409 for a stale _rev and 404 for an unknown point', async () => {
		expect(
			(await PATCH(ctx('PATCH', 'SH001', { _rev: '0-old', point: point('P1') }, 'P1'))).status
		).toBe(409);
		expect(
			(await PATCH(ctx('PATCH', 'SH001', { _rev: '1-a', point: point('nope') }, 'nope'))).status
		).toBe(404);
	});
});

describe('DELETE /storage-points/[pointId]', () => {
	const inbound = (id: string, qty: string) => ({
		_id: `stock_ledger:${id}`,
		type: 'stock_ledger',
		item_id: 'item:a',
		unit: 'kg',
		qty,
		reason: 'receive',
		occurred_at: '2026-01-01T00:00:00.000Z',
		lot: { storage_point_id: 'P1' }
	});

	it('deletes a point with no stock', async () => {
		const res = await DELETE(ctx('DELETE', 'SH001', { _rev: '1-a' }, 'P1'));
		expect(res.status).toBe(200);
		expect(subStorage()).toEqual([]);
	});

	it('deletes a point whose lots were all issued', async () => {
		state.ledger = [
			inbound('L1', '5'),
			{
				...inbound('O1', '-5'),
				reason: 'distribute',
				lot_ref: 'stock_ledger:L1',
				occurred_at: '2026-01-02T00:00:00.000Z',
				lot: undefined
			}
		];
		expect((await DELETE(ctx('DELETE', 'SH001', { _rev: '1-a' }, 'P1'))).status).toBe(200);
	});

	it('answers 409 and keeps the point while a lot with qty > 0 sits there', async () => {
		state.ledger = [inbound('L1', '5')];
		const res = await DELETE(ctx('DELETE', 'SH001', { _rev: '1-a' }, 'P1'));
		expect(res.status).toBe(409);
		expect((await res.json()).error.message).toContain('1 ล็อต');
		expect(subStorage()).toHaveLength(1);
	});

	it('reads the whole history of an item, past one page, before it deletes', async () => {
		const elsewhere = Array.from({ length: 2400 }, (_, i) => ({
			...inbound(`F${i}`, '1'),
			lot: { storage_point_id: 'P2' }
		}));
		// The lot at P1 is the last row, on the third page of the item's history.
		state.ledger = [...elsewhere, inbound('L1', '5')];
		const res = await DELETE(ctx('DELETE', 'SH001', { _rev: '1-a' }, 'P1'));
		expect(res.status).toBe(409);
		expect((await res.json()).error.message).toContain('1 ล็อต');
		expect(subStorage()).toHaveLength(1);
	});

	it('answers 409 for a stale _rev', async () => {
		expect((await DELETE(ctx('DELETE', 'SH001', { _rev: '0-old' }, 'P1'))).status).toBe(409);
		expect(subStorage()).toHaveLength(1);
	});

	it('refuses another shelter warehouse_staff with 403', async () => {
		state.roles = ['shelter:SH002', 'SH002:warehouse_staff'];
		expect((await DELETE(ctx('DELETE', 'SH001', { _rev: '1-a' }, 'P1'))).status).toBe(403);
		expect(subStorage()).toHaveLength(1);
	});
});

describe('GET /storage-points', () => {
	it('returns the points and the _rev to quote, for the shelter warehouse side only', async () => {
		const res = await GET(ctx('GET', 'SH001'));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			rev: '1-a',
			points: [expect.objectContaining({ id: 'P1' })]
		});
		state.roles = ['shelter:SH002', 'SH002:warehouse_staff'];
		expect((await GET(ctx('GET', 'SH001'))).status).toBe(403);
	});
});
