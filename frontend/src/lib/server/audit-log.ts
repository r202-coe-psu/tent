import {
	buildAuditEvent,
	chooseAuditView,
	computeAuditChanges,
	cursorMatchesRange,
	cursorWithinQuery,
	decodeAuditCursor,
	encodeAuditCursor,
	matchesAuditQuery,
	type AuditEntityType,
	type AuditEvent,
	type AuditEventInput,
	type AuditEventView,
	type AuditLogPage,
	type AuditLogQuery
} from '$lib/features/audit-log/server';
import { ulid } from '$lib/db/ulid';
import { adminRaw, ServiceError } from './couch-admin';
import { AUDIT_LOG_DB, auditLogViewPath } from './audit-log-design';
import { getDisplayNames } from './user-service';

export const AUDIT_LOG_WRITE_ATTEMPTS = 3;
const AUDIT_RETRYABLE_STATUSES = new Set([408, 429]);
const RETRY_DELAY_MS = 150;
const MAX_SCAN_ROUNDS = 5;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function recordAudit(input: AuditEventInput): Promise<boolean> {
	const now = new Date().toISOString();
	const doc = buildAuditEvent(input, ulid(), now);
	const path = `/${AUDIT_LOG_DB}/${encodeURIComponent(doc._id)}`;
	let lastError: unknown = null;
	for (let attempt = 1; attempt <= AUDIT_LOG_WRITE_ATTEMPTS; attempt++) {
		try {
			const res = await adminRaw(path, 'PUT', doc);
			if (res.status < 400 || res.status === 409) return true;
			lastError = `HTTP ${res.status}`;
			if (res.status < 500 && !AUDIT_RETRYABLE_STATUSES.has(res.status)) break;
		} catch (error) {
			lastError = error;
		}
		if (attempt < AUDIT_LOG_WRITE_ATTEMPTS) await sleep(RETRY_DELAY_MS * attempt);
	}
	console.error('[audit-log] event not written', { event: doc, error: lastError });
	return false;
}

export type AuditedWrite = {
	actor: string;
	event: string;
	action: AuditEventInput['action'];
	entityType: AuditEntityType;
	entityId: string;
	label?: string | null;
	shelterCode: string | null;
	before?: Record<string, unknown> | null;
	after?: Record<string, unknown> | null;
	reason?: string | null;
	onlyWhenChanged?: boolean;
};

export async function recordAuditedWrites(
	write: Omit<AuditedWrite, 'shelterCode'>,
	shelterCodes: ReadonlyArray<string | null>
): Promise<void> {
	for (const shelterCode of shelterCodes) await recordAuditedWrite({ ...write, shelterCode });
}

export function recordAuditedWrite(write: AuditedWrite): Promise<boolean> {
	const changes =
		write.action === 'create' || write.action === 'delete'
			? undefined
			: computeAuditChanges(write.entityType, write.before, write.after);
	if (write.onlyWhenChanged && changes && changes.length === 0) return Promise.resolve(false);
	return recordAudit({
		actor: write.actor,
		action: write.action,
		event: write.event,
		entity: { type: write.entityType, id: write.entityId, label: write.label ?? null },
		shelterCode: write.shelterCode,
		changes,
		reason: write.reason ?? null
	});
}

function nameFromProxiedBody(body: unknown): string | null {
	if (!body || typeof body !== 'object') return null;
	const record = body as Record<string, unknown>;
	if (typeof record.name === 'string') return record.name;
	for (const key of ['key', 'client', 'api_key', 'thirdparty_client']) {
		const nested = record[key];
		if (nested && typeof nested === 'object') {
			const name = (nested as Record<string, unknown>).name;
			if (typeof name === 'string') return name;
		}
	}
	return null;
}

export async function recordProxiedWrite(
	res: Response,
	write: Omit<AuditedWrite, 'entityId' | 'label'> & { entityId?: string; label?: string | null }
): Promise<void> {
	if (!res.ok) return;
	const body = (await res
		.clone()
		.json()
		.catch(() => null)) as { id?: unknown } | null;
	const bodyId =
		typeof body?.id === 'string' || typeof body?.id === 'number' ? String(body.id) : null;
	const bodyName = nameFromProxiedBody(body);
	const entityId = write.entityId ?? bodyId;
	if (!entityId) {
		console.warn('[audit-log] event not written: upstream body carried no id', {
			event: write.event,
			entityType: write.entityType
		});
		return;
	}
	await recordAuditedWrite({
		...write,
		entityId,
		label: write.label ?? bodyName
	});
}

type ViewRow = { id: string; key: unknown; doc?: AuditEvent | null };

export async function queryAuditLog(query: AuditLogQuery): Promise<AuditLogPage> {
	const range = chooseAuditView(query);
	const cursor = decodeAuditCursor(query.cursor);
	if (cursor && !(cursorMatchesRange(range, cursor) && cursorWithinQuery(query, cursor))) {
		throw new ServiceError('VALIDATION', 'cursor does not belong to this query');
	}
	const batch = Math.min(query.limit * 4, 500);
	const matched: AuditEvent[] = [];
	let startkey = cursor ? cursor.key : range.startkey;
	let startDocId: string | undefined = cursor?.id;
	let skip = cursor ? 1 : 0;
	let last: ViewRow | null = null;
	let exhausted = false;

	for (let round = 0; round < MAX_SCAN_ROUNDS && matched.length < query.limit; round++) {
		const res = await adminRaw(
			auditLogViewPath(range.view, {
				descending: true,
				include_docs: true,
				limit: batch,
				skip: skip || undefined,
				startkey,
				endkey: range.endkey,
				startkey_docid: startDocId
			}),
			'GET'
		);
		if (res.status === 404) {
			exhausted = true;
			break;
		}
		if (res.status >= 400) {
			throw new ServiceError('INTERNAL', `audit_log read failed (${res.status})`);
		}
		const rows = ((res.data as { rows?: ViewRow[] } | null)?.rows ?? []).filter(Boolean);
		let consumed = 0;
		for (const row of rows) {
			last = row;
			consumed += 1;
			if (row.doc && matchesAuditQuery(row.doc, query)) matched.push(row.doc);
			if (matched.length >= query.limit) break;
		}
		if (rows.length < batch && consumed === rows.length) {
			exhausted = true;
			break;
		}
		if (!last) break;
		startkey = last.key;
		startDocId = last.id;
		skip = 1;
	}

	const lastRow = last as ViewRow | null;
	const nextCursor =
		!exhausted && lastRow ? encodeAuditCursor({ key: lastRow.key, id: lastRow.id }) : null;
	const names = await getDisplayNames(matched.map((e) => e.actor?.name ?? '')).catch(
		() => new Map<string, string>()
	);
	const items: AuditEventView[] = matched.map((event) => {
		const view: AuditEventView & { _rev?: string } = {
			...event,
			actor: { ...event.actor, display_name: names.get(event.actor.name) ?? event.actor.name }
		};
		delete view._rev;
		return view;
	});
	return { items, next_cursor: nextCursor };
}
