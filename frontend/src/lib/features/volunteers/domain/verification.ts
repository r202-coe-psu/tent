import { z } from 'zod';

export const verificationStatusSchema = z.enum(['pending', 'verified', 'rejected']);
export type VerificationStatus = z.infer<typeof verificationStatusSchema>;

export const verificationRecordSchema = z.object({
	status: verificationStatusSchema,
	reviewed_at: z.string().nullable().optional(),
	reviewed_by: z.string().nullable().optional(),
	notes: z.string().nullable().optional(),
	/** License number, professional number, or another evidence reference. */
	credential_reference: z.string().nullable().optional()
});
export type VerificationRecord = z.infer<typeof verificationRecordSchema>;

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
	pending: 'รอตรวจ',
	verified: 'รับรองแล้ว',
	rejected: 'ไม่ผ่าน'
};
