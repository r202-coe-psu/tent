/**
 * Shelter Incident Log — doc `shelter_incident:{ulid}` in `shelter_{code}` (schema_v 1).
 *
 * "Daily Occurrence Book": any shelter staff opens a record and becomes its owner
 * (`assigned_to`), every status change / handover carries a reason note in `timeline[]`
 * (append-only), and parties are split into complainant vs respondent so a respondent can
 * be identified later (late binding).
 *
 * Spec: docs/changes/08-E-reports/CR-155-shelter-incident-log.md · docs/data/schema.md §2.10. Pure — no I/O, no Svelte.
 */
import { z } from 'zod';
import type { BaseDoc, Timestamp } from '$lib/db/model';

export const INCIDENT_DOC_TYPE = 'shelter_incident' as const;
export const INCIDENT_SCHEMA_V = 1 as const;

// ---------------------------------------------------------------- enums

export const INCIDENT_STATUSES = [
	'reported',
	'action_in_progress',
	'resolved',
	'closed',
	'cancelled'
] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

/** Statuses that end the record — no further writes of any kind. */
export const TERMINAL_INCIDENT_STATUSES: readonly IncidentStatus[] = ['closed', 'cancelled'];

export const INCIDENT_CATEGORIES = [
	'harassment_violence',
	'theft_property_damage',
	'substance_rule_violation',
	'fraud_resource_abuse',
	'medical_mental_health',
	'dispute',
	'other'
] as const;
export type IncidentCategory = (typeof INCIDENT_CATEGORIES)[number];

export const INCIDENT_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

export const COMPLAINANT_TYPES = [
	'evacuee',
	'staff',
	'external',
	'shelter_property',
	'anonymous'
] as const;
export type ComplainantType = (typeof COMPLAINANT_TYPES)[number];

export const RESPONDENT_STATUSES = ['known_evacuee', 'known_external', 'unknown', 'none'] as const;
export type RespondentStatus = (typeof RESPONDENT_STATUSES)[number];

export const TIMELINE_ENTRY_TYPES = [
	'status_change',
	'reassignment',
	'add_note',
	'identify_respondent'
] as const;
export type TimelineEntryType = (typeof TIMELINE_ENTRY_TYPES)[number];

// ---------------------------------------------------------------- labels (th)

export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
	reported: 'รับแจ้งเหตุ',
	action_in_progress: 'กำลังดำเนินการ',
	resolved: 'จัดการเรียบร้อย',
	closed: 'ปิดเคส',
	cancelled: 'ยกเลิก'
};

export const INCIDENT_CATEGORY_LABELS: Record<IncidentCategory, string> = {
	harassment_violence: 'การคุกคาม / ใช้ความรุนแรง',
	theft_property_damage: 'การลักขโมย / ทรัพย์สินเสียหาย',
	substance_rule_violation: 'ละเมิดกฎศูนย์ / สารเสพติด / แอลกอฮอล์',
	fraud_resource_abuse: 'วนซ้ำสิทธิ / ปัญหาโควตาสิ่งของ',
	medical_mental_health: 'เหตุฉุกเฉินทางการแพทย์ / สุขภาพจิต',
	dispute: 'ข้อพิพาททั่วไป',
	other: 'อื่นๆ'
};

export const INCIDENT_SEVERITY_LABELS: Record<IncidentSeverity, string> = {
	low: 'ต่ำ',
	medium: 'ปานกลาง',
	high: 'สูง',
	critical: 'วิกฤต'
};

export const COMPLAINANT_TYPE_LABELS: Record<ComplainantType, string> = {
	evacuee: 'ผู้เข้าพัก',
	staff: 'เจ้าหน้าที่',
	external: 'บุคคลภายนอก',
	shelter_property: 'ทรัพย์สินศูนย์',
	anonymous: 'ไม่ประสงค์ออกนาม'
};

export const RESPONDENT_STATUS_LABELS: Record<RespondentStatus, string> = {
	known_evacuee: 'ผู้เข้าพัก (ทราบตัวตน)',
	known_external: 'บุคคลภายนอก (ทราบตัวตน)',
	unknown: 'ยังไม่ทราบตัวตน',
	none: 'ไม่มีคู่กรณี'
};

export const TIMELINE_ENTRY_TYPE_LABELS: Record<TimelineEntryType, string> = {
	status_change: 'เปลี่ยนสถานะ',
	reassignment: 'ส่งต่อเคส',
	add_note: 'บันทึกสังเกตการณ์',
	identify_respondent: 'ระบุคู่กรณี'
};

// ---------------------------------------------------------------- parties

const optionalText = z.string().trim().max(500).nullish();

