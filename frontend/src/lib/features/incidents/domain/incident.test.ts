import { describe, expect, it } from 'vitest';
import {
	bangkokDayKey,
	complainantSchema,
	filterIncidents,
	incidentTitle,
	incidentCreateSchema,
	isShelterIncident,
	nextIncidentNo,
	normalizeComplainant,
	respondentSchema,
	sortIncidents,
	type IncidentCreateInput,
	type ShelterIncident
} from './incident';
import {
	availableTransitions,
	canAddNote,
	canChangeStatus,
	canIdentifyRespondent,
	canReassign,
	canTransition,
	type IncidentActor
} from './incident.policy';
import {
	addIncidentNote,
	changeIncidentStatus,
	createIncident,
	identifyRespondent,
	IncidentRuleError,
	reassignIncident
} from './incident.operations';

const OWNER: IncidentActor = {
	name: 'staff_a',
	roles: ['shelter:SH001', 'SH001:registration_staff'],
	shelterCode: 'SH001'
};
const PEER: IncidentActor = {
	name: 'staff_b',
	roles: ['shelter:SH001', 'SH001:facility_staff'],
	shelterCode: 'SH001'
};
const MANAGER: IncidentActor = {
	name: 'sm',
	roles: ['shelter:SH001', 'SH001:shelter_manager'],
	shelterCode: 'SH001'
};
const OUTSIDER: IncidentActor = {
	name: 'other',
	roles: ['shelter:SH002', 'SH002:shelter_manager'],
	shelterCode: 'SH001'
};

const input = (over: Partial<IncidentCreateInput> = {}): IncidentCreateInput => ({
	title: 'ชายชุดดำขโมยรองเท้า',
	location_detail: 'โซนเต็นท์ชาย แถว 3',
	category: 'theft_property_damage',
	severity: 'medium',
	occurred_at: '2026-09-22T13:00:00.000Z',
	description: 'รองเท้าหาย',
	complainant: { type: 'evacuee', evacuee_id: 'evacuee:01A', name_or_detail: null },
	respondent: { status: 'unknown', unknown_description: 'ชายเสื้อแดง' },
	...over
});

function open(over: Partial<IncidentCreateInput> = {}): ShelterIncident {
	return createIncident(incidentCreateSchema.parse(input(over)), OWNER, 'INC-20260922-001');
}

describe('incidentCreateSchema', () => {
	it('requires a non-blank title of at most 120 characters', () => {
		expect(incidentCreateSchema.safeParse(input({ title: '   ' })).success).toBe(false);
		expect(incidentCreateSchema.safeParse(input({ title: 'ก'.repeat(121) })).success).toBe(false);
		expect(open({ title: '  ไฟฟ้าช็อตโซน B  ' }).title).toBe('ไฟฟ้าช็อตโซน B');
	});

	it('accepts a record without any evacuee (property damage, no respondent)', () => {
		const r = incidentCreateSchema.safeParse(
			input({
				complainant: { type: 'shelter_property', name_or_detail: 'ประตูห้องน้ำพัง' },
				respondent: { status: 'none' }
			})
		);
		expect(r.success).toBe(true);
	});

	it('requires evacuee_id when complainant is an evacuee', () => {
		const r = complainantSchema.safeParse({ type: 'evacuee' });
		expect(r.success).toBe(false);
	});

	it('requires a name for known_external respondents', () => {
		expect(respondentSchema.safeParse({ status: 'known_external' }).success).toBe(false);
	});

	it('drops fields that do not belong to the chosen party type', () => {
		const c = normalizeComplainant(
			complainantSchema.parse({ type: 'anonymous', evacuee_id: 'evacuee:01A', name_or_detail: 'x' })
		);
		expect(c).toEqual({ type: 'anonymous', evacuee_id: null, name_or_detail: null });
	});
});

describe('createIncident', () => {
	it('makes the creator the owner and starts at reported', () => {
		const doc = open();
		expect(isShelterIncident(doc)).toBe(true);
		expect(doc._id).toMatch(/^shelter_incident:/);
		expect(doc.reported_by).toBe('staff_a');
		expect(doc.assigned_to).toBe('staff_a');
		expect(doc.current_status).toBe('reported');
		expect(doc.shelter_code).toBe('SH001');
		expect(doc.timeline).toEqual([]);
	});

	it('rejects actors without shelter scope', () => {
		expect(() =>
			createIncident(incidentCreateSchema.parse(input()), OUTSIDER, 'INC-20260922-001')
		).toThrow(IncidentRuleError);
	});
});

