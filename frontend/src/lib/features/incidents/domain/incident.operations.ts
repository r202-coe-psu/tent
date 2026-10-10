/**
 * Pure state changes on a `shelter_incident`. Each operation checks the policy, appends one
 * timeline entry (Action & Reason) and returns a new doc with a fresh `updated_at`.
 * Throws {@link IncidentRuleError} when the actor or transition is not allowed.
 */
import { makeDoc, type AuthorContext, type Timestamp } from '$lib/db/model';
import {
	INCIDENT_DOC_TYPE,
	INCIDENT_SCHEMA_V,
	INCIDENT_STATUS_LABELS,
	incidentNoteSchema,
	normalizeComplainant,
	normalizeRespondent,
	respondentSchema,
	type IncidentCreateData,
	type IncidentStatus,
	type IncidentTimelineEntry,
	type Respondent,
	type ShelterIncident
} from './incident';
import {
	canAddNote,
	canChangeStatus,
	canCreateIncident,
	canIdentifyRespondent,
	canReassign,
	type IncidentActor
} from './incident.policy';

export class IncidentRuleError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'IncidentRuleError';
	}
}

function note(details: string): string {
	const parsed = incidentNoteSchema.safeParse(details);
	if (!parsed.success) throw new IncidentRuleError(parsed.error.issues[0].message);
	return parsed.data;
}

function append(
	incident: ShelterIncident,
	entry: IncidentTimelineEntry,
	patch: Partial<ShelterIncident> = {}
): ShelterIncident {
	return {
		...incident,
		...patch,
		timeline: [...incident.timeline, entry],
		updated_at: entry.timestamp
	};
}

/** Open a new record — the creator becomes owner (`assigned_to = reported_by`). */
export function createIncident(
	data: IncidentCreateData,
	actor: IncidentActor,
	incidentNo: string
): ShelterIncident {
	if (!canCreateIncident(actor)) {
		throw new IncidentRuleError('ไม่มีสิทธิ์บันทึกเหตุการณ์ในศูนย์นี้');
	}
	const ctx: AuthorContext = { shelterCode: actor.shelterCode, createdBy: actor.name };
	const doc = makeDoc(
		INCIDENT_DOC_TYPE,
		INCIDENT_SCHEMA_V,
		{
			incident_no: incidentNo,
			title: data.title,
			location_detail: data.location_detail,
			category: data.category,
			severity: data.severity,
			occurred_at: new Date(data.occurred_at).toISOString(),
			reported_by: actor.name,
			assigned_to: actor.name,
			description: data.description,
			attachments: [],
			current_status: 'reported' as IncidentStatus,
			complainant: normalizeComplainant(data.complainant),
			respondent: normalizeRespondent(data.respondent),
			timeline: []
		},
		ctx
	);
	return { ...doc, schema_v: INCIDENT_SCHEMA_V };
}

export function changeIncidentStatus(
	incident: ShelterIncident,
	to: IncidentStatus,
	details: string,
	actor: IncidentActor,
	at: Timestamp = new Date().toISOString()
): ShelterIncident {
	if (!canChangeStatus(incident, to, actor)) {
		throw new IncidentRuleError(
			`ไม่สามารถเปลี่ยนสถานะจาก "${INCIDENT_STATUS_LABELS[incident.current_status]}" เป็น "${INCIDENT_STATUS_LABELS[to]}" ได้`
		);
	}
	return append(
		incident,
		{
			timestamp: at,
			actor_id: actor.name,
			type: 'status_change',
			details: note(details),
			from_status: incident.current_status,
			to_status: to
		},
		{ current_status: to }
	);
}

export function reassignIncident(
	incident: ShelterIncident,
	toUser: string,
	reason: string,
	actor: IncidentActor,
	at: Timestamp = new Date().toISOString()
): ShelterIncident {
	if (!canReassign(incident, actor)) {
		throw new IncidentRuleError('เฉพาะเจ้าของเคสหรือผู้จัดการศูนย์เท่านั้นที่ส่งต่อเคสได้');
	}
	const target = toUser.trim();
	if (!target) throw new IncidentRuleError('กรุณาเลือกผู้รับผิดชอบคนใหม่');
	if (target === incident.assigned_to) {
		throw new IncidentRuleError('ผู้รับผิดชอบคนใหม่ต้องไม่ใช่คนเดิม');
	}
	return append(
		incident,
		{
			timestamp: at,
			actor_id: actor.name,
			type: 'reassignment',
			details: note(reason),
			from_assignee: incident.assigned_to,
			to_assignee: target
		},
		{ assigned_to: target }
	);
}

export function addIncidentNote(
	incident: ShelterIncident,
	details: string,
	actor: IncidentActor,
	at: Timestamp = new Date().toISOString()
): ShelterIncident {
	if (!canAddNote(incident, actor)) {
		throw new IncidentRuleError('ไม่สามารถเพิ่มบันทึกในเคสนี้ได้');
	}
	return append(incident, {
		timestamp: at,
		actor_id: actor.name,
		type: 'add_note',
		details: note(details)
	});
}

/** Late binding: `unknown` → `known_evacuee` / `known_external`, logged with a timestamp. */
export function identifyRespondent(
	incident: ShelterIncident,
	respondent: {
		status: 'known_evacuee' | 'known_external';
		evacuee_id?: string | null;
		name_or_detail?: string | null;
	},
	details: string,
	actor: IncidentActor,
	at: Timestamp = new Date().toISOString()
): ShelterIncident {
	if (!canIdentifyRespondent(incident, actor)) {
		throw new IncidentRuleError(
			'ระบุคู่กรณีได้เฉพาะเคสที่ยังไม่ทราบตัวตน โดยเจ้าของเคสหรือผู้จัดการ'
		);
	}
	const parsed = respondentSchema.safeParse({
		...respondent,
		unknown_description: incident.respondent.unknown_description
	});
	if (!parsed.success) throw new IncidentRuleError(parsed.error.issues[0].message);
	const next: Respondent = normalizeRespondent(parsed.data);
	return append(
		incident,
		{
			timestamp: at,
			actor_id: actor.name,
			type: 'identify_respondent',
			details: note(details)
		},
		{ respondent: next }
	);
}
