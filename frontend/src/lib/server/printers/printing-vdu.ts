// eslint-disable-next-line no-restricted-imports -- server-safe domain rule; feature barrel pulls client UI/query code
import { MAX_LABELS_PER_JOB } from '$lib/features/printers/domain/print-job.schema';
// eslint-disable-next-line no-restricted-imports -- server-safe domain rule; feature barrel pulls client UI/query code
import { PRINT_SOURCE_CAPABILITIES } from '$lib/features/printers/domain/print-permission';
// eslint-disable-next-line no-restricted-imports -- server-safe domain rule; feature barrel pulls client UI/query code
import { MAX_LABEL_PNG_BYTES } from '$lib/features/printers/domain/label-png';

/**
 * JS source of `_design/print_access` `validate_doc_update` for every `printing_{code}` database
 * (FR-1..4 / FR-51). One source fits all shelters: the CODE is derived at runtime from
 * `userCtx.db`. The role table is embedded from {@link PRINT_SOURCE_CAPABILITIES}, so the BFF
 * (`canPrintSource`) and CouchDB enforce the same rules.
 *
 * Must stay ES5 (CouchDB's JS engine): `var`, no arrow functions, no template literals, `indexOf`.
 *
 * - `_admin`: unrestricted (provisioning / migration); everyone else may not touch design docs.
 * - the service user (`serviceUserName`, the CouchDB login of `COUCHDB_PRINTING_SERVICE_URL`; claims /
 *   finishes / expires jobs): never creates; updates keep origin fields immutable, status moves forward
 *   only, `printed` stays within 0..`label_count`, terminal writes carry `finished_at` and drop the label attachments (PDPA). It may delete
 *   only terminal jobs (retention; CouchDB `_purge` needs server admin, so delete + `_compact`).
 * - staff (anyone else): create-only, a `pending` job stamped with their own name, for their own
 *   shelter, with the role the job `source` requires, and exactly `label_count` PNG labels.
 */