describe('nextIncidentNo', () => {
	it('uses the Bangkok calendar day', () => {
		// 2026-09-21T18:00Z is already 22 Sep in Bangkok (UTC+7)
		expect(bangkokDayKey(new Date('2026-09-21T18:00:00.000Z'))).toBe('20260922');
	});

	it('increments past the highest number of the same day only', () => {
		const at = new Date('2026-09-22T05:00:00.000Z');
		expect(nextIncidentNo([], at)).toBe('INC-20260922-001');
		expect(nextIncidentNo(['INC-20260922-002', 'INC-20260921-009', 'junk'], at)).toBe(
			'INC-20260922-003'
		);
	});
});

describe('status graph', () => {
	it('follows the spec diagram', () => {
		expect(canTransition('reported', 'action_in_progress')).toBe(true);
		expect(canTransition('reported', 'resolved')).toBe(false);
		expect(canTransition('resolved', 'action_in_progress')).toBe(true);
		expect(canTransition('closed', 'action_in_progress')).toBe(false);
	});
});

describe('permissions', () => {
	it('owner can move own case; peers cannot', () => {
		const doc = open();
		expect(canChangeStatus(doc, 'action_in_progress', OWNER)).toBe(true);
		expect(canChangeStatus(doc, 'action_in_progress', PEER)).toBe(false);
		expect(canChangeStatus(doc, 'action_in_progress', MANAGER)).toBe(true);
	});

	it('only the manager may cancel', () => {
		const doc = open();
		expect(canChangeStatus(doc, 'cancelled', OWNER)).toBe(false);
		expect(canChangeStatus(doc, 'cancelled', MANAGER)).toBe(true);
		expect(availableTransitions(doc, OWNER)).toEqual(['action_in_progress']);
	});

	it('the owner may close an incident of any severity (D3)', () => {
		let doc = open({ severity: 'critical' });
		doc = changeIncidentStatus(doc, 'action_in_progress', 'แยกพื้นที่', OWNER);
		doc = changeIncidentStatus(doc, 'resolved', 'สงบแล้ว', OWNER);
		expect(canChangeStatus(doc, 'closed', OWNER)).toBe(true);
		expect(canChangeStatus(doc, 'closed', PEER)).toBe(false);
	});

	it('the manager may cancel while the case is in progress, not after resolve (D4)', () => {
		const doc = changeIncidentStatus(open(), 'action_in_progress', 'เริ่มตรวจสอบ', OWNER);
		expect(canChangeStatus(doc, 'cancelled', MANAGER)).toBe(true);
		expect(canChangeStatus(doc, 'cancelled', OWNER)).toBe(false);
		const resolved = changeIncidentStatus(doc, 'resolved', 'จบ', OWNER);
		expect(canChangeStatus(resolved, 'cancelled', MANAGER)).toBe(false);
	});

	it('any staff may comment; nobody may touch a terminal case', () => {
		const doc = open();
		expect(canAddNote(doc, PEER)).toBe(true);
		const cancelled = changeIncidentStatus(doc, 'cancelled', 'แจ้งซ้ำ', MANAGER);
		expect(canAddNote(cancelled, MANAGER)).toBe(false);
		expect(canReassign(cancelled, MANAGER)).toBe(false);
	});

	it('manager of another shelter has no authority here', () => {
		const doc = open();
		expect(canChangeStatus(doc, 'action_in_progress', OUTSIDER)).toBe(false);
		expect(canAddNote(doc, OUTSIDER)).toBe(false);
	});
});

