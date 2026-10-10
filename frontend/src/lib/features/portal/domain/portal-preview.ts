/**
 * System-admin role preview for the portal home (`/portal`). Pure: no I/O, no Svelte.
 *
 * A dev/verification aid: a system admin picks a role and a medical-screening override and the
 * portal menu is computed for those roles instead of the real ones. It is UI-only: it never touches
 * `authStore`, cookies, sessions, guards or persisted state, and it does not change what the
 * links allow (they still open with the real admin rights).
 */
import { isSystemAdmin, SYSTEM_ADMIN } from '$lib/auth/roles';
import type { PortalFeatures } from './portal-menu';

export type PortalPreviewRole =
	| typeof SYSTEM_ADMIN
	| 'shelter_manager'
	| 'registration_staff'
	| 'triage_staff'
	| 'medical_staff'
	| 'kitchen_staff'
	| 'supply_coordinator'
	| 'warehouse_staff'
	| 'volunteer_coordinator'
	| 'security_officer'
	| 'facility_staff';

/** Role options in picker order. The first option is the admin's own view (no preview). */
export const PORTAL_PREVIEW_ROLES: readonly { value: PortalPreviewRole; label: string }[] = [
	{ value: SYSTEM_ADMIN, label: 'ตัวเอง (ผู้ดูแลระบบส่วนกลาง)' },
	{ value: 'shelter_manager', label: 'ผู้จัดการศูนย์' },
	{ value: 'registration_staff', label: 'ทะเบียน' },
	{ value: 'triage_staff', label: 'คัดกรอง' },
	{ value: 'medical_staff', label: 'การแพทย์' },
	{ value: 'kitchen_staff', label: 'ครัวกลาง' },
	{ value: 'supply_coordinator', label: 'พัสดุและคลัง' },
	{ value: 'warehouse_staff', label: 'คลังสินค้า' },
	{ value: 'volunteer_coordinator', label: 'ประสานงานอาสา' },
	{ value: 'security_officer', label: 'รักษาความปลอดภัย' },
	{ value: 'facility_staff', label: 'อาคารสถานที่' }
];

/** `ตามศูนย์` = the selected shelter's real flag; `เปิด` / `ปิด` force it. */
export type PortalMedicalPreview = 'real' | 'on' | 'off';

export interface PortalPreviewState {
	role: PortalPreviewRole;
	medicalScreening: PortalMedicalPreview;
}

export interface PortalPreviewResult {
	/** Roles the portal menu should be computed with. */
	roles: string[];
	/** Feature flags the portal menu should be computed with. */
	features: PortalFeatures;
	/** True while a preview differs from the admin's own view. */
	active: boolean;
}

/** The admin's own view: no role preview, shelter flag as stored. */
export function createPortalPreviewState(): PortalPreviewState {
	return { role: SYSTEM_ADMIN, medicalScreening: 'real' };
}

/** Preview is offered only to a system admin with a shelter selected. */
export function isPortalPreviewAvailable(
	realRoles: readonly string[],
	shelterCode: string | null | undefined
): boolean {
	return isSystemAdmin(realRoles) && Boolean(shelterCode);
}

/** True when the preview state differs from the admin's own view. */
export function isPortalPreviewActive(state: PortalPreviewState): boolean {
	return state.role !== SYSTEM_ADMIN || state.medicalScreening !== 'real';
}

/**
 * Roles to compute the portal with for a previewed role.
 *  - `system_admin` → `['system_admin']`.
 *  - any other role → `['shelter:<code>', '<code>:<capability>']` in the selected shelter.
 *  - no shelter selected → the real roles (the preview control is disabled in that case).
 */
export function buildPreviewRoles(
	previewRole: PortalPreviewRole,
	shelterCode: string | null | undefined,
	realRoles: readonly string[]
): string[] {
	if (!shelterCode) return [...realRoles];
	if (previewRole === SYSTEM_ADMIN) return [SYSTEM_ADMIN];
	return [`shelter:${shelterCode}`, `${shelterCode}:${previewRole}`];
}

/** Apply the medical-screening override; `real` keeps the shelter's value (incl. `null` = loading). */
export function applyPreviewFeatures(
	features: PortalFeatures,
	medicalScreening: PortalMedicalPreview
): PortalFeatures {
	if (medicalScreening === 'real') return features;
	return { ...features, medicalScreening: medicalScreening === 'on' };
}

/**
 * Roles and features the portal menu should use. Without an available preview (not a system
 * admin, or no shelter selected) the real roles and features come back unchanged.
 */
export function resolvePortalPreview(input: {
	realRoles: readonly string[];
	shelterCode: string | null | undefined;
	features: PortalFeatures;
	preview: PortalPreviewState;
}): PortalPreviewResult {
	const { realRoles, shelterCode, features, preview } = input;
	if (!isPortalPreviewAvailable(realRoles, shelterCode) || !isPortalPreviewActive(preview)) {
		return { roles: [...realRoles], features, active: false };
	}
	const roles =
		preview.role === SYSTEM_ADMIN
			? [...realRoles]
			: buildPreviewRoles(preview.role, shelterCode, realRoles);
	return {
		roles,
		features: applyPreviewFeatures(features, preview.medicalScreening),
		active: true
	};
}

/** Thai label for a preview role (picker and banner copy). */
export function portalPreviewRoleLabel(role: PortalPreviewRole): string {
	return PORTAL_PREVIEW_ROLES.find((option) => option.value === role)?.label ?? role;
}
