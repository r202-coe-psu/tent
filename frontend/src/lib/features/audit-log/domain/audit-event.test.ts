import { describe, expect, it } from 'vitest';
import {
	AUDIT_EVENTS,
	auditShelterCodesFromRoles,
	buildAuditEvent,
	computeAuditChanges
} from './audit-event';

describe('computeAuditChanges', () => {
	it('keeps from/to for allowlisted scalar fields', () => {
		expect(computeAuditChanges('shelter', { capacity: 120 }, { capacity: 150 })).toEqual([
			{ field: 'capacity', from: 120, to: 150 }
		]);
	});

	it('records only the field name for fields outside the allowlist', () => {
		expect(
			computeAuditChanges('shelter', { contact: { phone: '081' } }, { contact: { phone: '089' } })
		).toEqual([{ field: 'contact' }]);
	});

	it('records only the field name for allowlisted fields holding objects', () => {
		expect(computeAuditChanges('shelter', { name: 'A' }, { name: { th: 'B' } })).toEqual([
			{ field: 'name' }
		]);
	});

	it('keeps string arrays such as user roles', () => {
		expect(computeAuditChanges('user', { roles: ['a'] }, { roles: ['a', 'b'] })).toEqual([
			{ field: 'roles', from: ['a'], to: ['a', 'b'] }
		]);
	});

	it('ignores envelope and password fields', () => {
		expect(
			computeAuditChanges(
				'user',
				{ _rev: '1-a', updated_at: 'x', derived_key: 'old', password: 'a' },
				{ _rev: '2-b', updated_at: 'y', derived_key: 'new', password: 'b' }
			)
		).toEqual([]);
	});

	it('treats objects with the same content in another key order as unchanged', () => {
		expect(
			computeAuditChanges('shelter', { risk: { a: 1, b: 2 } }, { risk: { b: 2, a: 1 } })
		).toEqual([]);
	});

	it('reports added and removed fields, with null for the missing side', () => {
		expect(computeAuditChanges('shelter', {}, { province: 'สงขลา' })).toEqual([
			{ field: 'province', from: null, to: 'สงขลา' }
		]);
	});
});

describe('buildAuditEvent', () => {
	const now = '2026-11-17T03:00:00.000Z';

	it('builds an append-only event from the BFF', () => {
		const event = buildAuditEvent(
			{
				actor: 'sm.user',
				action: 'update',
				event: AUDIT_EVENTS.shelterUpdated,
				entity: { type: 'shelter', id: 'shelter:01', label: 'ศูนย์ A' },
				shelterCode: 'SH001',
				changes: [{ field: 'capacity', from: 1, to: 2 }]
			},
			'01JABC',
			now
		);
		expect(event).toEqual({
			_id: 'audit_event:01JABC',
			type: 'audit_event',
			schema_v: 1,
			occurred_at: now,
			created_at: now,
			updated_at: now,
			created_by: 'sm.user',
			actor: { name: 'sm.user', kind: 'user' },
			action: 'update',
			event: 'shelter.updated',
			entity: { type: 'shelter', id: 'shelter:01', label: 'ศูนย์ A' },
			shelter_code: 'SH001',
			changes: [{ field: 'capacity', from: 1, to: 2 }],
			reason: null,
			source: 'bff',
			source_ref: null
		});
	});

	it('drops changes for create and delete', () => {
		const event = buildAuditEvent(
			{
				actor: 'sa',
				action: 'create',
				event: AUDIT_EVENTS.shelterCreated,
				entity: { type: 'shelter', id: 'shelter:01', label: null },
				shelterCode: 'SH001',
				changes: [{ field: 'name' }]
			},
			'01JABC',
			now
		);
		expect(event).not.toHaveProperty('changes');
	});
});

describe('auditShelterCodesFromRoles', () => {
	it('collects every shelter from all role lists', () => {
		expect(
			auditShelterCodesFromRoles(
				['shelter:SH002', 'SH002:kitchen_staff'],
				['shelter:SH001', 'shelter:SH002']
			)
		).toEqual(['SH001', 'SH002']);
	});

	it('returns a single null for accounts without a shelter', () => {
		expect(auditShelterCodesFromRoles(['system_admin'], undefined)).toEqual([null]);
	});
});