export function buildPrintingValidateDocUpdate(serviceUserName: string): string {
	const capabilities = JSON.stringify(PRINT_SOURCE_CAPABILITIES);
	const serviceUser = JSON.stringify(serviceUserName);
	return `function (newDoc, oldDoc, userCtx, secObj) {
  var CAPABILITIES = ${capabilities};
  var SERVICE_USER = ${serviceUser};
  var MAX_LABELS = ${MAX_LABELS_PER_JOB};
  var MAX_LABEL_BYTES = ${MAX_LABEL_PNG_BYTES};
  var DB_PREFIX = 'printing_';
  var roles = userCtx.roles || [];

  function deny(reason) {
    throw ({ forbidden: reason });
  }
  function hasRole(role) {
    return roles.indexOf(role) !== -1;
  }
  function isTerminal(status) {
    return status === 'printed' || status === 'failed' || status === 'expired';
  }
  function hasKeys(obj) {
    for (var key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) return true;
    }
    return false;
  }
  function countKeys(obj) {
    var n = 0;
    for (var key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) n++;
    }
    return n;
  }
  function startsWith(value, prefix) {
    return typeof value === 'string' && value.indexOf(prefix) === 0;
  }

  if (hasRole('_admin')) return;

  if (startsWith(newDoc._id, '_design/') || (oldDoc && startsWith(oldDoc._id, '_design/'))) {
    deny('design documents are admin-only');
  }

  if (userCtx.name === SERVICE_USER) {
    if (!oldDoc) deny('printing_service cannot create documents');
    if (newDoc._deleted) {
      if (oldDoc.type === 'print_job' && isTerminal(oldDoc.status)) return;
      deny('printing_service may only delete finished print jobs');
    }
    if (oldDoc.type !== 'print_job' || newDoc.type !== 'print_job') {
      deny('printing_service may only update print jobs');
    }
    var immutable = ['created_by', 'shelter_code', 'printer_id', 'source', 'label_count', 'created_at', 'expires_at'];
    for (var i = 0; i < immutable.length; i++) {
      if (newDoc[immutable[i]] !== oldDoc[immutable[i]]) {
        deny(immutable[i] + ' is immutable');
      }
    }
    var allowed = {
      pending: ['printing', 'expired', 'failed'],
      printing: ['printed', 'failed']
    };
    var next = Object.prototype.hasOwnProperty.call(allowed, oldDoc.status) ? allowed[oldDoc.status] : [];
    if (next.indexOf(newDoc.status) === -1) {
      deny('invalid status transition ' + oldDoc.status + ' -> ' + newDoc.status);
    }
    if (typeof newDoc.printed !== 'undefined') {
      var printed = newDoc.printed;
      if (typeof printed !== 'number' || printed % 1 !== 0 || printed < 0 || printed > newDoc.label_count) {
        deny('printed must be an integer from 0 to label_count');
      }
    }
    if (isTerminal(newDoc.status)) {
      if (!newDoc.finished_at) deny('terminal job needs finished_at');
      if (newDoc._attachments && hasKeys(newDoc._attachments)) {
        deny('terminal job must not keep attachments');
      }
    }
    return;
  }

  if (oldDoc || newDoc._deleted) deny('print jobs are create-only');
  if (!startsWith(newDoc._id, 'print_job:')) deny('job id must start with print_job:');
  if (newDoc.type !== 'print_job') deny('type must be print_job');
  if (newDoc.schema_v !== 1) deny('schema_v must be 1');
  if (newDoc.status !== 'pending') deny('new jobs must be pending');
  if (!userCtx.name || newDoc.created_by !== userCtx.name) deny('created_by must be the caller');

  if (!startsWith(userCtx.db, DB_PREFIX)) deny('not a printing database');
  var code = userCtx.db.slice(DB_PREFIX.length).toUpperCase();
  if (typeof newDoc.shelter_code !== 'string' || newDoc.shelter_code.toUpperCase() !== code) {
    deny('shelter_code must match the database');
  }

  var source = newDoc.source;
  if (typeof source !== 'string' || !Object.prototype.hasOwnProperty.call(CAPABILITIES, source)) {
    deny('unknown job source');
  }
  if (!hasRole('system_admin')) {
    var capabilities = CAPABILITIES[source];
    var permitted = false;
    for (var c = 0; c < capabilities.length; c++) {
      if (hasRole(code + ':' + capabilities[c])) permitted = true;
    }
    if (!hasRole('shelter:' + code) || !permitted) deny('role may not print this source');
  }

  if (!startsWith(newDoc.printer_id, 'print_device:')) deny('printer_id must be a print_device');
  if (typeof newDoc.created_at !== 'string' || typeof newDoc.expires_at !== 'string') {
    deny('created_at and expires_at must be strings');
  }

  var count = newDoc.label_count;
  if (typeof count !== 'number' || count % 1 !== 0 || count < 1 || count > MAX_LABELS) {
    deny('label_count must be an integer from 1 to ' + MAX_LABELS);
  }

  var attachments = newDoc._attachments;
  if (!attachments || countKeys(attachments) !== count) {
    deny('attachment count must equal label_count');
  }
  for (var n = 0; n < count; n++) {
    var name = 'label-' + (n < 10 ? '00' : n < 100 ? '0' : '') + n + '.png';
    var attachment = Object.prototype.hasOwnProperty.call(attachments, name) ? attachments[name] : null;
    if (!attachment) deny('missing attachment ' + name);
    if (attachment.content_type !== 'image/png') deny('attachment ' + name + ' must be image/png');
    if (typeof attachment.length !== 'number' || attachment.length > MAX_LABEL_BYTES) {
      deny('attachment ' + name + ' exceeds ' + MAX_LABEL_BYTES + ' bytes');
    }
  }
}`;
}
