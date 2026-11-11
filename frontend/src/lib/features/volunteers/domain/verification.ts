import { z } from 'zod';

export const verificationStatusSchema = z.enum(['pending', 'verified', 'rejected']);
export type VerificationStatus = z.infer<typeof verificationStatusSchema>;

/**
 * Where an accepted result came from (CR-228 FR-15): the shelter that checked it in person and
 * when it did (`null` when that shelter recorded no date). Absent = checked at this shelter.
 */
export const acceptedFromSchema = z.object({
	shelter_code: z.string().min(1),
	verified_at: z.string().nullable()
});
export type AcceptedFrom = z.infer<typeof acceptedFromSchema>;

export const verificationRecordSchema = z.object({
	status: verificationStatusSchema,
	reviewed_at: z.string().nullable().optional(),
	reviewed_by: z.string().nullable().optional(),
	notes: z.string().nullable().optional(),
	/** License number, professional number, or another evidence reference. */
	credential_reference: z.string().nullable().optional(),
	/** Set only when staff accepted another shelter's result (CR-228, schema_v 5). */
	accepted_from: acceptedFromSchema.optional()
});
export type VerificationRecord = z.infer<typeof verificationRecordSchema>;

/**
 * A result checked in person at its own shelter: verified and not itself accepted from another
 * shelter. Only these are shown to other shelters, so a result never travels on (CR-228 FR-15).
 */
export function isDirectlyVerified(record: VerificationRecord | null | undefined): boolean {
	return record?.status === 'verified' && !record.accepted_from;
}

type VerificationOwner = {
	identity_verified: boolean;
	identity_verification?: VerificationRecord | null;
	skill_verifications?: Record<string, VerificationRecord>;
};

export function identityVerificationStatus(owner: VerificationOwner): VerificationStatus {
	return owner.identity_verification?.status ?? (owner.identity_verified ? 'verified' : 'pending');
}

export function skillVerificationRecord(
	owner: Pick<VerificationOwner, 'skill_verifications'>,
	skillCode: string
): VerificationRecord | null {
	const direct = owner.skill_verifications?.[skillCode];
	if (direct) return direct;

	const normalized = skillCode.trim().toLowerCase().normalize('NFC');
	const legacyKey = Object.keys(owner.skill_verifications ?? {}).find(
		(key) => key.trim().toLowerCase().normalize('NFC') === normalized
	);
	return owner.skill_verifications?.[legacyKey ?? ''] ?? null;
}

export function skillVerificationStatus(
	owner: Pick<VerificationOwner, 'skill_verifications'>,
	skillCode: string
): VerificationStatus {
	return skillVerificationRecord(owner, skillCode)?.status ?? 'pending';
}

export function hasPendingControlledSkill(
	owner: Pick<VerificationOwner, 'skill_verifications'>,
	skills: readonly string[],
	controlledSkills: readonly string[]
): boolean {
	const controlled = new Set(
		controlledSkills.map((skill) => skill.trim().toLowerCase().normalize('NFC'))
	);
	return skills.some(
		(skill) =>
			controlled.has(skill.trim().toLowerCase().normalize('NFC')) &&
			skillVerificationStatus(owner, skill) === 'pending'
	);
}

export const VERIFICATION_STATUS_LABEL: Record<VerificationStatus, string> = {
	pending: 'ยังไม่ได้ตรวจ',
	verified: 'ตรวจแล้ว ผ่าน',
	rejected: 'ตรวจแล้ว ไม่ผ่าน'
};
