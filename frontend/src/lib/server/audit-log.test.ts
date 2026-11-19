import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const adminRawMock = vi.hoisted(() => vi.fn());
const displayNamesMock = vi.hoisted(() => vi.fn());

vi.mock('./couch-admin', async (importOriginal) => ({
	...(await importOriginal<typeof import('./couch-admin')>()),
	adminRaw: adminRawMock
}));
vi.mock('./user-service', () => ({ getDisplayNames: displayNamesMock }));

import { queryAuditLog, recordAudit, recordAuditedWrite, recordProxiedWrite } from './audit-log';
import { parseAuditLogQuery, type AuditEvent } from '$lib/features/audit-log/server';

const input = {
	actor: 'sm.user',
	action: 'update' as const,
	event: 'shelter.updated',
	entity: { type: 'shelter', id: 'SH001', label: 'ศูนย์ A' },
	shelterCode: 'SH001'
};

function event(n: number, over: Partial<AuditEvent> = {}): AuditEvent {
	const ts = `2026-11-17T0${n}:00:00.000Z`;
	return {
		_id: `audit_event:0${n}`,
		_rev: '1-a',
		type: 'audit_event',
		schema_v: 1,
		occurred_at: ts,
		created_at: ts,
		updated_at: ts,
		created_by: 'sm.user',
		actor: { name: 'sm.user', kind: 'user' },
		action: 'update',
		event: 'shelter.updated',
		entity: { type: 'shelter', id: 'SH001', label: 'A' },
		shelter_code: 'SH001',
		source: 'bff',
		...over
	};
}

