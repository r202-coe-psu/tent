/**
 * CouchDB design documents for `shelter_import_queue`.
 *
 * All views live in `_design/app`, while `validate_doc_update` lives in
 * `_design/access` according to project convention (.agents/skills/couchdb-bestpractices/SKILL.md).
 *
 * Kept free of `$env` so deployment and maintenance scripts can import it.
 */

export const IMPORT_QUEUE_DB = 'shelter_import_queue';
export const QUEUE_DESIGN_APP_ID = '_design/app';
export const QUEUE_DESIGN_ACCESS_ID = '_design/access';

export const QUEUE_DESIGN_VERSION = 1;

export interface QueueDesignAppDoc {
	_id: string;
	version: number;
	language: 'javascript';
	views: Record<string, { map: string; reduce?: string }>;
}

export interface QueueDesignAccessDoc {
	_id: string;
	version: number;
	language: 'javascript';
	validate_doc_update: string;
}

export function buildQueueValidateDocUpdate(): string {
	return `function (newDoc, oldDoc, userCtx) {
  if (userCtx.roles.indexOf('_admin') !== -1 || userCtx.roles.indexOf('system_admin') !== -1) {
    if (oldDoc && newDoc.type !== oldDoc.type) {
      throw({ forbidden: 'Cannot change document type' });
    }
    if (newDoc.type !== 'shelter_import_job' && newDoc.type !== 'shelter_import_item') {
      throw({ forbidden: 'Invalid import queue document type' });
    }
    return;
  }
  throw({ forbidden: 'Only administrators can write import queue documents' });
}`;
}

export function buildQueueDesignDoc(): QueueDesignAppDoc {
	return {
		_id: QUEUE_DESIGN_APP_ID,
		version: QUEUE_DESIGN_VERSION,
		language: 'javascript',
		views: {
			jobs_by_runnable: {
				map: `function (doc) {
  if (doc.type === 'shelter_import_job') {
    if (doc.retry_pending === true) {
      emit(['retry_pending', doc.created_at, doc._id], null);
    } else if (doc.status === 'queued') {
      emit(['queued', doc.created_at, doc._id], null);
    } else if (doc.status === 'running') {
      emit(['running', doc.created_at, doc._id], null);
    } else if ((doc.status === 'completed' || doc.status === 'completed_with_errors') && doc.audit_logged !== true) {
      emit(['audit_repair', doc.created_at, doc._id], null);
    }
  }
}`
			},
			items_by_job_row: {
				map: `function (doc) {
  if (doc.type === 'shelter_import_item' && typeof doc.row === 'number') {
    var jobId = doc.job_id || ('shelter_import_job:' + doc._id.split(':')[1]);
    emit([jobId, doc.row], null);
  }
}`
			},
			items_by_job_status_row: {
				map: `function (doc) {
  if (doc.type === 'shelter_import_item' && doc.status && typeof doc.row === 'number') {
    var jobId = doc.job_id || ('shelter_import_job:' + doc._id.split(':')[1]);
    emit([jobId, doc.status, doc.row], null);
  }
}`
			},
			running_items_by_lease: {
				map: `function (doc) {
  if (doc.type === 'shelter_import_item' && doc.status === 'running' && doc.lease_until && typeof doc.row === 'number') {
    var jobId = doc.job_id || ('shelter_import_job:' + doc._id.split(':')[1]);
    emit([jobId, doc.lease_until, doc.row], null);
  }
}`
			},
			items_by_job_status_count: {
				map: `function (doc) {
  if (doc.type === 'shelter_import_item' && doc.status) {
    var jobId = doc.job_id || ('shelter_import_job:' + doc._id.split(':')[1]);
    emit([jobId, doc.status], 1);
  }
}`,
				reduce: '_count'
			}
		}
	};
}

export function buildQueueAccessDoc(): QueueDesignAccessDoc {
	return {
		_id: QUEUE_DESIGN_ACCESS_ID,
		version: QUEUE_DESIGN_VERSION,
		language: 'javascript',
		validate_doc_update: buildQueueValidateDocUpdate()
	};
}

export function queueJobsByRunnablePath(options?: {
	limit?: number;
	startkey?: [string, string, string];
	startkey_docid?: string;
	skip?: number;
}): string {
	const limit = options?.limit ?? 20;
	const params = new URLSearchParams({
		include_docs: 'true',
		reduce: 'false',
		limit: String(limit)
	});
	if (options?.startkey) {
		params.set('startkey', JSON.stringify(options.startkey));
	}
	if (options?.startkey_docid) {
		params.set('startkey_docid', options.startkey_docid);
	}
	if (options?.skip) {
		params.set('skip', String(options.skip));
	}
	return `/${IMPORT_QUEUE_DB}/${QUEUE_DESIGN_APP_ID}/_view/jobs_by_runnable?${params.toString()}`;
}

export function queueItemsByJobRowPath(jobId: string, limit = 1000): string {
	const fullJobId = jobId.startsWith('shelter_import_job:') ? jobId : `shelter_import_job:${jobId}`;
	return `/${IMPORT_QUEUE_DB}/${QUEUE_DESIGN_APP_ID}/_view/items_by_job_row?startkey=${encodeURIComponent(
		JSON.stringify([fullJobId, 0])
	)}&endkey=${encodeURIComponent(
		JSON.stringify([fullJobId, {}])
	)}&include_docs=true&reduce=false&limit=${limit}`;
}

export function queueItemsByJobStatusRowPath(jobId: string, status: string, limit = 1): string {
	const fullJobId = jobId.startsWith('shelter_import_job:') ? jobId : `shelter_import_job:${jobId}`;
	return `/${IMPORT_QUEUE_DB}/${QUEUE_DESIGN_APP_ID}/_view/items_by_job_status_row?startkey=${encodeURIComponent(
		JSON.stringify([fullJobId, status, 0])
	)}&endkey=${encodeURIComponent(
		JSON.stringify([fullJobId, status, {}])
	)}&include_docs=true&reduce=false&limit=${limit}`;
}

export function queueRunningItemsByLeasePath(jobId: string, cutoffIso: string, limit = 1): string {
	const fullJobId = jobId.startsWith('shelter_import_job:') ? jobId : `shelter_import_job:${jobId}`;
	return `/${IMPORT_QUEUE_DB}/${QUEUE_DESIGN_APP_ID}/_view/running_items_by_lease?startkey=${encodeURIComponent(
		JSON.stringify([fullJobId, null, 0])
	)}&endkey=${encodeURIComponent(
		JSON.stringify([fullJobId, cutoffIso, {}])
	)}&include_docs=true&reduce=false&limit=${limit}`;
}

export function queueItemsByJobStatusCountPath(jobId: string): string {
	const fullJobId = jobId.startsWith('shelter_import_job:') ? jobId : `shelter_import_job:${jobId}`;
	return `/${IMPORT_QUEUE_DB}/${QUEUE_DESIGN_APP_ID}/_view/items_by_job_status_count?startkey=${encodeURIComponent(
		JSON.stringify([fullJobId, null])
	)}&endkey=${encodeURIComponent(JSON.stringify([fullJobId, {}]))}&group=true`;
}
