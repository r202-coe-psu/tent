import { describe, expect, it } from 'vitest';
import {
	addIncidentNote,
	changeIncidentStatus,
	createIncident,
	identifyRespondent,
	incidentCreateSchema,
	reassignIncident,
	type IncidentActor,
	type ShelterIncident
} from '$lib/features/incidents';
import { buildValidateDocUpdate } from './shelter-access-design';

type UserCtx = { name: string; roles: string[] };
type Doc = Record<string, unknown>;
type ValidateFn = (newDoc: Doc, oldDoc: Doc | null, userCtx: UserCtx) => void;

/** The client domain ops and the CouchDB guard must agree — build docs with the real ops. */
const validate = new Function(`return ${buildValidateDocUpdate('SH001')}`)() as ValidateFn;

function expectForbidden(run: () => void, match: RegExp): void {
	try {
		run();
	} catch (e) {
		expect((e as { forbidden?: string }).forbidden ?? String(e)).toMatch(match);
		return;
	}
	throw new Error(`Expected a forbidden error matching ${match}, but nothing was thrown`);
}

const ctx = (a: IncidentActor): UserCtx => ({ name: a.name, roles: [...a.roles] });
const actor = (name: string, cap: string): IncidentActor => ({
	name,
	roles: ['shelter:SH001', `SH001:${cap}`],
	shelterCode: 'SH001'
});
const OWNER = actor('staff_a', 'registration_staff');
const PEER = actor('staff_b', 'kitchen_staff');
const MANAGER = actor('sm', 'shelter_manager');
const OUTSIDER: UserCtx = { name: 'x', roles: ['shelter:SH002', 'SH002:shelter_manager'] };

const ULID = '01J8Z6Q4ZKX0W3M2N1P5R7T9VB';

function created(severity: 'medium' | 'critical' = 'medium'): ShelterIncident {
	const doc = createIncident(
		incidentCreateSchema.parse({
			title: 'ชายชุดดำขโมยรองเท้า',
			location_detail: 'หน้าโรงอาหาร',
			category: 'dispute',
			severity,
			occurred_at: '2026-09-22T05:00:00.000Z',
			description: 'ทะเลาะเรื่องคิว',
			complainant: { type: 'anonymous' },
			respondent: { status: 'unknown', unknown_description: 'ชายเสื้อแดง' }
		}),
		OWNER,
		'INC-20260922-001'
	);
	return { ...doc, _id: `shelter_incident:${ULID}`, _rev: '1-a' };
}

const asDoc = (d: ShelterIncident): Doc => d as unknown as Doc;
const run = (next: ShelterIncident, prev: ShelterIncident | null, user: UserCtx) => () =>
	validate(asDoc(next), prev ? asDoc(prev) : null, user);

