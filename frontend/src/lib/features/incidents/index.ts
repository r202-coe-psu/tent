/**
 * Public API of the `incidents` feature — Shelter Incident Log (`shelter_incident`).
 * Routes and other features import ONLY from here.
 */

// Domain
export {
	INCIDENT_DOC_TYPE,
	INCIDENT_SCHEMA_V,
	INCIDENT_STATUSES,
	INCIDENT_CATEGORIES,
	INCIDENT_SEVERITIES,
	COMPLAINANT_TYPES,
	RESPONDENT_STATUSES,
	TIMELINE_ENTRY_TYPES,
	INCIDENT_STATUS_LABELS,
	INCIDENT_CATEGORY_LABELS,
	INCIDENT_SEVERITY_LABELS,
	COMPLAINANT_TYPE_LABELS,
	RESPONDENT_STATUS_LABELS,
	TIMELINE_ENTRY_TYPE_LABELS,
	INCIDENT_TITLE_MAX,
	incidentCreateSchema,
	incidentTitle,
	incidentNoteSchema,
	complainantSchema,
	respondentSchema,
	normalizeComplainant,
	normalizeRespondent,
	isShelterIncident,
	isTerminalStatus,
	nextIncidentNo,
	sortIncidents,
	filterIncidents
} from './domain/incident';
export type {
	ShelterIncident,
	IncidentStatus,
	IncidentCategory,
	IncidentSeverity,
	ComplainantType,
	RespondentStatus,
	Complainant,
	Respondent,
	IncidentTimelineEntry,
	IncidentCreateInput,
	IncidentCreateData,
	IncidentFilter,
	IncidentStatusFilter
} from './domain/incident';
export {
	INCIDENT_TRANSITIONS,
	canTransition,
	canCreateIncident,
	canAddNote,
	canChangeStatus,
	canReassign,
	canIdentifyRespondent,
	availableTransitions,
	isIncidentManager,
	isIncidentOwner,
	isShelterStaff
} from './domain/incident.policy';
export type { IncidentActor } from './domain/incident.policy';
export {
	createIncident,
	changeIncidentStatus,
	reassignIncident,
	addIncidentNote,
	identifyRespondent,
	IncidentRuleError
} from './domain/incident.operations';

// Data
export type { IncidentRepository } from './data/incident.repository';
export type { StaffDirectoryEntry } from './data/staff-directory.api';

// Application
export {
	incidentKeys,
	useIncidents,
	useIncident,
	useShelterStaff,
	useCreateIncident,
	useIncidentAction,
	applyIncidentAction,
	startIncidentLiveQuery
} from './application/queries';
export type { IncidentAction } from './application/queries';

// UI
export { default as IncidentList } from './ui/incident-list.svelte';
export { default as IncidentCreateForm } from './ui/incident-create-form.svelte';
export { default as IncidentDetail } from './ui/incident-detail.svelte';
