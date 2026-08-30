import { z } from 'zod';
import { shelterCodeSchema } from '$lib/db/model';
import { SA_GRANTABLE_CAPABILITIES, SYSTEM_ADMIN } from '$lib/auth/roles';
import { passwordSchema } from '$lib/auth/password-schema';
import { personnelTypeSchema, type PersonnelType } from '$lib/features/volunteers';

/** Capability the new user is granted (SA may pick any including system_admin; SM only staff). */
export const capabilitySchema = z.enum(SA_GRANTABLE_CAPABILITIES);
export type Capability = z.infer<typeof capabilitySchema>;

/**
 * Sentinel `shelter_id` for an account that is not bound to one shelter — the central EOC /
 * platform-wide option in the affiliation picker. It is a *form* value only: `rolesFromInput`
 * turns it into the roles array without a `shelter:` scope, and it never reaches CouchDB.
 */
export const PLATFORM_WIDE = '__all__';

/**
 * Whether the account belongs to permanent staff or to a volunteer. Reused from the volunteers
 * slice (CR-095 defines it on the `volunteer` doc) rather than redeclared here, so the roster
 * toggle and this form can never drift apart — CR-096 §2.4.
 *
 * On `_users` it is metadata: it decides the `affiliation_tags` written on the login, never the
 * permissions — those come from the capability alone (R-AFFIL-5).
 */
export { personnelTypeSchema, type PersonnelType };

/** The `affiliation_tags` value that marks an account as a volunteer. */
export const VOLUNTEER_TAG = 'volunteer';

/**
 * Fields shared by create and edit. `shelter_id` is supplied by an SA; for a shelter_manager it
 * is implicit (their own shelter) and the server derives it. `system_admin` does not take a
 * shelter — the form sends {@link PLATFORM_WIDE} instead.
 *
 * `duty_start` / `duty_end` are `datetime-local` strings (`YYYY-MM-DDTHH:mm`); leaving both
 * blank means permanent access. Persistence happens as ISO-8601 in `_users.duty_window`
 * (CR-094 §2.3) — it is recorded, not yet enforced.
 */
const userFormFields = {
	username: z.string().min(3, 'Username ต้องมีอย่างน้อย 3 ตัวอักษร'),
	display_name: z.string().min(1, 'ชื่อที่แสดงต้องไม่ว่าง'),
	// Defaulted so a caller that predates CR-096 (or an API client) still parses; the form always
	// sends both explicitly.
	personnel_type: personnelTypeSchema.default('staff'),
	capability: capabilitySchema,
	shelter_id: shelterCodeSchema.or(z.literal(PLATFORM_WIDE)).optional(),
	volunteer_id: z.string().optional(),
	duty_start: z.string().optional(),
	duty_end: z.string().optional(),
	active: z.boolean().default(true)
};

/**
 * Cross-field rules that hold for both create and edit:
 * duty window is both-or-neither and must run forwards; platform-wide is system_admin only,
 * because every other capability is evaluated against a shelter scope.
 */
function refineUserForm(
	data: {
		capability: Capability;
		shelter_id?: string;
		duty_start?: string;
		duty_end?: string;
	},
	ctx: z.RefinementCtx
): void {
	const { duty_start, duty_end } = data;
	if (duty_start && !duty_end) {
		ctx.addIssue({ code: 'custom', path: ['duty_end'], message: 'กรุณาระบุเวลาสิ้นสุด' });
	}
	if (duty_end && !duty_start) {
		ctx.addIssue({ code: 'custom', path: ['duty_start'], message: 'กรุณาระบุเวลาเริ่มต้น' });
	}
	if (duty_start && duty_end && Date.parse(duty_start) >= Date.parse(duty_end)) {
		ctx.addIssue({
			code: 'custom',
			path: ['duty_end'],
			message: 'เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่มต้น'
		});
	}
	if (data.shelter_id === PLATFORM_WIDE && data.capability !== SYSTEM_ADMIN) {
		ctx.addIssue({
			code: 'custom',
			path: ['shelter_id'],
			message: 'บทบาทนี้ต้องสังกัดศูนย์ — "ทุกศูนย์" ใช้ได้เฉพาะผู้ดูแลระบบสูงสุด'
		});
	}
}

export const createUserSchema = z
	.object({ ...userFormFields, password: passwordSchema })
	.superRefine(refineUserForm);

export type CreateUserInput = z.infer<typeof createUserSchema>;

export const editUserSchema = z
	.object({
		...userFormFields,
		username: z.string(),
		display_name: z.string().min(1, 'Display name is required'),
		password: passwordSchema.or(z.literal(''))
	})
	.superRefine(refineUserForm);

export type EditUserInput = z.infer<typeof editUserSchema>;

/**
 * What the shared user form emits. Create and edit produce the same shape — the schemas differ
 * only in strictness (edit accepts an empty password, meaning "keep the current one").
 */
export type UserFormInput = CreateUserInput & EditUserInput;

/** A saved duty window, ISO-8601 in UTC (`_users.duty_window`, CR-094 §2.3). */
export interface DutyWindow {
	start_ts: string;
	end_ts: string;
}

/**
 * Turn the two `datetime-local` inputs into the stored window. Returns `null` when the account
 * has permanent access (both blank) — the caller writes `null` so an existing window is cleared.
 */
export function toDutyWindow(
	duty_start: string | undefined,
	duty_end: string | undefined
): DutyWindow | null {
	if (!duty_start || !duty_end) return null;
	return {
		start_ts: new Date(duty_start).toISOString(),
		end_ts: new Date(duty_end).toISOString()
	};
}

/** Inverse of {@link toDutyWindow} — an ISO instant as the `datetime-local` value it came from. */
export function toDateTimeLocal(iso: string | null | undefined): string {
	if (!iso) return '';
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '';
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * `affiliation_tags` for a personnel type. Volunteer accounts carry the `volunteer` tag and
 * staff accounts do not — never inferred from the RoleKey (R-AFFIL-1/2). Tags the operator did
 * not set through this form (e.g. `governance`) are preserved by the caller.
 */
export function affiliationTagsFor(
	personnel_type: PersonnelType,
	existing: readonly string[] = []
): string[] {
	const rest = existing.filter((t) => t !== VOLUNTEER_TAG);
	return personnel_type === 'volunteer' ? [...rest, VOLUNTEER_TAG] : rest;
}

/** True when the stored tags mark this account as a volunteer (R-AFFIL-3). */
export function isVolunteerAccount(tags: readonly string[] | undefined): boolean {
	return (tags ?? []).includes(VOLUNTEER_TAG);
}
