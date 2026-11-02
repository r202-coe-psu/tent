// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryRepository } from '$lib/db/in-memory-repository';
import { mintConsentStamp, type EvacueeConsent } from '$lib/features/consent/server';
import { isAuditEntry, type AuditEntry } from '$lib/features/shared';

let memoryRepo = createInMemoryRepository();
type Doc = { _id: string; _rev?: string };
let bulkCalls: Doc[][] = [];
let failIds: (id: string) => boolean = () => false;

vi.mock('$lib/db/shelter', () => ({
	getShelterCode: () => 'SH001',
	getShelterDb: () => 'shelter_sh001'
}));

vi.mock('$lib/db/repository', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/db/repository')>();
	return { ...actual, createRemoteRepository: () => memoryRepo };
});

vi.mock('$lib/db/couch-db', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/db/couch-db')>();
	return {
		...actual,
		bulkDocsDetailed: async (_db: string, docs: Doc[]) => {
			bulkCalls.push(docs);
			return docs.map((d) =>
				failIds(d._id)
					? { id: d._id, ok: false as const, status: 409, error: 'conflict', reason: 'x' }
					: { id: d._id, ok: true as const, rev: '2-new' }
			);
		}
	};
});

import { PeopleRemoteRepository } from './people.remote';
import { createEvacuee, type Evacuee } from '../domain/people';

const ctx = { shelterCode: 'SH001', createdBy: 'staff01' };

async function seedEvacuee(
	over: Partial<Evacuee> & { mode?: 'full' | 'basic' } = {}
): Promise<Evacuee> {
	const { mode, ...rest } = over;
	const base = createEvacuee(
		{
			first_name: 'สมชาย',
			last_name: 'ใจดี',
			gender: 'male',
			phone: '0812345678',
			country: 'THAILAND',
			person_id: { cardType: 'anonymous', number: '' }
		} as Parameters<typeof createEvacuee>[0],
		ctx,
		null
	);
	const consent = mode
		? ({
				mode,
				health: false,
				...mintConsentStamp(new Date('2026-10-01T03:00:00.000Z')),
				channel: 'staff',
				given_by: 'self',
				giver_evacuee_id: null,
				recorded_verbally_by: null
			} as EvacueeConsent)
		: undefined;
	return memoryRepo.put({ ...base, ...(consent ? { consent } : {}), ...rest });
}

describe('PeopleRemoteRepository.setSearchVisibility', () => {
	let repo: PeopleRemoteRepository;

	beforeEach(() => {
		memoryRepo = createInMemoryRepository();
		bulkCalls = [];
		failIds = () => false;
		repo = new PeopleRemoteRepository('shelter_sh001');
	});

	it('sends the evacuee and its audit entry in one _bulk_docs request', async () => {
		const ev = await seedEvacuee({ mode: 'basic', privacy: { search_excluded: true } });

		const saved = await repo.setSearchVisibility(ev._id, true, ctx);

		expect(bulkCalls).toHaveLength(1);
		const [evDoc, auditDoc] = bulkCalls[0] as [Evacuee, unknown];
		expect(evDoc._id).toBe(ev._id);
		expect(evDoc._rev).toBe(ev._rev);
		expect(evDoc.privacy.search_excluded).toBe(false);
		expect(evDoc.consent?.mode).toBe('full');
		expect(isAuditEntry(auditDoc) && auditDoc.action).toBe('privacy_change');
		expect(saved?._rev).toBe('2-new');
	});

	it('retries the audit entry when only the audit is rejected', async () => {
		const ev = await seedEvacuee({ privacy: { search_excluded: false } });
		failIds = (id) => id.startsWith('audit:');

		await repo.setSearchVisibility(ev._id, false, ctx);

		const auditId = bulkCalls[0][1]._id;
		const audit = await memoryRepo.get<AuditEntry>(auditId);
		expect(audit?.action).toBe('privacy_change');
	});

	it('throws when the audit retry also fails', async () => {
		const ev = await seedEvacuee({ privacy: { search_excluded: false } });
		failIds = (id) => id.startsWith('audit:');
		vi.spyOn(memoryRepo, 'put').mockRejectedValueOnce(new Error('forbidden'));

		await expect(repo.setSearchVisibility(ev._id, false, ctx)).rejects.toThrow('forbidden');
	});

	it('throws when the evacuee write conflicts', async () => {
		const ev = await seedEvacuee({ privacy: { search_excluded: false } });
		failIds = (id) => id === ev._id;

		await expect(repo.setSearchVisibility(ev._id, false, ctx)).rejects.toThrow(/ไม่สำเร็จ/);
	});

	it('writes nothing when visibility already matches', async () => {
		const ev = await seedEvacuee({ privacy: { search_excluded: false } });

		expect(await repo.setSearchVisibility(ev._id, true, ctx)).toBeNull();
		expect(bulkCalls).toHaveLength(0);
	});

	it('throws when the person does not exist', async () => {
		await expect(repo.setSearchVisibility('evacuee:missing', true, ctx)).rejects.toThrow();
	});
});
