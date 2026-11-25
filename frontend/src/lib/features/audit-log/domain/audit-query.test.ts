import { describe, expect, it } from 'vitest';
import type { AuditEvent } from './audit-event';
import {
	auditLogSearchParams,
	chooseAuditView,
	cursorMatchesRange,
	cursorWithinQuery,
	decodeAuditCursor,
	encodeAuditCursor,
	matchesAuditQuery,
	parseAuditLogQuery
} from './audit-query';

const parse = (q: Record<string, string>) => parseAuditLogQuery(new URLSearchParams(q));

const event = (over: Partial<AuditEvent> = {}): AuditEvent => ({
	_id: 'audit_event:01',
	type: 'audit_event',
	schema_v: 1,
	occurred_at: '2026-11-17T03:00:00.000Z',
	created_at: '2026-11-17T03:00:00.000Z',
	updated_at: '2026-11-17T03:00:00.000Z',
	created_by: 'sm',
	actor: { name: 'sm', kind: 'user' },
	action: 'update',
	event: 'shelter.updated',
	entity: { type: 'shelter', id: 'shelter:01', label: 'A' },
	shelter_code: 'SH001',
	source: 'bff',
	...over
});

describe('parseAuditLogQuery', () => {
	it('defaults the limit and drops empty values', () => {
		expect(parse({ actor: '', limit: '' })).toMatchObject({ limit: 50, actor: undefined });
	});

	it('rejects a limit above 200 and an unknown action', () => {
		expect(() => parse({ limit: '500' })).toThrow();
		expect(() => parse({ action: 'hack' })).toThrow();
	});

	it('widens a bare to-date to the end of that day so its events stay in range', () => {
		const query = parse({ from: '2026-11-17', to: '2026-11-18' });
		expect(query.from).toBe('2026-11-17T00:00:00.000Z');
		expect(query.to).toBe('2026-11-18T23:59:59.999Z');
		expect(matchesAuditQuery(event({ occurred_at: '2026-11-18T16:30:00.000Z' }), query)).toBe(true);
	});

	it('normalises an offset to UTC so the string compare is sound', () => {
		const query = parse({ to: '2026-11-18T23:59:59.999+07:00' });
		expect(query.to).toBe('2026-11-18T16:59:59.999Z');
		expect(matchesAuditQuery(event({ occurred_at: '2026-11-18T16:00:00.000Z' }), query)).toBe(true);
		expect(matchesAuditQuery(event({ occurred_at: '2026-11-18T17:00:00.000Z' }), query)).toBe(
			false
		);
	});

	it('rejects an invalid date', () => {
		expect(() => parse({ from: 'yesterday' })).toThrow();
	});
});

describe('chooseAuditView', () => {
	it('uses the entity view when both type and id are given', () => {
		expect(chooseAuditView(parse({ entity_type: 'shelter', entity_id: 'shelter:01' }))).toEqual({
			view: 'by_entity',
			startkey: ['shelter', 'shelter:01', {}],
			endkey: ['shelter', 'shelter:01']
		});
	});

	it('keeps a shelter-scoped query on the shelter view even when an actor is given', () => {
		expect(chooseAuditView(parse({ actor: 'sm', shelter_code: 'SH001' })).view).toBe('by_shelter');
	});

	it('keeps a shelter-scoped query on the shelter view even when an entity is given', () => {
		const range = chooseAuditView(
			parse({ shelter_code: 'SH001', entity_type: 'shelter', entity_id: 'SH002' })
		);
		expect(range.view).toBe('by_shelter');
		expect((range.startkey as unknown[])[0]).toBe('SH001');
	});

	it('reads an entity type alone from the time view so the range still applies', () => {
		const range = chooseAuditView(parse({ entity_type: 'user', to: '2026-11-18' }));
		expect(range.view).toBe('by_occurred_at');
		expect(range.startkey).toBe('2026-11-18T23:59:59.999Z');
	});

	it('bounds the shelter view by the date range', () => {
		expect(
			chooseAuditView(
				parse({
					shelter_code: 'SH001',
					from: '2026-11-01T00:00:00.000Z',
					to: '2026-11-30T00:00:00.000Z'
				})
			)
		).toEqual({
			view: 'by_shelter',
			startkey: ['SH001', '2026-11-30T00:00:00.000Z'],
			endkey: ['SH001', '2026-11-01T00:00:00.000Z']
		});
	});

	it('falls back to the time view', () => {
		expect(chooseAuditView(parse({})).view).toBe('by_occurred_at');
	});
});

describe('matchesAuditQuery', () => {
	it('filters on every given field', () => {
		expect(matchesAuditQuery(event(), parse({ action: 'update', shelter_code: 'SH001' }))).toBe(
			true
		);
		expect(matchesAuditQuery(event(), parse({ action: 'create' }))).toBe(false);
		expect(matchesAuditQuery(event(), parse({ shelter_code: 'SH002' }))).toBe(false);
		expect(matchesAuditQuery(event(), parse({ to: '2026-11-16T00:00:00.000Z' }))).toBe(false);
	});
});

describe('cursor and search params', () => {
	it('round-trips the cursor and ignores garbage', () => {
		const cursor = { key: ['SH001', '2026-11-17T03:00:00.000Z'], id: 'audit_event:01' };
		expect(decodeAuditCursor(encodeAuditCursor(cursor))).toEqual(cursor);
		expect(decodeAuditCursor('not json')).toBeNull();
		expect(decodeAuditCursor(undefined)).toBeNull();
	});

	it('writes only filled filters', () => {
		expect(
			auditLogSearchParams({ actor: 'sm', action: undefined, entity_type: '' }).toString()
		).toBe('actor=sm');
	});
});

describe("cursor guards — CR-259 a cursor may not leave the caller's range", () => {
	const scoped = parse({ shelter_code: 'SH001' });
	const range = chooseAuditView(scoped);

	it("accepts a cursor whose prefix is the caller's own shelter", () => {
		expect(cursorMatchesRange(range, { key: ['SH001', '2026-11-18T00:00:00.000Z'], id: 'a' })).toBe(
			true
		);
	});

	it('rejects a cursor pointing at another shelter', () => {
		expect(cursorMatchesRange(range, { key: ['SH002', '2099-01-01'], id: 'a' })).toBe(false);
	});

	it('rejects a cursor of the wrong shape', () => {
		expect(cursorMatchesRange(range, { key: 'SH001', id: 'a' })).toBe(false);
		expect(cursorMatchesRange(range, { key: ['SH001'], id: 'a' })).toBe(false);
		expect(cursorMatchesRange(range, { key: ['SH001', 42], id: 'a' })).toBe(false);
	});

	it('keeps the time view on a plain string key', () => {
		const plain = chooseAuditView(parse({}));
		expect(cursorMatchesRange(plain, { key: '2026-11-18T00:00:00.000Z', id: 'a' })).toBe(true);
		expect(cursorMatchesRange(plain, { key: ['SH002', 'x'], id: 'a' })).toBe(false);
	});

	it('rejects a cursor outside the requested date range', () => {
		const bounded = parse({ shelter_code: 'SH001', from: '2026-11-01', to: '2026-11-18' });
		expect(
			cursorWithinQuery(bounded, { key: ['SH001', '2026-11-10T00:00:00.000Z'], id: 'a' })
		).toBe(true);
		expect(
			cursorWithinQuery(bounded, { key: ['SH001', '2026-12-25T00:00:00.000Z'], id: 'a' })
		).toBe(false);
	});
});
