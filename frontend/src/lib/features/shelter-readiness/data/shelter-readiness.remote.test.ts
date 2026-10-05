// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { ShelterReadinessRepository } from './shelter-readiness.repository';
import { createNewAssessmentDoc } from '../domain/readiness.utils';

function createFakeCouchDb() {
	const store = new Map<
		string,
		{ _id: string; _rev?: string; type?: string; [k: string]: unknown }
	>();

	function nextRev(rev?: string): string {
		const n = rev ? Number(rev.split('-')[0]) : 0;
		return `${n + 1}-mockrev`;
	}

	const putDocStrict = vi.fn(
		async (_db: string, doc: { _id: string; _rev?: string; [k: string]: unknown }) => {
			const saved = { ...doc, _rev: nextRev(doc._rev) };
			store.set(doc._id, saved);
			return saved;
		}
	);

	const getDoc = vi.fn(async (_db: string, id: string) => store.get(id) ?? null);

	const allDocsByType = vi.fn(async (_db: string, type: string, guard: (d: unknown) => boolean) => {
		return [...store.values()].filter((d) => d.type === type && guard(d));
	});

	return { getDoc, putDocStrict, allDocsByType };
}

const { getDoc, putDocStrict, allDocsByType } = vi.hoisted(() => createFakeCouchDb());

vi.mock('$lib/db/couch-db', () => ({
	getDoc,
	putDocStrict,
	allDocsByType
}));

vi.mock('$lib/db/shelter', () => ({
	getShelterDb: (code: string) => `shelter_${code.toLowerCase()}`,
	getShelterCode: () => 'SH001'
}));

describe('ShelterReadinessRepository remote repository operations', () => {
	const repo = new ShelterReadinessRepository();
	const shelterCode = 'SH001';

	it('saves draft, lists assessments, and submits verdict with CouchDB envelope', async () => {
		const doc = createNewAssessmentDoc({
			shelterCode,
			tier: 'community',
			header: {
				shelter_name: 'ศูนย์ทดสอบ',
				operating_agency: 'อบต. ทดสอบ',
				max_capacity: 50,
				phone_contact: '0812345678',
				building_type: 'อาคารอเนกประสงค์',
				location_address: '123 หมู่ 1',
				assessor_name: 'ผู้ประเมินทดสอบ',
				assessed_date: '2026-09-30'
			},
			createdBy: 'tester'
		});

		expect(doc._id).toMatch(/^shelter_readiness_assessment:SH001:/);
		expect(doc.schema_v).toBe(1);
		expect(doc.updated_at).toBeDefined();

		// 1. Save draft
		const savedDraft = await repo.saveDraft(doc);
		expect(savedDraft.status).toBe('draft');
		expect(savedDraft._rev).toBeDefined();
		expect(putDocStrict).toHaveBeenCalled();

		// 2. List assessments
		const list = await repo.listAssessments(shelterCode);
		const found = list.find((d) => d._id === savedDraft._id);
		expect(found).toBeDefined();
		expect(found?.status).toBe('draft');

		// 3. Submit verdict
		const submitted = await repo.submitVerdict({
			doc: savedDraft,
			verdict: 'ready',
			justificationNote: 'ผ่านเกณฑ์มาตรฐานทุกหมวด',
			submittedBy: 'inspector_test'
		});

		expect(submitted.status).toBe('submitted');
		expect(submitted.verdict).toBe('ready');
		expect(submitted.justification_note).toBe('ผ่านเกณฑ์มาตรฐานทุกหมวด');

		// 4. Verify getLatestAssessment
		const latest = await repo.getLatestAssessment(shelterCode);
		expect(latest).toBeDefined();
		expect(latest?._id).toBe(submitted._id);
		expect(latest?.status).toBe('submitted');
	});

	it('successfully parses and lists assessments even when header fields are empty strings', async () => {
		const doc = createNewAssessmentDoc({
			shelterCode,
			tier: 'community',
			header: {
				shelter_name: 'ศูนย์พักพิง (SH001)',
				operating_agency: '',
				max_capacity: 0,
				phone_contact: '',
				building_type: '',
				location_address: '',
				assessor_name: 'admin',
				assessed_date: '2026-09-30'
			},
			createdBy: 'admin'
		});

		const saved = await repo.saveDraft(doc);
		const list = await repo.listAssessments(shelterCode);
		const found = list.find((d) => d._id === saved._id);
		expect(found).toBeDefined();
		expect(found?.header.operating_agency).toBe('');
	});
});
