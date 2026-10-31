import { z } from 'zod';
import { serviceFetch } from '$lib/api/service';
import { passwordSchema } from '$lib/auth/password-schema';
import { grantExpiryError } from '$lib/auth/role-grants';
import {
	COORDINATOR_GRANTABLE_CAPABILITIES,
	STAFF_CAPABILITIES,
	compoundCapabilityRole,
	rolesFromAssignments,
	shelterScopeRole
} from '$lib/auth/roles';
import { normalizeThaiPhone } from '$lib/db/model';
import { createUser, listUsers } from '$lib/features/users';
import { volunteerRepositoryFor } from '../data/volunteer.remote';
import type { VolunteerRepository } from '../data/volunteer.repository';
import { isVolunteerMobile } from '../domain/phone';
import type { Volunteer } from '../domain/volunteer.schema';

/** No role is picked for the grant by default (#1072); saving without one says this. */
export const ROLE_REQUIRED_MESSAGE = 'กรุณาเลือกตำแหน่งหน้าที่';

export const volunteerAccessSchema = z.object({
	email: z.string().trim().toLowerCase().email('กรุณากรอกอีเมลให้ถูกต้อง'),
	password: z.string().trim().min(1, 'กรุณากำหนดรหัสผ่าน'),
	role: z.enum(STAFF_CAPABILITIES, { message: ROLE_REQUIRED_MESSAGE })
});

/** Thrown/shown when the profile phone is filled but not a 10-digit mobile (CR-210, #951). */
export const VOLUNTEER_ACCESS_PHONE_MESSAGE =
	'เบอร์โทรศัพท์ในโปรไฟล์ไม่ใช่มือถือ 10 หลัก กรุณาแก้เบอร์ในโปรไฟล์ก่อนออกสิทธิ์';

/** True when a filled phone is not a mobile and so blocks granting access. */
export function hasInvalidAccessPhone(value: string | null | undefined): boolean {
	return !!value?.trim() && !isVolunteerMobile(value);
}

/**
 * The volunteer's mobile as the account sees it: stored as the account phone and usable as
 * the forced first-login password. `null` for a volunteer with no phone (email login only).
 */
export function accountPhone(value: string | null | undefined): string | null {
	const normalized = normalizeThaiPhone(value ?? '');
	return isVolunteerMobile(normalized) ? normalized : null;
}

/** First reason `password` fails the account policy (user form rules), else `null`. */
export function volunteerPasswordError(password: string, loginPhone: string | null): string | null {
	const value = password.trim();
	if (loginPhone !== null && value === loginPhone) return null;
	const result = passwordSchema.safeParse(value);
	return result.success ? null : (result.error.issues[0]?.message ?? 'รหัสผ่านไม่ถูกต้อง');
}