export const complainantSchema = z
	.object({
		type: z.enum(COMPLAINANT_TYPES, { error: 'กรุณาเลือกฝั่งผู้แจ้ง / ผู้เสียหาย' }),
		evacuee_id: optionalText,
		name_or_detail: optionalText
	})
	.superRefine((c, ctx) => {
		if (c.type === 'evacuee' && !c.evacuee_id) {
			ctx.addIssue({ code: 'custom', path: ['evacuee_id'], message: 'กรุณาเลือกผู้เข้าพัก' });
		}
		if ((c.type === 'staff' || c.type === 'external') && !c.name_or_detail) {
			ctx.addIssue({ code: 'custom', path: ['name_or_detail'], message: 'กรุณาระบุชื่อ' });
		}
	});
export type ComplainantInput = z.infer<typeof complainantSchema>;

export const respondentSchema = z
	.object({
		status: z.enum(RESPONDENT_STATUSES, { error: 'กรุณาเลือกสถานะคู่กรณี' }),
		evacuee_id: optionalText,
		name_or_detail: optionalText,
		unknown_description: optionalText
	})
	.superRefine((r, ctx) => {
		if (r.status === 'known_evacuee' && !r.evacuee_id) {
			ctx.addIssue({ code: 'custom', path: ['evacuee_id'], message: 'กรุณาเลือกผู้เข้าพัก' });
		}
		if (r.status === 'known_external' && !r.name_or_detail) {
			ctx.addIssue({
				code: 'custom',
				path: ['name_or_detail'],
				message: 'กรุณาระบุชื่อ / ข้อมูลติดต่อ'
			});
		}
	});
export type RespondentInput = z.infer<typeof respondentSchema>;

/** Complainant / victim side — never feeds the behavior history. */
export interface Complainant {
	type: ComplainantType;
	evacuee_id: string | null;
	name_or_detail: string | null;
}

/** Respondent / subject side — `unknown` can be identified later (late binding). */
export interface Respondent {
	status: RespondentStatus;
	evacuee_id: string | null;
	name_or_detail: string | null;
	unknown_description: string | null;
}

const orNull = (v: string | null | undefined): string | null => v?.trim() || null;

/** Drop fields that do not belong to the chosen complainant type. */
export function normalizeComplainant(c: ComplainantInput): Complainant {
	return {
		type: c.type,
		evacuee_id: c.type === 'evacuee' ? orNull(c.evacuee_id) : null,
		name_or_detail: c.type === 'anonymous' ? null : orNull(c.name_or_detail)
	};
}

/** Drop fields that do not belong to the chosen respondent status. */
export function normalizeRespondent(r: RespondentInput): Respondent {
	return {
		status: r.status,
		evacuee_id: r.status === 'known_evacuee' ? orNull(r.evacuee_id) : null,
		name_or_detail: r.status === 'known_external' ? orNull(r.name_or_detail) : null,
		// Kept after late binding — the original description is part of the evidence trail.
		unknown_description: r.status === 'none' ? null : orNull(r.unknown_description)
	};
}

// ---------------------------------------------------------------- document

export interface IncidentTimelineEntry {
	timestamp: Timestamp;
	/** CouchDB `_users` name of the actor. */
	actor_id: string;
	type: TimelineEntryType;
	/** Action & reason note — never empty. */
	details: string;
	from_status?: IncidentStatus;
	to_status?: IncidentStatus;
	from_assignee?: string;
	to_assignee?: string;
}

export interface ShelterIncident extends BaseDoc {
	type: typeof INCIDENT_DOC_TYPE;
	schema_v: typeof INCIDENT_SCHEMA_V;
	/** `INC-YYYYMMDD-NNN` — human reference, per shelter per Bangkok day (display only). */
	incident_no: string;
	/**
	 * Short headline for the list + search (IL-D12) — required on create, immutable. Optional on
	 * read only for records written before the field existed (dev data); show via `incidentTitle`.
	 */
	title?: string;
	location_detail: string;
	category: IncidentCategory;
	severity: IncidentSeverity;
	occurred_at: Timestamp;
	/** Creator — fixed forever. */
	reported_by: string;
	/** Current owner — defaults to `reported_by`. */
	assigned_to: string;
	description: string;
	/** `image:{ulid}` doc ids (upload UI is a later slice). */
	attachments: string[];
	current_status: IncidentStatus;
	complainant: Complainant;
	respondent: Respondent;
	timeline: IncidentTimelineEntry[];
}

export const isShelterIncident = (d: unknown): d is ShelterIncident =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === INCIDENT_DOC_TYPE;

/** Headline to display — falls back to the category label for records without a `title`. */
export const incidentTitle = (i: ShelterIncident): string =>
	i.title?.trim() || INCIDENT_CATEGORY_LABELS[i.category];

