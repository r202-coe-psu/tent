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
	shelterCodesFromRoles
} from '$lib/auth/roles';
import { ensureRoleCardToken } from '$lib/features/volunteers/server/public-schedule-action';
import { shelterDbName } from '$lib/server/shelter-access-design';
import { fetchAllUserDocs, type CouchUserDoc } from '$lib/server/user-service';
import {
	isValidStaffTokenHash,
	parseStaffCardPayload,
	staffCardPayloadFromHash,
	staffRecipientId
} from '$lib/features/users/server';

const VOLUNTEER_LINK_BROKEN = 'บัญชีเจ้าหน้าที่นี้ไม่ตรงกับโปรไฟล์อาสา กรุณาติดต่อผู้ดูแล';

export type ResolvedCardRecipient =
	| { kind: 'staff'; recipient_id: string; display_name: string; position: string | null }
	| { kind: 'volunteer'; recipient_id: string; display_name: string };

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
	const users = await fetchAllUserDocs();
	const matches = users.filter((u) => u.staff_token_hash === parsed.hash);
	if (matches.length === 0) throw new ServiceError('NOT_FOUND', 'ไม่พบบัตรเจ้าหน้าที่นี้');
	if (matches.length > 1) {
		console.warn(`[staff-card] hash shared by ${matches.length} users; rejecting scan`);
		throw new ServiceError('CONFLICT', 'บัตรนี้ซ้ำกับผู้ใช้อื่น กรุณาติดต่อผู้ดูแล');
	}
	const [target] = matches;
	if (target.active === false) throw new ServiceError('FORBIDDEN', 'บัญชีถูกปิดใช้งาน');
	if (!isSystemAdmin(target.roles) && !hasShelterScope(target.roles, shelterCode)) {
		throw new ServiceError('FORBIDDEN', 'ไม่ใช่เจ้าหน้าที่ของศูนย์นี้');
	}
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
			display_name: `${volunteer.first_name} ${volunteer.last_name}`.trim()
		};
	}
	return {
		kind: 'staff',
		recipient_id: staffRecipientId(target.name),
		display_name: target.display_name || target.name,
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
	| { kind: 'none'; reason: 'no_token' | 'volunteer_unlinked' | 'inactive' };

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

export async function getMyCard(name: string): Promise<MyCard> {
	const res = await adminRaw(`/_users/org.couchdb.user:${encodeURIComponent(name)}`, 'GET');
	if (res.status === 404) throw new ServiceError('UNAUTHENTICATED', 'Authentication required');
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