/** Create credentials first, then link the latest profile; an exact existing link is retryable. */
export async function grantVolunteerAccess(
	volunteer: Volunteer,
	input: z.infer<typeof volunteerAccessSchema>
): Promise<{ created: boolean }> {
	const { email, password, role } = volunteerAccessSchema.parse(input);
	if (hasInvalidAccessPhone(volunteer.phone)) throw new Error(VOLUNTEER_ACCESS_PHONE_MESSAGE);
	const loginPhone = accountPhone(volunteer.phone);
	const isPhoneBootstrapPassword = loginPhone !== null && password === loginPhone;
	const passwordError = volunteerPasswordError(password, loginPhone);
	if (passwordError) throw new Error(passwordError);
	const repository = volunteerRepositoryFor(volunteer.shelter_code);
	const profile = await repository.get(volunteer._id);
	if (!profile) throw new Error('ไม่พบข้อมูลอาสาสมัคร กรุณาโหลดข้อมูลใหม่');
	if (hasInvalidAccessPhone(profile.phone)) throw new Error(VOLUNTEER_ACCESS_PHONE_MESSAGE);
	const scope = shelterScopeRole(volunteer.shelter_code);
	const users = await listUsers();
	const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
	// A legacy mixed-case account is found by any casing; its stored name is what we link.
	const existing =
		users.find((user) => user.name === email) ?? users.find((user) => sameName(user.name, email));
	const accountName = existing?.name ?? email;
	const otherLinkedAccount = users.find(
		(user) =>
			user.volunteer_id === volunteer._id &&
			user.roles.includes(scope) &&
			!sameName(user.name, email)
	);
	if (otherLinkedAccount) {
		throw new Error(
			`อาสาสมัครนี้มีบัญชี ${otherLinkedAccount.name} แล้ว กรุณาจัดการผ่านหน้าผู้ใช้งาน`
		);
	}
	if (
		profile.user_name &&
		!sameName(profile.user_name, email) &&
		users.some((user) => user.name === profile.user_name)
	) {
		throw new Error('โปรไฟล์อาสาสมัครผูกกับบัญชีอื่นแล้ว กรุณาจัดการผ่านหน้าผู้ใช้งาน');
	}
	if (
		existing &&
		(existing.volunteer_id !== volunteer._id ||
			existing.personnel_type !== 'volunteer' ||
			existing.active === false ||
			// Scope + exactly one capability, in compound or legacy flat form (issued before CR-093).
			// Matched literally: `hasCapabilityInShelter` also passes `system_admin`.
			existing.roles.length !== 2 ||
			!existing.roles.includes(scope) ||
			!existing.roles.some(
				(r) => r === compoundCapabilityRole(volunteer.shelter_code, role) || r === role
			))
	) {
		throw new Error('อีเมลนี้มีบัญชีอยู่แล้วหรือสิทธิ์ไม่ตรงกัน กรุณาจัดการผ่านหน้าผู้ใช้งาน');
	}
	const created = !existing;
	if (created) {
		await createUser({
			name: email,
			password,
			display_name: `${profile.first_name} ${profile.last_name}`.trim(),
			roles: rolesFromAssignments([{ shelter_code: volunteer.shelter_code, capabilities: [role] }]),
			personnel_type: 'volunteer',
			organization: profile.organization ?? null,
			phone: accountPhone(profile.phone),
			email,
			volunteer_id: volunteer._id,
			must_change_password: isPhoneBootstrapPassword
		});
	}
	await linkVolunteerProfile(repository, volunteer, profile, accountName, created);
	return { created };
}

/** Point the volunteer profile at the account. Retryable: the account is already provisioned. */
async function linkVolunteerProfile(
	repository: VolunteerRepository,
	volunteer: Volunteer,
	profile: Volunteer,
	email: string,
	created: boolean
): Promise<void> {
	try {
		const latest = await repository.get(volunteer._id);
		if (!latest) throw new Error('ไม่พบข้อมูลอาสาสมัคร');
		if (latest.user_name !== profile.user_name && latest.user_name && latest.user_name !== email) {
			throw new Error('โปรไฟล์ถูกผูกกับบัญชีอื่นระหว่างบันทึก');
		}
		await repository.update({ ...latest, user_name: email, email });
	} catch (error) {
		const reason = error instanceof Error ? error.message : 'บันทึกโปรไฟล์ไม่สำเร็จ';
		throw new Error(
			`${created ? 'สร้างบัญชีแล้ว' : 'บัญชีมีอยู่แล้ว'} แต่ผูกโปรไฟล์ไม่สำเร็จ: ${reason} กรุณาลองบันทึกอีกครั้งด้วยอีเมลและบทบาทเดิม ระบบจะผูกบัญชีโดยไม่เปลี่ยนรหัสผ่าน`,
			{ cause: error }
		);
	}
}

/**
 * A `volunteer_coordinator` grants limited, time-boxed access (#955). The BFF enforces every
 * rule (own shelter, the coordinator roles, verified identity incl. other shelters, 7-day expiry) and
 * creates or extends the account; this then links the profile like {@link grantVolunteerAccess}.
 */
export const coordinatorAccessSchema = z.object({
	email: volunteerAccessSchema.shape.email,
	password: volunteerAccessSchema.shape.password,
	role: z.enum(COORDINATOR_GRANTABLE_CAPABILITIES, { message: ROLE_REQUIRED_MESSAGE }),
	/** `YYYY-MM-DD` (Asia/Bangkok), required, no default. */
	expires_on: z.string().min(1, 'กรุณาเลือกวันหมดอายุ')
});

