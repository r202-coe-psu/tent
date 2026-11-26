import { formatThaiDateTime } from '$lib/utils/date';

export type ShelterActorsInput = {
	created_at?: string | null;
	updated_at?: string | null;
	created_by_name?: string | null;
	updated_by_name?: string | null;
};

export type ShelterActorsLine = {
	createdBy: string;
	createdAt: string;
	updatedBy: string;
	updatedAt: string;
};

export const UNKNOWN_CREATOR = 'ไม่ทราบ (สร้างก่อนมีการบันทึก)';
export const UNKNOWN_EDITOR = 'ไม่ทราบ';

export function shelterActorsLine(input: ShelterActorsInput): ShelterActorsLine {
	return {
		createdBy: input.created_by_name?.trim() || UNKNOWN_CREATOR,
		createdAt: formatThaiDateTime(input.created_at),
		updatedBy: input.updated_by_name?.trim() || UNKNOWN_EDITOR,
		updatedAt: formatThaiDateTime(input.updated_at)
	};
}
