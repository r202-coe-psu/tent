export type ReadinessTier = 'community' | 'local_admin' | 'city';

export type ReadinessSectionId = 'structure_and_space' | 'basic_needs' | 'shelter_management';

export type ReadinessImportance = 'mandatory' | 'recommended' | 'optional';

export type ReadinessItemStatus = 'none' | 'partial' | 'fully_ready' | 'unassessed';

export type ReadinessVerdict = 'ready' | 'conditional_pass' | 'not_ready' | 'pending_improvement';

export type AssessmentLifecycleStatus = 'draft' | 'submitted';

export interface ReadinessCatalogItem {
	id: string;
	sectionId: ReadinessSectionId;
	title: string;
	description?: string;
	importance: ReadinessImportance;
}

export interface ReadinessSectionMeta {
	id: ReadinessSectionId;
	label: string;
	shortLabel: string;
}

export interface ReadinessQuestionAnswer {
	question_id: string;
	section_id: ReadinessSectionId;
	title: string;
	description?: string;
	importance: ReadinessImportance;
	status: ReadinessItemStatus;
	note?: string;
}

export interface ReadinessHeaderInfo {
	shelter_name: string;
	community_name?: string;
	operating_agency: string;
	max_capacity: number;
	phone_contact: string;
	building_type: string;
	location_address: string;
	assessor_name: string;
	assessed_date: string;
}

export interface ReadinessSummaryTally {
	total_items: number;
	answered_items: number;
	fully_ready_count: number;
	partial_count: number;
	none_count: number;
	unassessed_count: number;
	mandatory_unanswered_count: number;
	mandatory_none_count: number;
}

export interface ReadinessAuditEntry {
	edited_by: string;
	edited_at: string;
	reason: string;
	previous_verdict?: ReadinessVerdict | null;
}

export interface ShelterReadinessAssessmentDoc {
	_id: string;
	_rev?: string;
	type: 'shelter_readiness_assessment';
	schema_v: 1;
	shelter_code: string;
	tier: ReadinessTier;
	header: ReadinessHeaderInfo;
	status: AssessmentLifecycleStatus;
	verdict: ReadinessVerdict | null;
	justification_note: string;
	summary: ReadinessSummaryTally;
	items: ReadinessQuestionAnswer[];
	created_by: string;
	created_at: string;
	updated_at: string;
	submitted_by?: string;
	submitted_at?: string;
	edit_history: ReadinessAuditEntry[];
}
