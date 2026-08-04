import { z } from 'zod';
import { ulid } from '$lib/db/ulid';

export const announcementSeveritySchema = z.enum(['info', 'warning', 'emergency']);
export type AnnouncementSeverity = z.infer<typeof announcementSeveritySchema>;

export const announcementSchema = z.object({
	_id: z.string().min(1),
	_rev: z.string().optional(),
	type: z.literal('announcement'),
	schema_v: z.literal(1),
	title: z.string().trim().min(1, 'ระบุหัวข้อประกาศ'),
	description: z.string().trim().min(1, 'ระบุรายละเอียดประกาศ'),
	severity: announcementSeveritySchema,
	is_active: z.boolean(),
	created_at: z.string().datetime(),
	updated_at: z.string().datetime(),
	created_by: z.string().min(1)
});

export type Announcement = z.infer<typeof announcementSchema>;

export const isAnnouncement = (d: unknown): d is Announcement =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'announcement';

export interface RegistryAuthorContext {
	createdBy: string;
}

export function createAnnouncement(
	data: Omit<
		Announcement,
		'_id' | '_rev' | 'type' | 'schema_v' | 'created_at' | 'updated_at' | 'created_by'
	>,
	ctx: RegistryAuthorContext
): Announcement {
	const ts = new Date().toISOString();
	return {
		_id: `announcement:${ulid()}`,
		type: 'announcement',
		schema_v: 1,
		title: data.title,
		description: data.description,
		severity: data.severity,
		is_active: data.is_active,
		created_at: ts,
		updated_at: ts,
		created_by: ctx.createdBy
	};
}

export function touchAnnouncement(
	doc: Announcement,
	data: Partial<Pick<Announcement, 'title' | 'description' | 'severity' | 'is_active'>>
): Announcement {
	return {
		...doc,
		...data,
		updated_at: new Date().toISOString()
	};
}
