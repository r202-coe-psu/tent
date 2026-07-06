// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import PouchDB from 'pouchdb-browser';
import memory from 'pouchdb-adapter-memory';

PouchDB.plugin(memory);

let testDb: PouchDB.Database;

vi.mock('$lib/db/shelter', () => ({
	SHELTER_CODE: 'SH001',
	SHELTER_DB: 'shelter_sh001',
	shelterDb: () => testDb
}));

vi.mock('$lib/db/pouch', () => ({
	namedLocalDb: () => testDb
}));

import { OperationsPouchRepository } from './operations.pouch';
import { createCampaign } from '../domain/operations';

const ctx = { shelterCode: 'SH001', createdBy: 'tester' };

describe('OperationsPouchRepository.updateCampaign', () => {
	let repo: OperationsPouchRepository;

	beforeEach(() => {
		testDb = new PouchDB(`test-ops-${Math.random().toString(36).slice(2)}`, { adapter: 'memory' });
		repo = new OperationsPouchRepository();
	});

	it('should update campaign and create an audit log entry', async () => {
		// 1. Create a campaign
		const created = await repo.createCampaign(
			{
				title: 'น้ำดื่มและยารักษาโรค',
				needs: [{ item_id: 'item:water', qty_target: 100, unit: 'ขวด', status: 'open' }]
			},
			ctx
		);

		// 2. Perform update with audit logs
		const updatedCampaign = {
			...created,
			title: 'น้ำดื่มและยารักษาโรค (ด่วนพิเศษ)'
		};

		const auditInput = {
			action: 'manual_adjust' as const,
			reason: 'อัปเดตชื่อแคมเปญเพื่อความชัดเจน',
			ctx
		};

		const result = await repo.updateCampaign(updatedCampaign, auditInput);

		// 3. Verify campaign updated in DB
		expect(result.title).toBe('น้ำดื่มและยารักษาโรค (ด่วนพิเศษ)');
		const storedCampaign = await repo.getCampaign(created._id);
		expect(storedCampaign?.title).toBe('น้ำดื่มและยารักษาโรค (ด่วนพิเศษ)');

		// 4. Verify audit doc created in DB
		const docs = await testDb.allDocs({ include_docs: true });
		const auditDocs = docs.rows.map((r) => r.doc).filter((d: any) => d && d.type === 'audit');

		expect(auditDocs).toHaveLength(1);
		expect(auditDocs[0]).toMatchObject({
			action: 'manual_adjust',
			target_type: 'donation_campaign',
			target_id: created._id,
			reason: 'อัปเดตชื่อแคมเปญเพื่อความชัดเจน',
			created_by: 'tester'
		});
	});
});
