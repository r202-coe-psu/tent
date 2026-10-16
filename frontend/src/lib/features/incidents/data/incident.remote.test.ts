import { describe, expect, it } from 'vitest';
import { createInMemoryRepository } from '$lib/db/in-memory-repository';
import type { Repository } from '$lib/db/repository';
import { ConflictError } from '$lib/utils/errors';
import { incidentCreateSchema, type ShelterIncident } from '../domain/incident';
import { addIncidentNote } from '../domain/incident.operations';
import type { IncidentActor } from '../domain/incident.policy';
import { IncidentRemoteRepository } from './incident.remote';

const ACTOR: IncidentActor = {
	name: 'staff_a',
	roles: ['shelter:SH001', 'SH001:registration_staff'],
	shelterCode: 'SH001'
};

const data = incidentCreateSchema.parse({
	title: 'ชายชุดดำขโมยรองเท้า',
	location_detail: 'หน้าโรงอาหาร',
	category: 'dispute',
	severity: 'low',
	occurred_at: new Date().toISOString(),
	description: 'ทะเลาะเรื่องคิว',
	complainant: { type: 'anonymous' },
	respondent: { status: 'none' }
});

describe('IncidentRemoteRepository', () => {
	it('numbers records sequentially within the day', async () => {
		const repo = new IncidentRemoteRepository(() => mem);
		const mem = createInMemoryRepository();
		const a = await repo.create(data, ACTOR);
		const b = await repo.create(data, ACTOR);
		expect(a.incident_no).toMatch(/^INC-\d{8}-001$/);
		expect(b.incident_no).toMatch(/^INC-\d{8}-002$/);
		expect((await repo.list()).length).toBe(2);
	});

	it('re-reads and re-applies once on a write conflict', async () => {
		const mem = createInMemoryRepository();
		let conflictOnce = true;
		const flaky: Repository = {
			...mem,
			async put<T extends { _id: string }>(doc: T): Promise<T> {
				if (conflictOnce && (doc as { _rev?: string })._rev) {
					conflictOnce = false;
					// a concurrent writer lands first
					const current = (await mem.get<ShelterIncident>(doc._id))!;
					await mem.put(addIncidentNote(current, 'concurrent', ACTOR));
					throw new ConflictError();
				}
				return mem.put(doc);
			}
		};
		const repo = new IncidentRemoteRepository(() => flaky);
		const created = await repo.create(data, ACTOR);
		const updated = await repo.update(created._id, (c) => addIncidentNote(c, 'mine', ACTOR));
		expect(updated.timeline.map((t) => t.details)).toEqual(['concurrent', 'mine']);
	});

	it('throws when the record does not exist', async () => {
		const repo = new IncidentRemoteRepository(() => createInMemoryRepository());
		await expect(repo.update('shelter_incident:missing', (c) => c)).rejects.toThrow('ไม่พบ');
	});
});