export const isTerminalStatus = (status: IncidentStatus): boolean =>
	TERMINAL_INCIDENT_STATUSES.includes(status);

// ---------------------------------------------------------------- inputs

export const incidentNoteSchema = z
	.string({ error: 'กรุณาระบุเหตุผล / สิ่งที่ได้ดำเนินการ' })
	.trim()
	.min(1, 'กรุณาระบุเหตุผล / สิ่งที่ได้ดำเนินการ')
	.max(2000, 'ข้อความยาวเกิน 2000 ตัวอักษร');

export const INCIDENT_TITLE_MAX = 120;

export const incidentCreateSchema = z.object({
	title: z
		.string({ error: 'กรุณาระบุหัวข้อเหตุการณ์' })
		.trim()
		.min(1, 'กรุณาระบุหัวข้อเหตุการณ์')
		.max(INCIDENT_TITLE_MAX, `หัวข้อยาวเกิน ${INCIDENT_TITLE_MAX} ตัวอักษร`),
	location_detail: z.string().trim().min(1, 'กรุณาระบุจุดเกิดเหตุ').max(200),
	category: z.enum(INCIDENT_CATEGORIES, { error: 'กรุณาเลือกหมวดหมู่' }),
	severity: z.enum(INCIDENT_SEVERITIES, { error: 'กรุณาเลือกระดับความรุนแรง' }),
	occurred_at: z
		.string()
		.min(1, 'กรุณาระบุวันเวลาที่เกิดเหตุ')
		.refine((v) => !Number.isNaN(Date.parse(v)), 'วันเวลาไม่ถูกต้อง'),
	description: z.string().trim().min(1, 'กรุณาระบุรายละเอียดเหตุการณ์').max(4000),
	complainant: complainantSchema,
	respondent: respondentSchema
});
export type IncidentCreateInput = z.input<typeof incidentCreateSchema>;
export type IncidentCreateData = z.infer<typeof incidentCreateSchema>;

// ---------------------------------------------------------------- incident_no

const BANGKOK_DAY = new Intl.DateTimeFormat('en-CA', {
	timeZone: 'Asia/Bangkok',
	year: 'numeric',
	month: '2-digit',
	day: '2-digit'
});

/** `YYYYMMDD` in Asia/Bangkok for an instant. */
export function bangkokDayKey(at: Date): string {
	return BANGKOK_DAY.format(at).replaceAll('-', '');
}

const INCIDENT_NO_RE = /^INC-(\d{8})-(\d{3,})$/;

/**
 * Next `INC-YYYYMMDD-NNN` for the Bangkok day of `at`, one past the highest number already
 * used that day. Best-effort under concurrency — two devices may mint the same number;
 * `_id` (ULID) stays the identity, `incident_no` is a human reference.
 */
export function nextIncidentNo(existing: readonly string[], at: Date): string {
	const day = bangkokDayKey(at);
	let max = 0;
	for (const no of existing) {
		const m = INCIDENT_NO_RE.exec(no);
		if (m && m[1] === day) max = Math.max(max, Number(m[2]));
	}
	return `INC-${day}-${String(max + 1).padStart(3, '0')}`;
}

// ---------------------------------------------------------------- list helpers

const SEVERITY_RANK: Record<IncidentSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** Default list order: severity (critical first), then `occurred_at` newest first. */
export function sortIncidents(items: readonly ShelterIncident[]): ShelterIncident[] {
	return [...items].sort(
		(a, b) =>
			SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
			b.occurred_at.localeCompare(a.occurred_at)
	);
}

/** `open` = shift-handover view (anything not closed / cancelled). */
export type IncidentStatusFilter = 'open' | 'all' | IncidentStatus;

export interface IncidentFilter {
	status: IncidentStatusFilter;
	severity: IncidentSeverity | 'all';
	category: IncidentCategory | 'all';
	/** Only incidents currently assigned to this user. */
	assignedTo?: string | null;
	/** Free text over title, `incident_no` and location (case-insensitive substring). */
	query?: string;
}

export function filterIncidents(
	items: readonly ShelterIncident[],
	f: IncidentFilter
): ShelterIncident[] {
	const q = f.query?.trim().toLowerCase() ?? '';
	return items.filter((i) => {
		if (f.status === 'open' && isTerminalStatus(i.current_status)) return false;
		if (f.status !== 'open' && f.status !== 'all' && i.current_status !== f.status) return false;
		if (f.severity !== 'all' && i.severity !== f.severity) return false;
		if (f.category !== 'all' && i.category !== f.category) return false;
		if (f.assignedTo && i.assigned_to !== f.assignedTo) return false;
		if (
			q &&
			![incidentTitle(i), i.incident_no, i.location_detail].some((t) => t.toLowerCase().includes(q))
		)
			return false;
		return true;
	});
}
