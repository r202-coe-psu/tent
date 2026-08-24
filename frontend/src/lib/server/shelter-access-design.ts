/**
 * CouchDB `_design/access` helpers for per-shelter databases.
 * Shared by provisioning (+server.ts) and admin redeploy (shelters.admin.ts).
 */

// Keep this server/seed helper domain-only. Importing the feature barrel pulls
// Svelte/TanStack modules into Node-only scripts such as `pnpm seed`.
import { SOP_RATIO_KEYS } from '$lib/features/sop-ratios/domain/sop-ratio';

/** Database name for a shelter's own per-shelter CouchDB. */
export function shelterDbName(code: string): string {
	return `shelter_${code.toLowerCase()}`;
}

/** Mango index definitions required by referral list/find (CR-045). */
export const REFERRAL_MANGO_INDEXES = [
	{
		index: { fields: ['type', 'status'] },
		name: 'referral-type-status-idx',
		type: 'json' as const
	},
	{
		index: { fields: ['type', 'evacuee_id'] },
		name: 'referral-type-evacuee-idx',
		type: 'json' as const
	},
	{
		index: { fields: ['type', 'shelter_code', 'created_at'] },
		name: 'referral-type-shelter-created-idx',
		type: 'json' as const
	},
	{
		index: { fields: ['type', 'to_shelter_code', 'created_at'] },
		name: 'referral-type-toshelter-created-idx',
		type: 'json' as const
	},
	{
		index: { fields: [{ type: 'desc' }, { created_at: 'desc' }] },
		name: 'referral-list-created-desc-idx',
		type: 'json' as const
	},
	{
		index: { fields: [{ type: 'asc' }, { created_at: 'asc' }] },
		name: 'referral-list-created-asc-idx',
		type: 'json' as const
	},
	{
		index: { fields: [{ type: 'desc' }, { status: 'desc' }, { created_at: 'desc' }] },
		name: 'referral-list-status-created-desc-idx',
		type: 'json' as const
	}
];

/**
 * Server-side `validate_doc_update` for a shelter db. Enforces the common
 * envelope (schema.md §0) + shelter_code match + allowed doc types, then the
 * integrity rules of T-16:
 *
 *  - **append-only** `stock_ledger` / `audit` / `movement` / `screening` /
 *    `people_import_log` — reject any update or delete of an existing doc
 *    (schema.md §1.4–1.5, §1.7, §6.2). A wrong ledger entry is corrected by writing
 *    a new offsetting entry, never by editing history.
 *  - **forward-only** `donation.status` — `received` may not fall back to `declared`
 *    (schema.md §2.3 state machine).
 *  - **role gate** on `stock_ledger` — only warehouse staff / managers may move stock.
 *
 * `_admin` bypasses so provisioning/seed writes are not blocked. NOTE: the
 * back-office intake route writes with admin credentials, so it does NOT pass
 * through here — its gate is `authorizeWarehouse()`. These rules protect the
 * session-authenticated client write path (`ReceiveStockForm` and friends).
 */
