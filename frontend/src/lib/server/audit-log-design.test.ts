import { describe, expect, it, vi } from 'vitest';
import {
	buildAuditLogDesignDoc,
	buildAuditLogValidateDocUpdate,
	deployAuditLogDesign
} from './audit-log-design';

type Vdu = (newDoc: Record<string, unknown>, oldDoc: unknown, userCtx: { roles: string[] }) => void;
const vdu = new Function(`return ${buildAuditLogValidateDocUpdate()}`)() as Vdu;
const admin = { roles: ['_admin'] };

const valid = {
	_id: 'audit_event:01',
	type: 'audit_event',
	schema_v: 1,
	occurred_at: 't',
	created_at: 't',
	updated_at: 't',
	created_by: 'sa',
	actor: { name: 'sa', kind: 'user' },
	action: 'update',
	event: 'shelter.updated',
	entity: { type: 'shelter', id: 'SH001', label: null },
	shelter_code: null,
	source: 'bff'
};

describe('audit_log validate_doc_update', () => {
	it('accepts a complete new event', () => {
		expect(() => vdu(valid, null, admin)).not.toThrow();
	});

	it('rejects edits and deletes, even from an admin', () => {
		expect(() => vdu({ ...valid, event: 'x' }, valid, admin)).toThrow();
		expect(() => vdu({ ...valid, _deleted: true }, null, admin)).toThrow();
	});

	it('rejects other types and missing required fields', () => {
		expect(() => vdu({ ...valid, type: 'audit' }, null, admin)).toThrow();
		expect(() => vdu({ ...valid, actor: undefined }, null, admin)).toThrow();
		expect(() => vdu({ ...valid, event: '' }, null, admin)).toThrow();
		const withoutShelter: Record<string, unknown> = { ...valid };
		delete withoutShelter.shelter_code;
		expect(() => vdu(withoutShelter, null, admin)).toThrow();
	});

	it('lets an admin update the design document', () => {
		expect(() => vdu({ _id: '_design/audit' }, { _id: '_design/audit' }, admin)).not.toThrow();
		expect(() => vdu({ _id: '_design/audit' }, null, { roles: [] })).toThrow();
	});
});

describe('deployAuditLogDesign', () => {
	it('does nothing when the stored design is current', async () => {
		const couchReq = vi.fn(async () => ({ status: 200, data: buildAuditLogDesignDoc() }));
		expect(await deployAuditLogDesign(couchReq, false)).toBe('current');
		expect(couchReq).toHaveBeenCalledTimes(1);
	});

	it('writes the design when missing', async () => {
		const couchReq = vi
			.fn()
			.mockResolvedValueOnce({ status: 404, data: null })
			.mockResolvedValueOnce({ status: 201, data: {} });
		expect(await deployAuditLogDesign(couchReq, false)).toBe('deployed');
		expect(couchReq.mock.calls[1][0]).toBe('PUT');
	});
});
