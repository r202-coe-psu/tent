import { describe, expect, it } from 'vitest';
import {
	CITY_CATALOG_ITEMS,
	COMMUNITY_CATALOG_ITEMS,
	getReadinessCatalogByTier,
	LOCAL_ADMIN_CATALOG_ITEMS
} from './readiness-catalog';
import {
	createAssessmentDocPrefilledFromLatest,
	createNewAssessmentDoc,
	tallyAssessmentSummary
} from './readiness.utils';
import type { ReadinessQuestionAnswer } from './readiness.types';

describe('readiness-catalog', () => {
	it('contains the correct number of items for Community tier (38 questions)', () => {
		expect(COMMUNITY_CATALOG_ITEMS.length).toBe(38);
		const catalog = getReadinessCatalogByTier('community');
		expect(catalog.length).toBe(38);

		const sec1 = catalog.filter((i) => i.sectionId === 'structure_and_space');
		const sec2 = catalog.filter((i) => i.sectionId === 'basic_needs');
		const sec3 = catalog.filter((i) => i.sectionId === 'shelter_management');

		expect(sec1.length).toBe(15);
		expect(sec2.length).toBe(10);
		expect(sec3.length).toBe(13);
	});

	it('contains the correct number of items for Local Admin tier (39 questions)', () => {
		expect(LOCAL_ADMIN_CATALOG_ITEMS.length).toBe(39);
		const catalog = getReadinessCatalogByTier('local_admin');
		expect(catalog.length).toBe(39);

		const sec1 = catalog.filter((i) => i.sectionId === 'structure_and_space');
		const sec2 = catalog.filter((i) => i.sectionId === 'basic_needs');
		const sec3 = catalog.filter((i) => i.sectionId === 'shelter_management');

		expect(sec1.length).toBe(16);
		expect(sec2.length).toBe(10);
		expect(sec3.length).toBe(13);
	});

	it('contains the correct number of items for City tier (39 questions, all mandatory)', () => {
		expect(CITY_CATALOG_ITEMS.length).toBe(39);
		const catalog = getReadinessCatalogByTier('city');
		expect(catalog.length).toBe(39);

		expect(catalog.every((item) => item.importance === 'mandatory')).toBe(true);
	});
});

describe('readiness.utils - tallyAssessmentSummary', () => {
	it('calculates tallies accurately', () => {
		const items: ReadinessQuestionAnswer[] = [
			{
				question_id: 'q1',
				section_id: 'structure_and_space',
				title: 'Q1',
				importance: 'mandatory',
				status: 'fully_ready'
			},
			{
				question_id: 'q2',
				section_id: 'structure_and_space',
				title: 'Q2',
				importance: 'mandatory',
				status: 'partial'
			},
			{
				question_id: 'q3',
				section_id: 'structure_and_space',
				title: 'Q3',
				importance: 'mandatory',
				status: 'none'
			},
			{
				question_id: 'q4',
				section_id: 'structure_and_space',
				title: 'Q4',
				importance: 'recommended',
				status: 'unassessed'
			},
			{
				question_id: 'q5',
				section_id: 'structure_and_space',
				title: 'Q5',
				importance: 'mandatory',
				status: 'unassessed'
			}
		];

		const summary = tallyAssessmentSummary(items);
		expect(summary.total_items).toBe(5);
		expect(summary.answered_items).toBe(3);
		expect(summary.fully_ready_count).toBe(1);
		expect(summary.partial_count).toBe(1);
		expect(summary.none_count).toBe(1);
		expect(summary.unassessed_count).toBe(2);
		expect(summary.mandatory_none_count).toBe(1);
		expect(summary.mandatory_unanswered_count).toBe(1);
	});
});

describe('readiness.utils - create and clone assessment doc', () => {
	it('initializes a new assessment document properly', () => {
		const doc = createNewAssessmentDoc({
			shelterCode: 'SH001',
			tier: 'community',
			header: {
				shelter_name: 'ศูนย์พักพิงเทศบาล 1',
				operating_agency: 'เทศบาลนครหาดใหญ่',
				max_capacity: 100,
				phone_contact: '074-000000',
				building_type: 'อาคารเรียน 2 ชั้น',
				location_address: 'ถ.เพชรเกษม',
				assessor_name: 'สมชาย',
				assessed_date: '2026-09-30'
			},
			createdBy: 'admin_test',
			timestampIso: '2026-09-30T10:00:00Z'
		});

		expect(doc._id).toBe('shelter_readiness_assessment:SH001:2026-09-30T10-00-00Z');
		expect(doc.schema_v).toBe(1);
		expect(doc.updated_at).toBe('2026-09-30T10:00:00Z');
		expect(doc.status).toBe('draft');
		expect(doc.items.length).toBe(38);
		expect(doc.summary.total_items).toBe(38);
		expect(doc.summary.unassessed_count).toBe(38);
	});

	it('prefills from latest completed assessment', () => {
		const initial = createNewAssessmentDoc({
			shelterCode: 'SH001',
			tier: 'community',
			header: {
				shelter_name: 'ศูนย์พักพิงเทศบาล 1',
				operating_agency: 'เทศบาลนครหาดใหญ่',
				max_capacity: 100,
				phone_contact: '074-000000',
				building_type: 'อาคารเรียน 2 ชั้น',
				location_address: 'ถ.เพชรเกษม',
				assessor_name: 'สมชาย',
				assessed_date: '2026-09-30'
			},
			createdBy: 'admin_test',
			timestampIso: '2026-09-30T10:00:00Z'
		});

		initial.items[0].status = 'fully_ready';
		initial.items[1].status = 'partial';
		initial.status = 'submitted';
		initial.verdict = 'conditional_pass';

		const cloned = createAssessmentDocPrefilledFromLatest({
			latestDoc: initial,
			createdBy: 'somying',
			timestampIso: '2026-10-05T09:00:00Z'
		});

		expect(cloned._id).toBe('shelter_readiness_assessment:SH001:2026-10-05T09-00-00Z');
		expect(cloned.schema_v).toBe(1);
		expect(cloned.updated_at).toBe('2026-10-05T09:00:00Z');
		expect(cloned.status).toBe('draft');
		expect(cloned.verdict).toBeNull();
		expect(cloned.created_by).toBe('somying');
		expect(cloned.items[0].status).toBe('fully_ready');
		expect(cloned.items[1].status).toBe('partial');
		expect(cloned.summary.fully_ready_count).toBe(1);
		expect(cloned.summary.partial_count).toBe(1);
	});
});