describe('validate_doc_update — shelter_incident', () => {
	it('lets any shelter staff open a record they own', () => {
		expect(run(created(), null, ctx(OWNER))).not.toThrow();
	});

	it('rejects staff of another shelter', () => {
		expectForbidden(run(created(), null, OUTSIDER), /Only staff of this shelter/);
	});

	it('requires a title on create and freezes it afterwards (IL-D12)', () => {
		expectForbidden(run({ ...created(), title: '  ' }, null, ctx(OWNER)), /title is required/);
		expectForbidden(run({ ...created(), title: undefined }, null, ctx(OWNER)), /title is required/);
		const prev = created();
		const retitled = { ...addIncidentNote(prev, 'แก้หัวข้อ', OWNER), title: 'หัวข้อใหม่' };
		expectForbidden(run(retitled, prev, ctx(OWNER)), /title is immutable/);
	});

	it('rejects a new record assigned to someone else', () => {
		expectForbidden(
			run({ ...created(), assigned_to: 'staff_b' }, null, ctx(OWNER)),
			/assigned to its creator/
		);
	});

	it('owner and manager may change status; a peer may not', () => {
		const prev = created();
		expect(
			run(
				changeIncidentStatus(prev, 'action_in_progress', 'เข้าไกล่เกลี่ย', OWNER),
				prev,
				ctx(OWNER)
			)
		).not.toThrow();
		expect(
			run(changeIncidentStatus(prev, 'action_in_progress', 'x', MANAGER), prev, ctx(MANAGER))
		).not.toThrow();
		const forged = changeIncidentStatus(prev, 'action_in_progress', 'x', MANAGER);
		const asPeer = {
			...forged,
			timeline: forged.timeline.map((t) => ({ ...t, actor_id: PEER.name }))
		};
		expectForbidden(run(asPeer, prev, ctx(PEER)), /assignee or a shelter manager/);
	});

	it('rejects skipping states and cancel by a non-manager', () => {
		const prev = created();
		const skip: ShelterIncident = {
			...prev,
			current_status: 'resolved',
			timeline: [
				{
					timestamp: 'T',
					actor_id: OWNER.name,
					type: 'status_change',
					details: 'x',
					from_status: 'reported',
					to_status: 'resolved'
				}
			]
		};
		expectForbidden(run(skip, prev, ctx(OWNER)), /Invalid shelter_incident transition/);
		const cancel = changeIncidentStatus(prev, 'cancelled', 'ซ้ำ', MANAGER);
		const byOwner = {
			...cancel,
			timeline: cancel.timeline.map((t) => ({ ...t, actor_id: 'staff_a' }))
		};
		expectForbidden(run(byOwner, prev, ctx(OWNER)), /Only shelter managers can cancel/);
		expect(run(cancel, prev, ctx(MANAGER))).not.toThrow();
	});

	it('the owner may close a critical case (D3)', () => {
		let prev = created('critical');
		prev = changeIncidentStatus(prev, 'action_in_progress', 'a', OWNER);
		prev = changeIncidentStatus(prev, 'resolved', 'b', OWNER);
		expect(run(changeIncidentStatus(prev, 'closed', 'ปิด', OWNER), prev, ctx(OWNER))).not.toThrow();
	});

	it('the manager may cancel from action_in_progress; the owner may not (D4)', () => {
		const prev = changeIncidentStatus(created(), 'action_in_progress', 'a', OWNER);
		const cancel = changeIncidentStatus(prev, 'cancelled', 'แจ้งเท็จ', MANAGER);
		expect(run(cancel, prev, ctx(MANAGER))).not.toThrow();
		const byOwner = {
			...cancel,
			timeline: cancel.timeline.map((t, i) =>
				i === cancel.timeline.length - 1 ? { ...t, actor_id: OWNER.name } : t
			)
		};
		expectForbidden(run(byOwner, prev, ctx(OWNER)), /Only shelter managers can cancel/);
	});

	it('any staff may add a note, but only as themselves', () => {
		const prev = created();
		expect(run(addIncidentNote(prev, 'เห็นเหตุ', PEER), prev, ctx(PEER))).not.toThrow();
		expectForbidden(
			run(addIncidentNote(prev, 'เห็นเหตุ', OWNER), prev, ctx(PEER)),
			/actor must be the caller/
		);
	});

	it('timeline is append-only and needs a reason', () => {
		const prev = addIncidentNote(created(), 'first', PEER);
		const rewritten: ShelterIncident = {
			...prev,
			timeline: [{ ...prev.timeline[0], details: 'edited' }, prev.timeline[0]]
		};
		expectForbidden(run(rewritten, prev, ctx(PEER)), /append exactly one/);
		const blank: ShelterIncident = {
			...prev,
			timeline: [
				...prev.timeline,
				{ timestamp: 'T', actor_id: PEER.name, type: 'add_note', details: '  ' }
			]
		};
		expectForbidden(run(blank, prev, ctx(PEER)), /details/);
	});

	it('locks core facts after creation', () => {
		const prev = created();
		const note = addIncidentNote(prev, 'x', OWNER);
		expectForbidden(
			run({ ...note, description: 'changed' }, prev, ctx(OWNER)),
			/description is immutable/
		);
	});

	it('handover by owner moves ownership; peer cannot hand over', () => {
		const prev = created();
		expect(run(reassignIncident(prev, 'staff_b', 'ส่งเวร', OWNER), prev, ctx(OWNER))).not.toThrow();
		const forged = reassignIncident(prev, 'staff_b', 'x', OWNER);
		const byPeer = {
			...forged,
			timeline: forged.timeline.map((t) => ({ ...t, actor_id: 'staff_b' }))
		};
		expectForbidden(run(byPeer, prev, ctx(PEER)), /reassign/);
	});

	it('late binding only from unknown to known', () => {
		const prev = created();
		const next = identifyRespondent(
			prev,
			{ status: 'known_evacuee', evacuee_id: 'evacuee:01B' },
			'ตรวจกล้อง',
			OWNER
		);
		expect(run(next, prev, ctx(OWNER))).not.toThrow();
		const again = { ...next, _rev: '2-b' };
		const twice: ShelterIncident = {
			...again,
			timeline: [
				...again.timeline,
				{ timestamp: 'T', actor_id: OWNER.name, type: 'identify_respondent', details: 'y' }
			]
		};
		expectForbidden(run(twice, again, ctx(OWNER)), /unknown to known/);
		const external: ShelterIncident = {
			...prev,
			respondent: { ...prev.respondent, status: 'known_external', name_or_detail: null },
			timeline: [
				...prev.timeline,
				{ timestamp: 'T', actor_id: OWNER.name, type: 'identify_respondent', details: 'z' }
			]
		};
		expectForbidden(run(external, prev, ctx(OWNER)), /known_external respondent requires/);
	});

	it('nothing may change once cancelled', () => {
		const prev = changeIncidentStatus(created(), 'cancelled', 'ซ้ำ', MANAGER);
		const note: ShelterIncident = {
			...prev,
			timeline: [
				...prev.timeline,
				{ timestamp: 'T', actor_id: MANAGER.name, type: 'add_note', details: 'x' }
			]
		};
		expectForbidden(run(note, prev, ctx(MANAGER)), /cannot be modified/);
	});

	it('no one but CouchDB _admin may delete a record', () => {
		const prev = created();
		const tombstone: Doc = { _id: prev._id, _rev: prev._rev, _deleted: true };
		const del = (user: UserCtx) => () => validate(tombstone, asDoc(prev), user);
		expectForbidden(del(ctx(OWNER)), /Cannot delete shelter_incident/);
		expectForbidden(del(ctx(MANAGER)), /Cannot delete shelter_incident/);
		expectForbidden(del({ name: 'sa', roles: ['system_admin'] }), /Cannot delete shelter_incident/);
	});
});
