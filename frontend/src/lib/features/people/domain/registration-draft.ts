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
			pets: (household.pets ?? []).map((pet) => ({ ...pet, image_url: null }))
		},
		members: members.map((member) => ({ ...member, photo: null }))
	};
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The form state a stored draft restores, or null when it is not a draft of this version, is too
 * old, or has no member. Each member is laid over a blank one, so a field added to the form later
 * still starts defined.
 */
export function fromRegistrationDraft(
	raw: unknown,
	now: number
): { household: DraftHousehold; members: UnifiedMemberWithMeta[] } | null {
	if (!isRecord(raw) || raw.v !== 1 || typeof raw.saved_at !== 'number') return null;
	if (now - raw.saved_at > REGISTRATION_DRAFT_MAX_AGE_MS || raw.saved_at > now) return null;
	if (!isRecord(raw.household) || !Array.isArray(raw.members) || raw.members.length === 0) {
		return null;
	}
	if (!raw.members.every(isRecord)) return null;
	return {
		household: raw.household as DraftHousehold,
		members: (raw.members as Record<string, unknown>[]).map((member) => ({
			...blankUnifiedMember(),
			...(member as Partial<UnifiedMemberWithMeta>),
			photo: null
		}))
	};
}