export async function grantVolunteerAccessAsCoordinator(
	volunteer: Volunteer,
	input: z.infer<typeof coordinatorAccessSchema>
): Promise<{ created: boolean; unchanged: boolean }> {
	const { email, password, role, expires_on } = coordinatorAccessSchema.parse(input);
	const expiryError = grantExpiryError(expires_on);
	if (expiryError) throw new Error(expiryError);
	if (hasInvalidAccessPhone(volunteer.phone)) throw new Error(VOLUNTEER_ACCESS_PHONE_MESSAGE);
	const passwordError = volunteerPasswordError(password, accountPhone(volunteer.phone));
	if (passwordError) throw new Error(passwordError);
	const repository = volunteerRepositoryFor(volunteer.shelter_code);
	const profile = await repository.get(volunteer._id);
	if (!profile) throw new Error('ไม่พบข้อมูลอาสาสมัคร กรุณาโหลดข้อมูลใหม่');
	if (hasInvalidAccessPhone(profile.phone)) throw new Error(VOLUNTEER_ACCESS_PHONE_MESSAGE);
	const result = await serviceFetch<{
		ok: true;
		created: boolean;
		unchanged: boolean;
		name?: string;
	}>('/api/v1/volunteer-access', {
		method: 'POST',
		body: JSON.stringify({
			shelter_code: volunteer.shelter_code,
			volunteer_id: volunteer._id,
			email,
			password,
			role,
			expires_on
		})
	});
	await linkVolunteerProfile(repository, volunteer, profile, result.name ?? email, result.created);
	return { created: result.created, unchanged: result.unchanged };
}

/** A grant on the volunteer's account; `mine` ones are those the caller may revoke (FR-8). */
export type VolunteerGrant = { role: string; expires_at: string; mine: boolean };

/**
 * The role to preselect when the account already holds grants here (#1044): the one that runs
 * longest, i.e. the latest grant, if the caller may still give it. Empty when there is none, so
 * a first grant starts with nothing picked (#1072).
 */
export function currentGrantRole<R extends string>(
	grants: readonly Pick<VolunteerGrant, 'role' | 'expires_at'>[],
	choices: readonly R[]
): R | '' {
	const latest = [...grants]
		.filter((g): g is typeof g & { role: R } => (choices as readonly string[]).includes(g.role))
		.sort((a, b) => Date.parse(b.expires_at) - Date.parse(a.expires_at))[0];
	return latest?.role ?? '';
}

/** How the account's last grant here ended (from the audit), when it holds nothing here now. */
export type GrantEnding = {
	role: string;
	reason: 'expired' | 'revoked' | 'verification_revoked';
	at: string;
	by: string;
};

/** The account behind a volunteer profile as the coordinator dialog sees it (#1044). */
export type VolunteerAccessView = {
	email: string | null;
	has_account: boolean;
	grants: VolunteerGrant[];
	permanent_roles: string[];
	last_ended: GrantEnding | null;
};

/** The account the volunteer profile is linked to, as the coordinator sees it. */
export async function fetchVolunteerGrants(
	volunteer: Pick<Volunteer, '_id' | 'shelter_code'>
): Promise<VolunteerAccessView> {
	const query = new URLSearchParams({
		shelter_code: volunteer.shelter_code,
		volunteer_id: volunteer._id
	});
	const { email, has_account, grants, permanent_roles, last_ended } = await serviceFetch<
		{ ok: true } & VolunteerAccessView
	>(`/api/v1/volunteer-access?${query}`);
	return { email, has_account, grants, permanent_roles, last_ended };
}

/**
 * Where the volunteer stands, for the dialog's title, button and note (#1044): no account yet,
 * an account holding a role here, or an account whose role here has ended.
 */
export type AccessState =
	| { kind: 'none' }
	| { kind: 'active'; permanentRoles: string[] }
	| { kind: 'lapsed'; lastEnded: GrantEnding | null };

export function accessState(
	view: Pick<
		VolunteerAccessView,
		'has_account' | 'grants' | 'permanent_roles' | 'last_ended'
	> | null
): AccessState {
	if (!view?.has_account) return { kind: 'none' };
	if (view.grants.length > 0 || view.permanent_roles.length > 0) {
		return { kind: 'active', permanentRoles: view.permanent_roles };
	}
	return { kind: 'lapsed', lastEnded: view.last_ended };
}

/** Take back a grant the caller issued: the role goes, the account and password stay. */
export async function revokeVolunteerGrant(
	volunteer: Pick<Volunteer, '_id' | 'shelter_code'>,
	input: { email: string; role: string }
): Promise<void> {
	await serviceFetch<{ ok: true }>('/api/v1/volunteer-access', {
		method: 'DELETE',
		body: JSON.stringify({
			shelter_code: volunteer.shelter_code,
			volunteer_id: volunteer._id,
			email: input.email,
			role: input.role
		})
	});
}
