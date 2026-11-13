/**
 * One other shelter's in-person results for the same person (CR-228 FR-4), as
 * `GET /api/v1/volunteer-access/cross-shelter-verifications` answers. Nothing else crosses
 * shelters: no name, phone, ID or hash, no profile `_id`, no reviewer, notes, credential
 * reference or `accepted_from` of the other shelter (FR-6).
 */
export type CrossShelterMatch = {
	shelter_code: string;
	shelter_name: string;
	/** The shelter verified the identity in person; `reviewed_at` is null when it kept no date. */
	identity: { reviewed_at: string | null } | null;
	/** Controlled skills it certified in person that this profile still waits on (FR-5). */
	skills: { code: string; reviewed_at: string | null }[];
};

/** The shelter as staff read it: its name, with the code when the name does not already say it. */
export function crossShelterLabel(match: Pick<CrossShelterMatch, 'shelter_code' | 'shelter_name'>) {
	return match.shelter_name && match.shelter_name !== match.shelter_code
		? `${match.shelter_name} (${match.shelter_code})`
		: match.shelter_code;
}