beforeEach(() => {
	vi.useFakeTimers({ shouldAdvanceTime: true });
	adminRawMock.mockReset();
	displayNamesMock.mockReset().mockResolvedValue(new Map([['sm.user', 'สมศรี']]));
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('recordAudit', () => {
	it('writes one audit_event into audit_log', async () => {
		adminRawMock.mockResolvedValue({ status: 201, data: { ok: true } });
		expect(await recordAudit(input)).toBe(true);
		const [path, method, doc] = adminRawMock.mock.calls[0];
		expect(method).toBe('PUT');
		expect(path).toMatch(/^\/audit_log\/audit_event%3A[0-9A-Z]{26}$/);
		expect(doc).toMatchObject({ type: 'audit_event', event: 'shelter.updated', source: 'bff' });
	});

	it('retries with the same _id and treats 409 as already written', async () => {
		adminRawMock
			.mockResolvedValueOnce({ status: 500, data: null })
			.mockResolvedValueOnce({ status: 409, data: null });
		expect(await recordAudit(input)).toBe(true);
		expect(adminRawMock.mock.calls[0][0]).toBe(adminRawMock.mock.calls[1][0]);
	});

	it('gives up without throwing and logs the event when every attempt fails', async () => {
		adminRawMock.mockRejectedValue(new Error('down'));
		expect(await recordAudit(input)).toBe(false);
		expect(adminRawMock).toHaveBeenCalledTimes(3);
		expect(console.error).toHaveBeenCalled();
	});

	it('stops at once when audit_log does not exist', async () => {
		adminRawMock.mockResolvedValue({ status: 404, data: { error: 'not_found' } });
		expect(await recordAudit(input)).toBe(false);
		expect(adminRawMock).toHaveBeenCalledTimes(1);
	});
});

describe('recordAuditedWrite', () => {
	it('stores the field-level changes of an update', async () => {
		adminRawMock.mockResolvedValue({ status: 201, data: {} });
		await recordAuditedWrite({
			actor: 'sm.user',
			event: 'shelter.updated',
			action: 'update',
			entityType: 'shelter',
			entityId: 'SH001',
			shelterCode: 'SH001',
			before: { capacity: 120, contact: { phone: '081' } },
			after: { capacity: 150, contact: { phone: '089' } }
		});
		expect(adminRawMock.mock.calls[0][2].changes).toEqual([
			{ field: 'capacity', from: 120, to: 150 },
			{ field: 'contact' }
		]);
	});
});

describe('recordProxiedWrite', () => {
	it('records only a successful upstream write, with the id from its body', async () => {
		adminRawMock.mockResolvedValue({ status: 201, data: {} });
		const base = {
			actor: 'sa',
			event: 'api_key.created',
			action: 'create' as const,
			entityType: 'api_key' as const,
			shelterCode: null
		};
		await recordProxiedWrite(new Response('{}', { status: 500 }), base);
		expect(adminRawMock).not.toHaveBeenCalled();
		const ok = new Response(JSON.stringify({ id: 'key-1', name: 'EOC' }), { status: 201 });
		await recordProxiedWrite(ok, base);
		expect(adminRawMock.mock.calls[0][2].entity).toEqual({
			type: 'api_key',
			id: 'key-1',
			label: 'EOC'
		});
		expect(await ok.json()).toEqual({ id: 'key-1', name: 'EOC' });
	});

	it("keeps the caller's own entityId and label over the upstream body", async () => {
		adminRawMock.mockResolvedValue({ status: 201, data: {} });
		const ok = new Response(JSON.stringify({ id: 'ignored', name: 'ignored' }), { status: 200 });

		await recordProxiedWrite(ok, {
			actor: 'sa',
			event: 'thirdparty_client.revoked',
			action: 'status_change',
			entityType: 'thirdparty_client',
			entityId: 'client-9',
			label: 'พันธมิตร ก',
			shelterCode: null
		});

		expect(adminRawMock.mock.calls[0][2].entity).toEqual({
			type: 'thirdparty_client',
			id: 'client-9',
			label: 'พันธมิตร ก'
		});
	});

	it('writes nothing when a successful upstream body carries no id', async () => {
		adminRawMock.mockResolvedValue({ status: 201, data: {} });

		await recordProxiedWrite(new Response(JSON.stringify({ ok: true }), { status: 200 }), {
			actor: 'sa',
			event: 'api_key.revoked',
			action: 'status_change',
			entityType: 'api_key',
			shelterCode: null
		});

		expect(adminRawMock).not.toHaveBeenCalled();
	});
});

describe('queryAuditLog', () => {
	const rows = (events: AuditEvent[]) =>
		events.map((doc) => ({ id: doc._id, key: [doc.shelter_code, doc.occurred_at], doc }));

	it('returns the page newest first with display names and no _rev', async () => {
		adminRawMock.mockResolvedValue({ status: 200, data: { rows: rows([event(3), event(2)]) } });
		const page = await queryAuditLog(
			parseAuditLogQuery(new URLSearchParams({ shelter_code: 'SH001' }))
		);
		expect(page.items.map((i) => i._id)).toEqual(['audit_event:03', 'audit_event:02']);
		expect(page.items[0].actor.display_name).toBe('สมศรี');
		expect(page.items[0]).not.toHaveProperty('_rev');
		expect(page.next_cursor).toBeNull();
		expect(adminRawMock.mock.calls[0][0]).toContain('/_view/by_shelter?');
	});

	it('hands back a cursor when the page is full and resumes after it', async () => {
		adminRawMock.mockResolvedValue({
			status: 200,
			data: { rows: rows([event(5), event(4), event(3)]) }
		});
		const query = parseAuditLogQuery(new URLSearchParams({ shelter_code: 'SH001', limit: '2' }));
		const page = await queryAuditLog(query);
		expect(page.items).toHaveLength(2);
		expect(page.next_cursor).not.toBeNull();
		adminRawMock.mockResolvedValue({ status: 200, data: { rows: [] } });
		await queryAuditLog({ ...query, cursor: page.next_cursor! });
		const second = decodeURIComponent(adminRawMock.mock.calls[1][0]);
		expect(second).toContain('startkey_docid=audit_event:04');
		expect(second).toContain('skip=1');
	});

	it('filters out rows that do not match the other filters', async () => {
		adminRawMock.mockResolvedValue({
			status: 200,
			data: { rows: rows([event(3, { action: 'create' }), event(2)]) }
		});
		const page = await queryAuditLog(
			parseAuditLogQuery(new URLSearchParams({ shelter_code: 'SH001', action: 'update' }))
		);
		expect(page.items.map((i) => i._id)).toEqual(['audit_event:02']);
	});

	it('answers an empty page when audit_log does not exist yet', async () => {
		adminRawMock.mockResolvedValue({ status: 404, data: null });
		expect(await queryAuditLog(parseAuditLogQuery(new URLSearchParams()))).toEqual({
			items: [],
			next_cursor: null
		});
	});
});