export function buildValidateDocUpdate(code: string): string {
	const simulationResourceKeys = JSON.stringify(SOP_RATIO_KEYS);
	return `function (newDoc, oldDoc, userCtx) {
  if (userCtx.roles.indexOf('_admin') !== -1) return;
  // schema.md §1.4 movement, §1.5 screening, §1.7 people_import_log, §2.6 kitchen_requisition,
  // §2.7 meal_service, §2.7.2 gas_ledger (CR-086), §6.2 stock_ledger / audit
  var appendOnly = [
    'stock_ledger', 'audit', 'movement', 'screening', 'people_import_log',
    'kitchen_requisition', 'meal_service', 'gas_ledger'
  ];
  var wasAppendOnly = oldDoc && appendOnly.indexOf(oldDoc.type) !== -1;
  if (newDoc._deleted) {
    if (oldDoc && oldDoc.type === 'simulation') {
      throw { forbidden: 'Saved simulations are immutable and cannot be deleted' };
    }
    if (wasAppendOnly) {
      throw { forbidden: 'Cannot delete append-only ' + oldDoc.type + ' documents' };
    }
    return;
  }
  function require(field) {
    if (typeof newDoc[field] === 'undefined' || newDoc[field] === null) {
      throw { forbidden: field + ' is required' };
    }
  }
  require('type');
  require('schema_v');
  require('shelter_code');
  require('created_at');
  require('updated_at');
  require('created_by');
  if (newDoc.shelter_code !== '${code}') {
    throw { forbidden: 'shelter_code must be ${code}' };
  }
  // People plane (schema.md §1) must be writable by session staff — missing
  // household/medical/screening/movement/image causes partial registration:
  // createEvacuee succeeds, then household/screening PUT is forbidden.
  // Kitchen (Module D, schema.md §2.5-§2.7.2) was missing here entirely —
  // kitchen_staff could never actually write a meal plan, requisition, service
  // record, or gas cylinder/ledger without an _admin session (bug found + fixed
  // alongside CR-080).
  var allowed = [
    'evacuee', 'household', 'medical', 'screening', 'movement', 'image',
    'people_import_log',
    'donation', 'donation_campaign', 'stock_ledger', 'donation_slot', 'donation_redirect',
    'audit', 'daily_calc', 'purchase', 'referral',
    'meal_plan', 'kitchen_requisition', 'meal_service', 'gas_cylinder_type', 'gas_ledger',
    'simulation'
  ];
  if (allowed.indexOf(newDoc.type) === -1) {
    throw { forbidden: 'doc type not allowed yet: ' + newDoc.type };
  }
  // 1. append-only: stock_ledger / audit / movement / screening are never rewritten
  if (appendOnly.indexOf(newDoc.type) !== -1 && oldDoc) {
    throw { forbidden: 'Cannot update append-only ' + newDoc.type + ' documents' };
  }
  // T-42: saved simulations are immutable snapshots and manager-owned planning evidence.
  if (newDoc.type === 'simulation') {
    var canSimulate =
      userCtx.roles.indexOf('shelter_manager') !== -1 ||
      userCtx.roles.indexOf('system_admin') !== -1;
    if (!canSimulate) {
      throw { forbidden: 'Only shelter managers or system admins can save simulations' };
    }
    if (oldDoc) {
      throw { forbidden: 'Saved simulations are immutable' };
    }
    if (!/^simulation:[0-9A-HJKMNP-TV-Z]{26}$/.test(newDoc._id)) {
      throw { forbidden: 'simulation id must be simulation:{ulid}' };
    }
    if (newDoc.schema_v !== 1) {
      throw { forbidden: 'Unsupported simulation schema version' };
    }
    if (newDoc.created_by !== userCtx.name) {
      throw { forbidden: 'created_by must match the authenticated user' };
    }
    if (newDoc.created_at !== newDoc.updated_at) {
      throw { forbidden: 'Immutable simulation timestamps must match on create' };
    }
    var result = newDoc.result;
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw { forbidden: 'simulation result is required' };
    }
    if (!result.input || !result.snapshot || !result.current || !result.scenario || !Array.isArray(result.comparison)) {
      throw { forbidden: 'simulation result shape is incomplete' };
    }
    if (result.snapshot.shelter_code !== newDoc.shelter_code) {
      throw { forbidden: 'simulation snapshot shelter must match document shelter' };
    }
    if (typeof result.input.name !== 'string' || result.input.name.trim().length === 0 || result.input.name.length > 120) {
      throw { forbidden: 'simulation name is invalid' };
    }
    if (typeof result.input.occupancy !== 'number' || !isFinite(result.input.occupancy) || result.input.occupancy < 0 || Math.floor(result.input.occupancy) !== result.input.occupancy) {
      throw { forbidden: 'simulation occupancy is invalid' };
    }
    if (typeof result.input.days !== 'number' || result.input.days < 1 || result.input.days > 365 || Math.floor(result.input.days) !== result.input.days) {
      throw { forbidden: 'simulation days are invalid' };
    }
    if (!result.input.ratio_overrides || typeof result.input.ratio_overrides !== 'object' || Array.isArray(result.input.ratio_overrides)) {
      throw { forbidden: 'simulation ratio overrides are invalid' };
    }
    var simulationKeys = ${simulationResourceKeys};
    var decimalPattern = /^(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$/;
    for (var overrideKey in result.input.ratio_overrides) {
      if (simulationKeys.indexOf(overrideKey) === -1 ||
          typeof result.input.ratio_overrides[overrideKey] !== 'string' ||
          !decimalPattern.test(result.input.ratio_overrides[overrideKey]) ||
          Number(result.input.ratio_overrides[overrideKey]) <= 0) {
        throw { forbidden: 'simulation ratio override is invalid' };
      }
    }
    if (result.current.occupancy !== result.snapshot.current_occupancy ||
        result.scenario.occupancy !== result.input.occupancy) {
      throw { forbidden: 'simulation occupancy evidence is inconsistent' };
    }
    if (!result.snapshot.current_ratios || !Array.isArray(result.snapshot.resource_inputs) ||
        !result.current.ratios || !result.scenario.ratios) {
      throw { forbidden: 'simulation snapshot inputs are incomplete' };
    }
    if (result.comparison.length !== 20 ||
        result.snapshot.resource_inputs.length !== 20 ||
        !Array.isArray(result.current.daily_results) || result.current.daily_results.length !== 20 ||
        !Array.isArray(result.current.horizon_results) || result.current.horizon_results.length !== 20 ||
        !Array.isArray(result.scenario.daily_results) || result.scenario.daily_results.length !== 20 ||
        !Array.isArray(result.scenario.horizon_results) || result.scenario.horizon_results.length !== 20) {
      throw { forbidden: 'simulation result resource coverage is invalid' };
    }
    for (var i = 0; i < simulationKeys.length; i++) {
      var key = simulationKeys[i];
      var expectedScenarioRatio = Object.prototype.hasOwnProperty.call(result.input.ratio_overrides, key)
        ? result.input.ratio_overrides[key]
        : result.snapshot.current_ratios[key];
      if (result.snapshot.resource_inputs[i].key !== key ||
          result.current.daily_results[i].key !== key ||
          result.current.horizon_results[i].key !== key ||
          result.scenario.daily_results[i].key !== key ||
          result.scenario.horizon_results[i].key !== key ||
          result.comparison[i].key !== key) {
        throw { forbidden: 'simulation result resource order is invalid' };
      }
      if (result.current.ratios[key] !== result.snapshot.current_ratios[key] ||
          result.scenario.ratios[key] !== expectedScenarioRatio ||
          result.comparison[i].current_ratio !== result.snapshot.current_ratios[key] ||
          result.comparison[i].scenario_ratio !== expectedScenarioRatio) {
        throw { forbidden: 'simulation ratio evidence is inconsistent' };
      }
    }
    if (JSON.stringify(newDoc).length > 524288) {
      throw { forbidden: 'simulation document is too large' };
    }
  }
  // 2. donation status is forward-only — no going back to declared
  if (newDoc.type === 'donation' && oldDoc) {
    if (oldDoc.status === 'received' && newDoc.status === 'declared') {
      throw { forbidden: 'Cannot revert donation status back to declared' };
    }
  }
  // 3. only warehouse staff / managers may write stock
  if (newDoc.type === 'stock_ledger') {
    var isStaff =
      userCtx.roles.indexOf('warehouse_staff') !== -1 ||
      userCtx.roles.indexOf('shelter_manager') !== -1 ||
      userCtx.roles.indexOf('system_admin') !== -1;
    if (!isStaff) {
      throw { forbidden: 'Only warehouse staff or managers can write stock ledger' };
    }
  }
}`;
}
