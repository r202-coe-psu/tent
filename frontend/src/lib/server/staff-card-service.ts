import {
	adminRaw,
	ServiceError,
	serviceErrorFromCouch,
	type Caller
} from '$lib/server/couch-admin';
import {
	canDistributeInShelter,
	hasShelterScope,
	isSystemAdmin,
	managerShelterCodes,
	shelterCodesFromRoles
} from '$lib/auth/roles';
import { ensureRoleCardToken } from '$lib/features/volunteers/server/public-schedule-action';
import { shelterDbName } from '$lib/server/shelter-access-design';
import { mintStaffTokenHash } from '$lib/server/staff-card-token';
import type { CouchUserDoc } from '$lib/server/user-service';
import {
	isValidStaffTokenHash,
	parseStaffCardPayload,
	staffCardPayloadFromHash,
	staffCardRoleLabel,
	staffRecipientId
} from '$lib/features/users/server';

const VOLUNTEER_LINK_BROKEN = 'บัญชีเจ้าหน้าที่นี้ไม่ตรงกับโปรไฟล์อาสา กรุณาติดต่อผู้ดูแล';
// One message for "no such hash" and "not staff of this shelter" so a scan cannot tell them apart.
const STAFF_CARD_NOT_FOUND = 'ไม่พบบัตรเจ้าหน้าที่นี้';

export type ResolvedCardRecipient =
	| {
			kind: 'staff';
			recipient_id: string;
			display_name: string;
			role_label: string;
			position: string | null;
	  }
	| { kind: 'volunteer'; recipient_id: string; display_name: string; role_label: string };

// Only the fields a scan needs, so other accounts' password hashes never reach this process.
const STAFF_CARD_LOOKUP_FIELDS = [
	'name',
	'roles',
	'active',
	'volunteer_id',
	'personnel_type',
	'display_name',
	'position',
	'staff_token_hash'
];

async function findUsersByStaffTokenHash(hash: string): Promise<CouchUserDoc[]> {
	// limit 2 is enough to tell "exactly one" from "duplicate".
	const res = await adminRaw('/_users/_find', 'POST', {
		selector: { staff_token_hash: hash },
		fields: STAFF_CARD_LOOKUP_FIELDS,
		limit: 2
	});
	if (res.status >= 400) throw serviceErrorFromCouch('find staff card', res.status, res.data);
	return (res.data as { docs: CouchUserDoc[] }).docs;
}

export async function resolveStaffCard(
	caller: Caller,
	payload: string,
	shelterCode: string
): Promise<ResolvedCardRecipient> {
	if (!canDistributeInShelter(caller.roles, shelterCode)) {
		throw new ServiceError('FORBIDDEN', 'ไม่มีสิทธิ์แจกของในศูนย์นี้');
	}
	const parsed = parseStaffCardPayload(payload);
	if (!parsed) throw new ServiceError('VALIDATION', 'QR ไม่ใช่บัตรเจ้าหน้าที่');
	const matches = await findUsersByStaffTokenHash(parsed.hash);
	if (matches.length === 0) throw new ServiceError('NOT_FOUND', STAFF_CARD_NOT_FOUND);
	if (matches.length > 1) {
		console.warn(`[staff-card] hash shared by ${matches.length} users; rejecting scan`);
		throw new ServiceError('CONFLICT', 'บัตรนี้ซ้ำกับผู้ใช้อื่น กรุณาติดต่อผู้ดูแล');
	}
	const [target] = matches;
	if (target.active === false) throw new ServiceError('FORBIDDEN', 'บัญชีถูกปิดใช้งาน');
	if (!isSystemAdmin(target.roles) && !hasShelterScope(target.roles, shelterCode)) {
		throw new ServiceError('NOT_FOUND', STAFF_CARD_NOT_FOUND);
	}
	const role_label = staffCardRoleLabel(target.roles, shelterCode);
	if (target.volunteer_id) {
		const res = await adminRaw(
			`/${shelterDbName(shelterCode)}/${encodeURIComponent(target.volunteer_id)}`,
			'GET'
		);
		if (res.status === 404) throw new ServiceError('CONFLICT', VOLUNTEER_LINK_BROKEN);
		if (res.status >= 400) throw serviceErrorFromCouch('read volunteer', res.status, res.data);
		const volunteer = res.data as {
			user_name?: string | null;
			first_name: string;
			last_name: string;
		};
		if (volunteer.user_name !== target.name)
			throw new ServiceError('CONFLICT', VOLUNTEER_LINK_BROKEN);
		return {
			kind: 'volunteer',
			recipient_id: target.volunteer_id,
			display_name: `${volunteer.first_name} ${volunteer.last_name}`.trim(),
			role_label
		};
	}
	// A hash minted before FR-SQR-03 skipped unlinked volunteers must not log as staff.
	if (target.personnel_type === 'volunteer') {
		throw new ServiceError('CONFLICT', VOLUNTEER_LINK_BROKEN);
	}
	return {
		kind: 'staff',
		recipient_id: staffRecipientId(target.name),
		display_name: target.display_name || target.name,
		role_label,
		position: target.position ?? null
	};
}

export type MyCard =
	| {
			kind: 'staff';
			payload: string;
			display_name: string;
			position: string | null;
			roles: string[];
	  }
	| {
			kind: 'volunteer';
			payload: string;
			display_name: string;
			volunteer_code: string | null;
			roles: string[];
	  }
	| { kind: 'none'; reason: 'no_token' | 'volunteer_unlinked' | 'inactive' | 'server_admin' };

type LinkedVolunteer = {
	_id: string;
	_rev?: string;
	user_name?: string | null;
	volunteer_code?: string | null;
	[key: string]: unknown;
};

type LinkedVolunteerRef = { dbName: string; volunteer: LinkedVolunteer };

