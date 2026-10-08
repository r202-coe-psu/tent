/**
 * Who may do what on a `shelter_incident` + the status graph. Pure — mirrored by the
 * CouchDB `validate_doc_update` rules in `$lib/server/shelter-access-design.ts`, which are
 * the authoritative guard (clients write directly with their session).
 */
import { hasShelterScope, isShelterManager, isSystemAdmin } from '$lib/auth/roles';
import { isTerminalStatus, type IncidentStatus, type ShelterIncident } from './incident';

/**
 * Allowed next statuses (IL-S1). `closed` / `cancelled` are terminal; cancel is allowed while the
 * case is still open (`reported` / `action_in_progress`) — D4.
 */
export const INCIDENT_TRANSITIONS: Record<IncidentStatus, readonly IncidentStatus[]> = {
	reported: ['action_in_progress', 'cancelled'],
	action_in_progress: ['resolved', 'cancelled'],
	resolved: ['closed', 'action_in_progress'],
	closed: [],
	cancelled: []
};

export function canTransition(from: IncidentStatus, to: IncidentStatus): boolean {
	return INCIDENT_TRANSITIONS[from].includes(to);
}

export interface IncidentActor {
	/** CouchDB `_users` name. */
	name: string;
	roles: readonly string[];
	shelterCode: string;
}

/** Shelter Manager / Supervisor of this shelter (system_admin = platform override). */
export function isIncidentManager(actor: IncidentActor): boolean {
	return isSystemAdmin(actor.roles) || isShelterManager(actor.roles, actor.shelterCode);
}

/** Any staff of the shelter — may open a record and add observation notes. */
export function isShelterStaff(actor: IncidentActor): boolean {
	return isSystemAdmin(actor.roles) || hasShelterScope(actor.roles, actor.shelterCode);
}

export function isIncidentOwner(incident: ShelterIncident, actor: IncidentActor): boolean {
	return incident.assigned_to === actor.name;
}

const ownerOrManager = (incident: ShelterIncident, actor: IncidentActor): boolean =>
	isIncidentOwner(incident, actor) || isIncidentManager(actor);

export function canCreateIncident(actor: IncidentActor): boolean {
	return isShelterStaff(actor);
}

export function canAddNote(incident: ShelterIncident, actor: IncidentActor): boolean {
	return !isTerminalStatus(incident.current_status) && isShelterStaff(actor);
}

/** Owner or manager, along an allowed edge. `cancelled` = manager only (D4); the owner may close any severity (D3). */
export function canChangeStatus(
	incident: ShelterIncident,
	to: IncidentStatus,
	actor: IncidentActor
): boolean {
	if (!canTransition(incident.current_status, to)) return false;
	if (to === 'cancelled') return isIncidentManager(actor);
	return ownerOrManager(incident, actor);
}

export function canReassign(incident: ShelterIncident, actor: IncidentActor): boolean {
	return !isTerminalStatus(incident.current_status) && ownerOrManager(incident, actor);
}

/** Late binding — only while the respondent is still `unknown`. */
export function canIdentifyRespondent(incident: ShelterIncident, actor: IncidentActor): boolean {
	return (
		!isTerminalStatus(incident.current_status) &&
		incident.respondent.status === 'unknown' &&
		ownerOrManager(incident, actor)
	);
}

/** Next statuses this actor may move the incident to (drives the action buttons). */
export function availableTransitions(
	incident: ShelterIncident,
	actor: IncidentActor
): IncidentStatus[] {
	return INCIDENT_TRANSITIONS[incident.current_status].filter((to) =>
		canChangeStatus(incident, to, actor)
	);
}