describe('operations', () => {
	it('status change appends an audit entry with from/to and the reason', () => {
		const doc = changeIncidentStatus(open(), 'action_in_progress', 'เข้าไกล่เกลี่ย', OWNER, 'T1');
		expect(doc.current_status).toBe('action_in_progress');
		expect(doc.updated_at).toBe('T1');
		expect(doc.timeline).toEqual([
			{
				timestamp: 'T1',
				actor_id: 'staff_a',
				type: 'status_change',
				details: 'เข้าไกล่เกลี่ย',
				from_status: 'reported',
				to_status: 'action_in_progress'
			}
		]);
	});

	it('rejects an empty reason note', () => {
		expect(() => changeIncidentStatus(open(), 'action_in_progress', '   ', OWNER)).toThrow(
			IncidentRuleError
		);
	});

	it('handover moves ownership so the new owner can act and the old one cannot', () => {
		const doc = reassignIncident(open(), 'staff_b', 'ส่งเวรบ่าย', OWNER);
		expect(doc.assigned_to).toBe('staff_b');
		expect(doc.timeline.at(-1)).toMatchObject({
			type: 'reassignment',
			from_assignee: 'staff_a',
			to_assignee: 'staff_b'
		});
		expect(canChangeStatus(doc, 'action_in_progress', PEER)).toBe(true);
		expect(canChangeStatus(doc, 'action_in_progress', OWNER)).toBe(false);
	});

	it('peer cannot reassign', () => {
		expect(() => reassignIncident(open(), 'staff_b', 'x', PEER)).toThrow(IncidentRuleError);
	});

	it('peer note is logged without changing status', () => {
		const doc = addIncidentNote(open(), 'เห็นชายเสื้อแดงเดินผ่าน', PEER);
		expect(doc.current_status).toBe('reported');
		expect(doc.timeline.at(-1)).toMatchObject({ type: 'add_note', actor_id: 'staff_b' });
	});

	it('late binding keeps the original description and blocks a second identification', () => {
		const doc = identifyRespondent(
			open(),
			{ status: 'known_evacuee', evacuee_id: 'evacuee:01B' },
			'ตรวจกล้องพบ',
			OWNER
		);
		expect(doc.respondent).toEqual({
			status: 'known_evacuee',
			evacuee_id: 'evacuee:01B',
			name_or_detail: null,
			unknown_description: 'ชายเสื้อแดง'
		});
		expect(doc.timeline.at(-1)?.type).toBe('identify_respondent');
		expect(canIdentifyRespondent(doc, OWNER)).toBe(false);
	});
});

describe('list helpers', () => {
	const mk = (over: Partial<ShelterIncident>): ShelterIncident => ({ ...open(), ...over });

	it('sorts by severity then newest occurred_at', () => {
		const a = mk({ _id: 'a', severity: 'low', occurred_at: '2026-09-22T10:00:00Z' });
		const b = mk({ _id: 'b', severity: 'critical', occurred_at: '2026-09-21T10:00:00Z' });
		const c = mk({ _id: 'c', severity: 'low', occurred_at: '2026-09-23T10:00:00Z' });
		expect(sortIncidents([a, b, c]).map((i) => i._id)).toEqual(['b', 'c', 'a']);
	});

	it('open filter hides closed and cancelled (shift handover)', () => {
		const items = [
			mk({ _id: 'r', current_status: 'reported' }),
			mk({ _id: 'x', current_status: 'closed' }),
			mk({ _id: 'y', current_status: 'cancelled' }),
			mk({ _id: 'z', current_status: 'resolved' })
		];
		const f = { status: 'open', severity: 'all', category: 'all' } as const;
		expect(filterIncidents(items, f).map((i) => i._id)).toEqual(['r', 'z']);
	});

	it('search matches title, incident_no and location, case-insensitive', () => {
		const items = [
			mk({ _id: 't', title: 'ชายชุดดำขโมยรองเท้า', incident_no: 'INC-20260922-001' }),
			mk({ _id: 'n', title: 'ไฟดับ', incident_no: 'INC-20260922-002' }),
			mk({ _id: 'l', title: 'ทะเลาะวิวาท', location_detail: 'Zone B หน้าโรงอาหาร' })
		];
		const f = (query: string) =>
			filterIncidents(items, { status: 'all', severity: 'all', category: 'all', query }).map(
				(i) => i._id
			);
		expect(f('ชุดดำ')).toEqual(['t']);
		expect(f('20260922-002')).toEqual(['n']);
		expect(f('zone b')).toEqual(['l']);
		expect(f('   ')).toEqual(['t', 'n', 'l']);
	});

	it('falls back to the category label when an older record has no title', () => {
		const legacy = { ...open(), title: undefined };
		expect(incidentTitle(legacy)).toBe('การลักขโมย / ทรัพย์สินเสียหาย');
	});
});