async function findLinkedVolunteer(user: CouchUserDoc): Promise<LinkedVolunteerRef | null> {
	for (const code of shelterCodesFromRoles(user.roles)) {
		const res = await adminRaw(
			`/${shelterDbName(code)}/${encodeURIComponent(user.volunteer_id as string)}`,
			'GET'
		);
		if (res.status === 404) continue;
		if (res.status >= 400) throw serviceErrorFromCouch('read volunteer', res.status, res.data);
		const volunteer = res.data as LinkedVolunteer;
		return volunteer.user_name === user.name ? { dbName: shelterDbName(code), volunteer } : null;
	}
	return null;
}

export async function getMyCard(
	name: string,
	sessionRoles: readonly string[] = []
): Promise<MyCard> {
	const res = await adminRaw(`/_users/org.couchdb.user:${encodeURIComponent(name)}`, 'GET');
	if (res.status === 404) {
		// A CouchDB server admin is defined in the node config, not in `_users`, so it has no card.
		if (sessionRoles.includes('_admin')) return { kind: 'none', reason: 'server_admin' };
		throw new ServiceError('UNAUTHENTICATED', 'Authentication required');
	}
	if (res.status >= 400) throw serviceErrorFromCouch('read user', res.status, res.data);
	const user = res.data as CouchUserDoc;
	if (user.active === false) return { kind: 'none', reason: 'inactive' };
	if (!user.volunteer_id && user.personnel_type === 'volunteer') {
		return { kind: 'none', reason: 'volunteer_unlinked' };
	}
	if (user.volunteer_id) {
		const linked = await findLinkedVolunteer(user);
		if (!linked) return { kind: 'none', reason: 'volunteer_unlinked' };
		const { token } = await ensureRoleCardToken(linked.dbName, linked.volunteer);
		return {
			kind: 'volunteer',
			payload: token,
			display_name: user.display_name || user.name,
			volunteer_code: linked.volunteer.volunteer_code ?? null,
			roles: user.roles
		};
	}
	if (!isValidStaffTokenHash(user.staff_token_hash)) return { kind: 'none', reason: 'no_token' };
	return {
		kind: 'staff',
		payload: staffCardPayloadFromHash(user.staff_token_hash),
		display_name: user.display_name || user.name,
		position: user.position ?? null,
		roles: user.roles
	};
}

export type StaffCardForPrint = {
	name: string;
	display_name: string;
	position: string | null;
	roles: string[];
	payload: string;
};

function userPath(name: string): string {
	return `/_users/org.couchdb.user:${encodeURIComponent(name)}`;
}

function printable(doc: CouchUserDoc, hash: string): StaffCardForPrint {
	return {
		name: doc.name,
		display_name: doc.display_name || doc.name,
		position: doc.position ?? null,
		roles: doc.roles,
		payload: staffCardPayloadFromHash(hash)
	};
}

async function readTarget(name: string): Promise<CouchUserDoc> {
	const res = await adminRaw(userPath(name), 'GET');
	if (res.status === 404) throw new ServiceError('NOT_FOUND', 'ไม่พบผู้ใช้');
	if (res.status >= 400) throw serviceErrorFromCouch('read user', res.status, res.data);
	return res.data as CouchUserDoc;
}

function isPrivilegedTarget(doc: CouchUserDoc): boolean {
	return isSystemAdmin(doc.roles) || managerShelterCodes(doc.roles).length > 0;
}

async function readStaffTarget(name: string): Promise<CouchUserDoc> {
	const doc = await readTarget(name);
	if (doc.volunteer_id || doc.personnel_type === 'volunteer') {
		throw new ServiceError('CONFLICT', 'ผู้ใช้นี้ใช้บัตรจิตอาสา');
	}
	return doc;
}

export async function rotateStaffCard(caller: Caller, name: string): Promise<StaffCardForPrint> {
	const doc = await readStaffTarget(name);
	if (!caller.isSA) {
		const managed = managerShelterCodes(caller.roles);
		const targetCodes = shelterCodesFromRoles(doc.roles);
		const coversEveryShelter =
			targetCodes.length > 0 && targetCodes.every((code) => managed.includes(code));
		if (!coversEveryShelter || isPrivilegedTarget(doc)) {
			throw new ServiceError('FORBIDDEN', 'ไม่มีสิทธิ์หมุน QR ของผู้ใช้นี้');
		}
	}
	const newHash = await mintStaffTokenHash();
	const put = await adminRaw(userPath(name), 'PUT', { ...doc, staff_token_hash: newHash });
	if (put.status === 409) {
		throw new ServiceError('CONFLICT', 'ข้อมูลผู้ใช้เพิ่งถูกแก้ไข กรุณาลองหมุน QR อีกครั้ง');
	}
	if (put.status >= 400) throw serviceErrorFromCouch('rotate staff card', put.status, put.data);
	return printable(doc, newHash);
}

export async function getStaffCardForAdmin(
	caller: Caller,
	name: string
): Promise<StaffCardForPrint> {
	const doc = await readStaffTarget(name);
	if (!caller.isSA) {
		const managed = managerShelterCodes(caller.roles);
		const inManagedShelter = shelterCodesFromRoles(doc.roles).some((code) =>
			managed.includes(code)
		);
		if (!inManagedShelter || isPrivilegedTarget(doc)) {
			throw new ServiceError('FORBIDDEN', 'ไม่มีสิทธิ์ดูบัตรของผู้ใช้นี้');
		}
	}
	if (!isValidStaffTokenHash(doc.staff_token_hash)) {
		throw new ServiceError('NOT_FOUND', 'ยังไม่มี QR กรุณาหมุน QR เพื่อออกบัตร');
	}
	return printable(doc, doc.staff_token_hash);
}
