import type {
	ReadinessCatalogItem,
	ReadinessHeaderInfo,
	ReadinessQuestionAnswer,
	ReadinessSummaryTally,
	ReadinessTier,
	ShelterReadinessAssessmentDoc
} from './readiness.types';
import { getReadinessCatalogByTier } from './readiness-catalog';

/**
 * Calculates tally summary counts for all checklist items.
 */
export function tallyAssessmentSummary(
	items: readonly ReadinessQuestionAnswer[]
): ReadinessSummaryTally {
	let fully_ready_count = 0;
	let partial_count = 0;
	let none_count = 0;
	let unassessed_count = 0;
	let mandatory_unanswered_count = 0;
	let mandatory_none_count = 0;

	for (const item of items) {
		switch (item.status) {
			case 'fully_ready':
				fully_ready_count++;
				break;
			case 'partial':
				partial_count++;
				break;
			case 'none':
				none_count++;
				if (item.importance === 'mandatory') {
					mandatory_none_count++;
				}
				break;
			case 'unassessed':
			default:
				unassessed_count++;
				if (item.importance === 'mandatory') {
					mandatory_unanswered_count++;
				}
				break;
		}
	}

	const total_items = items.length;
	const answered_items = total_items - unassessed_count;

	return {
		total_items,
		answered_items,
		fully_ready_count,
		partial_count,
		none_count,
		unassessed_count,
		mandatory_unanswered_count,
		mandatory_none_count
	};
}

/**
 * Converts catalog items into initial question answers.
 */
export function buildInitialAnswersFromCatalog(
	catalogItems: readonly ReadinessCatalogItem[]
): ReadinessQuestionAnswer[] {
	return catalogItems.map((item) => ({
		question_id: item.id,
		section_id: item.sectionId,
		title: item.title,
		description: item.description,
		importance: item.importance,
		status: 'unassessed',
		note: ''
	}));
}

/**
 * Creates a brand new assessment document in draft state.
 */
export function createNewAssessmentDoc(params: {
	shelterCode: string;
	tier: ReadinessTier;
	header: ReadinessHeaderInfo;
	createdBy: string;
	timestampIso?: string;
}): ShelterReadinessAssessmentDoc {
	const now = params.timestampIso ?? new Date().toISOString();
	const safeIdTimestamp = now.replace(/[:.]/g, '-');
	const docId = `shelter_readiness_assessment:${params.shelterCode}:${safeIdTimestamp}`;

	const catalog = getReadinessCatalogByTier(params.tier);
	const items = buildInitialAnswersFromCatalog(catalog);
	const summary = tallyAssessmentSummary(items);

	return {
		_id: docId,
		type: 'shelter_readiness_assessment',
		schema_v: 1,
		shelter_code: params.shelterCode,
		tier: params.tier,
		header: params.header,
		status: 'draft',
		verdict: null,
		justification_note: '',
		summary,
		items,
		created_by: params.createdBy,
		created_at: now,
		updated_at: now,
		edit_history: []
	};
}

/**
 * Clones and prefills answers from the previous assessment doc into a new assessment session.
 */
export function createAssessmentDocPrefilledFromLatest(params: {
	latestDoc: ShelterReadinessAssessmentDoc;
	createdBy: string;
	timestampIso?: string;
}): ShelterReadinessAssessmentDoc {
	const now = params.timestampIso ?? new Date().toISOString();
	const safeIdTimestamp = now.replace(/[:.]/g, '-');
	const docId = `shelter_readiness_assessment:${params.latestDoc.shelter_code}:${safeIdTimestamp}`;

	// Deep clone items but allow fresh review
	const items: ReadinessQuestionAnswer[] = params.latestDoc.items.map((item) => ({
		...item,
		note: item.note ?? ''
	}));

	const summary = tallyAssessmentSummary(items);

	return {
		_id: docId,
		type: 'shelter_readiness_assessment',
		schema_v: 1,
		shelter_code: params.latestDoc.shelter_code,
		tier: params.latestDoc.tier,
		header: {
			...params.latestDoc.header,
			assessor_name: params.createdBy,
			assessed_date: now.split('T')[0]
		},
		status: 'draft',
		verdict: null,
		justification_note: '',
		summary,
		items,
		created_by: params.createdBy,
		created_at: now,
		updated_at: now,
		edit_history: []
	};
}
