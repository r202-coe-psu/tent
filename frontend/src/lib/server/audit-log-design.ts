import type { CouchReq } from './ensure-public-writer';

export const AUDIT_LOG_DB = 'audit_log';
export const AUDIT_LOG_DESIGN_ID = '_design/audit';
export const AUDIT_LOG_DESIGN_VERSION = 1;

export const AUDIT_LOG_SECURITY = {
	admins: { names: [] as string[], roles: ['_admin'] },
	members: { names: [] as string[], roles: ['_admin'] }
};

export interface AuditLogDesignDoc {
	_id: string;
	version: number;
	language: 'javascript';
	views: Record<string, { map: string }>;
	validate_doc_update: string;
}

export function buildAuditLogValidateDocUpdate(): string {
	return `function (newDoc, oldDoc, userCtx) {
  if (typeof newDoc._id === 'string' && newDoc._id.indexOf('_design/') === 0) {
    if (userCtx.roles.indexOf('_admin') === -1) throw({ forbidden: 'Only admins can change design documents' });
    return;
  }
  if (oldDoc) throw({ forbidden: 'audit_event is append-only' });
  if (newDoc._deleted) throw({ forbidden: 'audit_event cannot be deleted' });
  if (newDoc.type !== 'audit_event') throw({ forbidden: 'audit_log accepts only audit_event documents' });
  if (typeof newDoc._id !== 'string' || newDoc._id.indexOf('audit_event:') !== 0) {
    throw({ forbidden: '_id must start with audit_event:' });
  }
  if (newDoc.schema_v !== 1) throw({ forbidden: 'audit_event schema_v must be 1' });
  var strings = ['occurred_at', 'created_at', 'updated_at', 'created_by', 'action', 'event', 'source'];
  for (var i = 0; i < strings.length; i++) {
    if (typeof newDoc[strings[i]] !== 'string' || newDoc[strings[i]].length === 0) {
      throw({ forbidden: 'audit_event ' + strings[i] + ' must be a non-empty string' });
    }
  }
  if (!newDoc.actor || typeof newDoc.actor.name !== 'string' || newDoc.actor.name.length === 0 || typeof newDoc.actor.kind !== 'string' || newDoc.actor.kind.length === 0) {
    throw({ forbidden: 'audit_event actor must have a non-empty name and kind' });
  }
  if (!newDoc.entity || typeof newDoc.entity.type !== 'string' || newDoc.entity.type.length === 0 || typeof newDoc.entity.id !== 'string' || newDoc.entity.id.length === 0) {
    throw({ forbidden: 'audit_event entity must have a non-empty type and id' });
  }
  if (!('shelter_code' in newDoc) || (newDoc.shelter_code !== null && typeof newDoc.shelter_code !== 'string')) {
    throw({ forbidden: 'audit_event shelter_code must be a string or null' });
  }
}`;
}

export function buildAuditLogDesignDoc(): AuditLogDesignDoc {
	return {
		_id: AUDIT_LOG_DESIGN_ID,
		version: AUDIT_LOG_DESIGN_VERSION,
		language: 'javascript',
		views: {
			by_occurred_at: {
				map: `function (doc) {
  if (doc.type === 'audit_event') emit(doc.occurred_at, null);
}`
			},
			by_shelter: {
				map: `function (doc) {
  if (doc.type === 'audit_event' && doc.shelter_code) emit([doc.shelter_code, doc.occurred_at], null);
}`
			},
			by_entity: {
				map: `function (doc) {
  if (doc.type === 'audit_event' && doc.entity) emit([doc.entity.type, doc.entity.id, doc.occurred_at], null);
}`
			},
			by_actor: {
				map: `function (doc) {
  if (doc.type === 'audit_event' && doc.actor) emit([doc.actor.name, doc.occurred_at], null);
}`
			}
		},
		validate_doc_update: buildAuditLogValidateDocUpdate()
	};
}

export async function deployAuditLogDesign(
	couchReq: CouchReq,
	dryRun: boolean
): Promise<'current' | 'deployed'> {
	const desired = buildAuditLogDesignDoc();
	const existing = await couchReq('GET', `/${AUDIT_LOG_DB}/${AUDIT_LOG_DESIGN_ID}`);
	const current =
		existing.status === 200
			? (existing.data as (Partial<AuditLogDesignDoc> & { _rev?: string }) | null)
			: null;
	if (
		current &&
		current.version === desired.version &&
		current.validate_doc_update === desired.validate_doc_update &&
		JSON.stringify(current.views) === JSON.stringify(desired.views)
	) {
		return 'current';
	}
	if (dryRun) return 'deployed';
	const res = await couchReq('PUT', `/${AUDIT_LOG_DB}/${AUDIT_LOG_DESIGN_ID}`, {
		...desired,
		...(current?._rev ? { _rev: current._rev } : {})
	});
	if (res.status >= 400) {
		const detail = (res.data as { reason?: string; error?: string } | null) ?? {};
		throw new Error(
			`${AUDIT_LOG_DB} ${AUDIT_LOG_DESIGN_ID} deploy failed (${res.status}): ${detail.reason ?? detail.error ?? 'unknown'}`
		);
	}
	return 'deployed';
}

export function auditLogViewPath(view: string, params: Record<string, unknown>): string {
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value === undefined) continue;
		search.set(
			key,
			typeof value === 'string' && key === 'startkey_docid' ? value : JSON.stringify(value)
		);
	}
	return `/${AUDIT_LOG_DB}/${AUDIT_LOG_DESIGN_ID}/_view/${view}?${search.toString()}`;
}
