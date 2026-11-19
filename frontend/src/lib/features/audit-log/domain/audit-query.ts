import { z } from 'zod';
import { AUDIT_ACTIONS, type AuditEvent } from './audit-event';

export const AUDIT_LOG_DEFAULT_LIMIT = 50;
export const AUDIT_LOG_MAX_LIMIT = 200;

const optionalText = z
	.string()
	.trim()
	.transform((v) => (v === '' ? undefined : v))
	.optional();

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const isoBound = (edge: 'start' | 'end') =>
	z
		.string()
		.trim()
		.optional()
		.transform((v) => (v ? v : undefined))
		.refine((v) => v === undefined || !Number.isNaN(Date.parse(v)), 'วันที่ไม่ถูกต้อง')
		.transform((v) => {
			if (v === undefined) return undefined;
			if (DATE_ONLY.test(v)) {
				return `${v}T${edge === 'start' ? '00:00:00.000' : '23:59:59.999'}Z`;
			}
			return new Date(v).toISOString();
		});

export const auditLogQuerySchema = z.object({
	shelter_code: optionalText,
	entity_type: optionalText,
	entity_id: optionalText,
	actor: optionalText,
	action: z.enum(AUDIT_ACTIONS).optional(),
	from: isoBound('start'),
	to: isoBound('end'),
	cursor: optionalText,
	limit: z.preprocess(
		(v) => (v === '' || v === undefined ? undefined : v),
		z.coerce.number().int().min(1).max(AUDIT_LOG_MAX_LIMIT).default(AUDIT_LOG_DEFAULT_LIMIT)
	)
});
export type AuditLogQuery = z.output<typeof auditLogQuerySchema>;
export type AuditLogFilters = Omit<z.input<typeof auditLogQuerySchema>, 'limit'> & {
	limit?: number;
};

export function parseAuditLogQuery(params: URLSearchParams): AuditLogQuery {
	const raw: Record<string, string> = {};
	for (const [key, value] of params) raw[key] = value;
	return auditLogQuerySchema.parse(raw);
}

export function auditLogSearchParams(filters: AuditLogFilters): URLSearchParams {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(filters)) {
		if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
	}
	return params;
}

export type AuditCursor = { key: unknown; id: string };

export function encodeAuditCursor(cursor: AuditCursor): string {
	return JSON.stringify(cursor);
}

export function decodeAuditCursor(raw: string | undefined): AuditCursor | null {
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as Partial<AuditCursor>;
		if (typeof parsed.id !== 'string' || !('key' in parsed)) return null;
		return { key: parsed.key, id: parsed.id };
	} catch {
		return null;
	}
}

export type AuditViewName = 'by_occurred_at' | 'by_shelter' | 'by_entity' | 'by_actor';
export type AuditViewRange = { view: AuditViewName; startkey: unknown; endkey: unknown };

const HIGH = {};

export function chooseAuditView(query: AuditLogQuery): AuditViewRange {
	const to = query.to ?? HIGH;
	if (query.entity_type && query.entity_id) {
		return {
			view: 'by_entity',
			startkey: [query.entity_type, query.entity_id, to],
			endkey: query.from
				? [query.entity_type, query.entity_id, query.from]
				: [query.entity_type, query.entity_id]
		};
	}
	if (query.actor) {
		return {
			view: 'by_actor',
			startkey: [query.actor, to],
			endkey: query.from ? [query.actor, query.from] : [query.actor]
		};
	}
	if (query.shelter_code) {
		return {
			view: 'by_shelter',
			startkey: [query.shelter_code, to],
			endkey: query.from ? [query.shelter_code, query.from] : [query.shelter_code]
		};
	}
	if (query.entity_type) {
		return { view: 'by_entity', startkey: [query.entity_type, HIGH], endkey: [query.entity_type] };
	}
	return { view: 'by_occurred_at', startkey: query.to ?? '￰', endkey: query.from ?? '' };
}

export function matchesAuditQuery(event: AuditEvent, query: AuditLogQuery): boolean {
	if (query.shelter_code && event.shelter_code !== query.shelter_code) return false;
	if (query.entity_type && event.entity?.type !== query.entity_type) return false;
	if (query.entity_id && event.entity?.id !== query.entity_id) return false;
	if (query.actor && event.actor?.name !== query.actor) return false;
	if (query.action && event.action !== query.action) return false;
	if (query.from && event.occurred_at < query.from) return false;
	if (query.to && event.occurred_at > query.to) return false;
	return true;
}

export type AuditEventView = Omit<AuditEvent, '_rev' | 'actor'> & {
	actor: AuditEvent['actor'] & { display_name: string };
};

export type AuditLogPage = { items: AuditEventView[]; next_cursor: string | null };
