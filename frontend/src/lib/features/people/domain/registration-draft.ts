/**
 * Draft of a public pre-registration form (#358). A phone camera opened from the photo field can
 * push the browser tab out of memory; when the page comes back the form would be empty. The draft
 * lets it come back filled. Pure: storage lives in `data/registration-draft.storage.ts`.
 *
 * Photos are left out — a photo id or URL without its local preview is not something to restore,
 * and the person attaches it again.
 */
import {
	blankUnifiedMember,
	type UnifiedMemberWithMeta,
	type UnifiedRegistrationInput
} from './unified-registration';

type DraftHousehold = UnifiedRegistrationInput['household'];

export const PUBLIC_PRE_REGISTER_DRAFT_KEY = 'public-pre-register';

export const DEFAULT_DRAFT_HOUSEHOLD: DraftHousehold = {
	housing_type: 'owned_house',
	residence_landmark: null,
	dorm_name: null,
	dorm_building: null,
	dorm_floor: null,
	dorm_room: null,
	address_no: '',
	village_no: '',
	subdistrict: '',
	district: '',
	province: '',
	postal_code: '',
	pets: [],
	vehicles: [],
	assets: null
};

export type RestoredRegistrationDraft = {
	household: DraftHousehold;
	members: UnifiedMemberWithMeta[];
};

export type RegistrationDraft = {
	v: 1;
	saved_at: number;
	household: DraftHousehold;
	members: UnifiedMemberWithMeta[];
};

/** A draft older than this is dropped: the person has long moved on. */
export const REGISTRATION_DRAFT_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export function toRegistrationDraft(
	household: DraftHousehold,
	members: readonly UnifiedMemberWithMeta[],
	now: number
): RegistrationDraft {
	return {
		v: 1,
		saved_at: now,
		household: {
			...household,
			pets: (household.pets ?? []).map((pet) => ({ ...pet, image_url: null })),
			assets: household.assets ? { ...household.assets, image_url: null } : null
		},
		members: members.map(stripSensitiveFields)
	};
}

/**
 * Owner decision (#358, B3): a draft never keeps the ID number, medical data, vulnerability tags or
 * the emergency contact — they stay out of sessionStorage and must be re-entered after a reload.
 */
function stripSensitiveFields(member: UnifiedMemberWithMeta): UnifiedMemberWithMeta {
	const blank = blankUnifiedMember();
	return {
		...member,
		photo: null,
		person_id: { cardType: member.person_id?.cardType ?? 'national_id', number: '' },
		vulnerable_groups: blank.vulnerable_groups,
		special_needs: blank.special_needs,
		disability_other_detail: blank.disability_other_detail,
		medical_conditions: blank.medical_conditions,
		medical_allergies: blank.medical_allergies,
		medical_medications: blank.medical_medications,
		emergency_contact: blank.emergency_contact
	};
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The form state a stored draft restores, or null when it is not a draft of this version, is too
 * old, or has no member. Each member is laid over a blank one, so a field added to the form later
 * still starts defined.
 */
export function fromRegistrationDraft(raw: unknown, now: number): RestoredRegistrationDraft | null {
	if (!isRecord(raw) || raw.v !== 1 || typeof raw.saved_at !== 'number') return null;
	if (now - raw.saved_at > REGISTRATION_DRAFT_MAX_AGE_MS || raw.saved_at > now) return null;
	if (!isRecord(raw.household) || !Array.isArray(raw.members) || raw.members.length === 0) {
		return null;
	}
	if (!raw.members.every(isRecord)) return null;

	const rawHousehold = raw.household as Record<string, unknown>;
	const restoredAssets = isRecord(rawHousehold.assets)
		? {
				description:
					typeof rawHousehold.assets.description === 'string'
						? rawHousehold.assets.description
						: '',
				image_url: null
			}
		: null;

	return {
		household: {
			...DEFAULT_DRAFT_HOUSEHOLD,
			...rawHousehold,
			pets: Array.isArray(rawHousehold.pets) ? (rawHousehold.pets as DraftHousehold['pets']) : [],
			vehicles: Array.isArray(rawHousehold.vehicles)
				? (rawHousehold.vehicles as DraftHousehold['vehicles'])
				: [],
			assets: restoredAssets
		},
		members: (raw.members as Record<string, unknown>[]).map((member) => ({
			...blankUnifiedMember(),
			...(member as Partial<UnifiedMemberWithMeta>),
			photo: null
		}))
	};
}

/**
 * Returns true only when a form has actual user-entered data rather than blank defaults.
 * Used to avoid saving empty drafts and avoid showing restore toasts on blank forms.
 */
export function hasRegistrationDraftContent(draft: {
	household?: Partial<DraftHousehold> | null;
	members?: readonly Partial<UnifiedMemberWithMeta>[] | null;
}): boolean {
	if (!draft) return false;
	const h = draft.household;
	const hasHousehold =
		(h?.pets?.length ?? 0) > 0 ||
		Boolean(h?.vehicles?.length) ||
		Boolean(h?.address_no?.trim()) ||
		Boolean(h?.subdistrict?.trim()) ||
		Boolean(h?.district?.trim()) ||
		Boolean(h?.province?.trim()) ||
		Boolean(h?.residence_landmark?.trim()) ||
		Boolean(h?.dorm_name?.trim()) ||
		Boolean(h?.assets?.description?.trim());

	const hasMember = (draft.members ?? []).some(
		(m) =>
			Boolean(m.first_name?.trim()) ||
			Boolean(m.last_name?.trim()) ||
			Boolean(m.phone?.trim()) ||
			Boolean(m.person_id?.number?.trim())
	);

	return hasHousehold || hasMember;
}
