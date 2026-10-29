import {
	adminRaw,
	ServiceError,
	serviceErrorFromCouch,
	type Caller
} from '$lib/server/couch-admin';
import { canDistributeInShelter, hasShelterScope, isSystemAdmin } from '$lib/auth/roles';
import { shelterDbName } from '$lib/server/shelter-access-design';
import { fetchAllUserDocs } from '$lib/server/user-service';
import { parseStaffCardPayload, staffRecipientId } from '$lib/features/users/server';

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
