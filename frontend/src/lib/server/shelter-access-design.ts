/**
 * CouchDB `_design/access` helpers for per-shelter databases.
 * Shared by provisioning (+server.ts) and admin redeploy (shelters.admin.ts).
 */

// Keep this server/seed helper domain-only. Importing the feature barrel pulls
// Svelte/TanStack modules into Node-only scripts such as `pnpm seed`.
import { SOP_RATIO_KEYS, SOP_RATIO_KIND } from '$lib/features/sop-ratios/server';

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

/** Mango index definitions required by stock_transfer list/find (CR-059). */
export const TRANSFER_MANGO_INDEXES = [
	{
		index: { fields: ['type', 'status'] },
		name: 'transfer-type-status-idx',
		type: 'json' as const
	},
	{
		index: { fields: ['type', 'from_shelter', 'created_at'] },
		name: 'transfer-type-fromshelter-created-idx',
		type: 'json' as const
	},
	{
		index: { fields: ['type', 'to_shelter', 'created_at'] },
		name: 'transfer-type-toshelter-created-idx',
		type: 'json' as const
	},
	{
		index: { fields: [{ type: 'desc' }, { created_at: 'desc' }] },
		name: 'transfer-list-created-desc-idx',
		type: 'json' as const
	},
	{
		index: { fields: [{ type: 'asc' }, { created_at: 'asc' }] },
		name: 'transfer-list-created-asc-idx',
		type: 'json' as const
	},
	{
		index: { fields: [{ type: 'desc' }, { status: 'desc' }, { created_at: 'desc' }] },
		name: 'transfer-list-status-created-desc-idx',
		type: 'json' as const
	}
];

/**
 * Mango index definitions required by `stock_ledger` `_find` lookups on a *shelter* DB
 * (CR-059 T-13) — `TransferServerRepository.assertSufficientStock`'s `item_id: { $in }`
 * balance check and `ledgerAlreadyWritten`'s `ref_id` + `item_id` + `reason` idempotency
 * check. `stock_ledger` is append-only (grows unbounded), so without these, both queries
 * fall back to a full DB scan as a shelter's ledger history grows.
 */
export const TRANSFER_LEDGER_MANGO_INDEXES = [
	{
		index: { fields: ['type', 'item_id'] },
		name: 'ledger-type-itemid-idx',
		type: 'json' as const
	},
	{
		index: { fields: ['type', 'ref_id', 'item_id', 'reason'] },
		name: 'ledger-type-refid-itemid-reason-idx',
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
	const simulationResourceKinds = JSON.stringify(SOP_RATIO_KIND);
	return `function (newDoc, oldDoc, userCtx) {
  if (userCtx.roles.indexOf('_admin') !== -1) return;
  // schema.md §1.4 movement, §1.5 screening, §1.7 people_import_log, §2.6 kitchen_requisition,
  // §2.7 meal_service, §2.7.2 gas_ledger (CR-086), §6.2 stock_ledger / audit, CR-059 Phase 3B distribution_issue
  var appendOnly = [
    'stock_ledger', 'audit', 'movement', 'screening', 'people_import_log',
    'kitchen_requisition', 'meal_service', 'gas_ledger', 'distribution_issue',
    'distribution_issue_idempotency'
  ];
  var wasAppendOnly = oldDoc && appendOnly.indexOf(oldDoc.type) !== -1;
  if (newDoc._deleted) {
    if (oldDoc && oldDoc.type === 'simulation') {
      var canDeleteSimulation =
        userCtx.roles.indexOf('shelter_manager') !== -1 ||
        userCtx.roles.indexOf('system_admin') !== -1;
      if (!canDeleteSimulation) {
        throw { forbidden: 'Only shelter managers or system admins can delete simulations' };
      }
      if (newDoc._id !== oldDoc._id || oldDoc.shelter_code !== '${code}') {
        throw { forbidden: 'Simulation delete context is invalid' };
      }
      return;
    }
    var protectedCoordinationDelete = oldDoc && [
      'distribution_issue_idempotency', 'distribution_issue_capacity', 'distribution_one_time_guard'
    ].indexOf(oldDoc.type) !== -1;
    if (wasAppendOnly || protectedCoordinationDelete) {
      throw { forbidden: 'Cannot delete append-only ' + oldDoc.type + ' documents' };
    }
    return;
  }
  // Base append-only policy on the persisted document identity as well as the
  // proposed type so an update cannot evade the guard by changing the type field.
  if (wasAppendOnly) {
    throw { forbidden: 'Cannot update append-only ' + oldDoc.type + ' documents' };
  }
  if (oldDoc && newDoc.type !== oldDoc.type) {
    throw { forbidden: 'Cannot change type of ' + oldDoc.type + ' document' };
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
    'audit', 'daily_calc', 'simulation', 'purchase', 'referral',
    'meal_plan', 'kitchen_requisition', 'meal_service', 'gas_cylinder_type', 'gas_ledger',
    'item_category', 'item_master', 'recipe',
    'requirement_group', 'food_sphere_standard', 'replenishment_policy', 'sop_override',
    'distribution_request', 'distribution_batch', 'stock_lot_reservation',
    'distribution_issue', 'distribution_issue_idempotency', 'distribution_issue_capacity', 'distribution_one_time_guard'
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
    function isObject(value) {
      return value !== null && typeof value === 'object' && !Array.isArray(value);
    }
    function owns(object, key) {
      return Object.prototype.hasOwnProperty.call(object, key);
    }
    function hasExactFields(object, fields) {
      if (!isObject(object) || Object.keys(object).length !== fields.length) return false;
      for (var fieldIndex = 0; fieldIndex < fields.length; fieldIndex++) {
        if (!owns(object, fields[fieldIndex])) return false;
      }
      return true;
    }
    function isInteger(value, minimum) {
      return typeof value === 'number' && isFinite(value) && Math.floor(value) === value && value >= minimum;
    }
    function isDecimal(value, allowZero) {
      if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$/.test(value)) return false;
      var number = Number(value);
      return isFinite(number) && (allowZero ? number >= 0 : number > 0);
    }
    function isNullableDecimal(value, allowNegative) {
      if (value === null) return true;
      if (typeof value !== 'string' || !/^-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$/.test(value)) return false;
      var number = Number(value);
      return isFinite(number) && (allowNegative || number >= 0);
    }
    function isIsoDate(value) {
      return typeof value === 'string' && /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z$/.test(value);
    }
    function hasCanonicalKeys(object, keys) {
      if (!isObject(object) || Object.keys(object).length !== keys.length) return false;
      for (var keyIndex = 0; keyIndex < keys.length; keyIndex++) {
        if (!owns(object, keys[keyIndex])) return false;
      }
      return true;
    }
    function validKind(value) {
      return value === 'multiply' || value === 'divide' || value === 'threshold';
    }
    function validDataStatus(value) {
      return value === 'complete' || value === 'ratio_missing' || value === 'stock_unsynced' || value === 'invalid_input';
    }
    function validResourceStatus(value) {
      return value === 'ok' || value === 'gap' || value === 'surplus' || value === 'constraint' || value === 'insufficient_data';
    }
    function validDailyRow(row, key, ordinal, kind, ratio, have, asOf) {
      return hasExactFields(row, ['ordinal', 'key', 'kind', 'input_valid', 'ratio', 'need', 'have', 'gap', 'status', 'data_status', 'as_of']) &&
        row.key === key && row.ordinal === ordinal && row.kind === kind &&
        typeof row.input_valid === 'boolean' && (row.ratio === null || isDecimal(row.ratio, false)) &&
        row.ratio === ratio && isNullableDecimal(row.need, false) && isNullableDecimal(row.have, false) &&
        row.have === have && isNullableDecimal(row.gap, true) && validResourceStatus(row.status) &&
        validDataStatus(row.data_status) && row.as_of === asOf;
    }
    function validHorizonRow(row, key, kind, dailyNeed, have) {
      return hasExactFields(row, ['key', 'kind', 'daily_need', 'horizon_need', 'have', 'horizon_gap']) &&
        row.key === key && row.kind === kind && row.daily_need === dailyNeed &&
        isNullableDecimal(row.horizon_need, false) && row.have === have &&
        isNullableDecimal(row.horizon_gap, true);
    }
    if (!isObject(result)) {
      throw { forbidden: 'simulation result is required' };
    }
    if (!hasExactFields(result, ['input', 'snapshot', 'current', 'scenario', 'comparison']) ||
        !hasExactFields(result.input, ['name', 'occupancy', 'days', 'ratio_overrides']) ||
        !hasExactFields(result.snapshot, ['shelter_code', 'as_of', 'formula_v', 'profile', 'current_occupancy', 'current_ratios', 'resource_inputs', 'stock_snapshot']) ||
        !hasExactFields(result.current, ['occupancy', 'ratios', 'daily_results', 'horizon_results']) ||
        !hasExactFields(result.scenario, ['occupancy', 'ratios', 'daily_results', 'horizon_results']) ||
        !Array.isArray(result.comparison)) {
      throw { forbidden: 'simulation result shape is incomplete' };
    }
    if (!isIsoDate(newDoc.created_at) || !isIsoDate(newDoc.updated_at)) {
      throw { forbidden: 'simulation timestamps are invalid' };
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
    var simulationKinds = ${simulationResourceKinds};
    for (var overrideKey in result.input.ratio_overrides) {
      if (simulationKeys.indexOf(overrideKey) === -1 ||
          typeof result.input.ratio_overrides[overrideKey] !== 'string' ||
          !isDecimal(result.input.ratio_overrides[overrideKey], false)) {
        throw { forbidden: 'simulation ratio override is invalid' };
      }
    }
    if (result.current.occupancy !== result.snapshot.current_occupancy ||
        result.scenario.occupancy !== result.input.occupancy) {
      throw { forbidden: 'simulation occupancy evidence is inconsistent' };
    }
    if (!isIsoDate(result.snapshot.as_of) || typeof result.snapshot.formula_v !== 'string' ||
        result.snapshot.formula_v.length === 0 || !isObject(result.snapshot.profile) ||
        !isInteger(result.snapshot.current_occupancy, 0) ||
        !hasCanonicalKeys(result.snapshot.current_ratios, simulationKeys) ||
        !hasCanonicalKeys(result.snapshot.stock_snapshot, simulationKeys) ||
        !Array.isArray(result.snapshot.resource_inputs) ||
        !hasCanonicalKeys(result.current.ratios, simulationKeys) ||
        !hasCanonicalKeys(result.scenario.ratios, simulationKeys)) {
      throw { forbidden: 'simulation snapshot inputs are incomplete' };
    }
    var profile = result.snapshot.profile;
    if (!hasExactFields(profile, ['effective_id', 'effective_version', 'ratio_source', 'base_profile_id', 'override_id', 'override_version'])) {
      throw { forbidden: 'simulation profile snapshot is invalid' };
    }
    var profileShapeValid = typeof profile.effective_id === 'string' && profile.effective_id.length > 0 &&
      isInteger(profile.effective_version, 1) &&
      (profile.ratio_source === 'master' || profile.ratio_source === 'override');
    if (profile.ratio_source === 'master') {
      profileShapeValid = profileShapeValid && profile.base_profile_id === null &&
        profile.override_id === null && profile.override_version === null;
    } else {
      profileShapeValid = profileShapeValid && typeof profile.base_profile_id === 'string' &&
        profile.base_profile_id.length > 0 && typeof profile.override_id === 'string' &&
        profile.override_id.length > 0 && isInteger(profile.override_version, 1) &&
        profile.effective_id === profile.override_id &&
        profile.effective_version === profile.override_version;
    }
    if (!profileShapeValid) {
      throw { forbidden: 'simulation profile snapshot is invalid' };
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
      var inputRow = result.snapshot.resource_inputs[i];
      var currentDaily = result.current.daily_results[i];
      var scenarioDaily = result.scenario.daily_results[i];
      var currentHorizon = result.current.horizon_results[i];
      var scenarioHorizon = result.scenario.horizon_results[i];
      var comparison = result.comparison[i];
      if (!isDecimal(result.snapshot.current_ratios[key], false) ||
          !isNullableDecimal(result.snapshot.stock_snapshot[key], false) ||
          !hasExactFields(inputRow, ['key', 'kind', 'ratio', 'have']) ||
          inputRow.key !== key || !validKind(inputRow.kind) ||
          inputRow.kind !== simulationKinds[key] ||
          inputRow.ratio !== result.snapshot.current_ratios[key] ||
          inputRow.have !== result.snapshot.stock_snapshot[key] ||
          !validDailyRow(currentDaily, key, i, inputRow.kind, result.snapshot.current_ratios[key], inputRow.have, result.snapshot.as_of) ||
          !validDailyRow(scenarioDaily, key, i, inputRow.kind, expectedScenarioRatio, inputRow.have, result.snapshot.as_of) ||
          !validHorizonRow(currentHorizon, key, inputRow.kind, currentDaily.need, inputRow.have) ||
          !validHorizonRow(scenarioHorizon, key, inputRow.kind, scenarioDaily.need, inputRow.have) ||
          !hasExactFields(comparison, ['key', 'kind', 'current_ratio', 'scenario_ratio', 'ratio_overridden', 'current_daily_need', 'scenario_daily_need', 'current_horizon_need', 'scenario_horizon_need', 'have', 'current_horizon_gap', 'scenario_horizon_gap', 'need_delta', 'gap_delta', 'current_data_status', 'scenario_data_status']) ||
          comparison.key !== key || comparison.kind !== inputRow.kind) {
        throw { forbidden: 'simulation result resource order is invalid' };
      }
      if (result.current.ratios[key] !== result.snapshot.current_ratios[key] ||
          result.scenario.ratios[key] !== expectedScenarioRatio ||
          comparison.current_ratio !== result.snapshot.current_ratios[key] ||
          comparison.scenario_ratio !== expectedScenarioRatio ||
          comparison.ratio_overridden !== owns(result.input.ratio_overrides, key) ||
          comparison.current_daily_need !== currentDaily.need ||
          comparison.scenario_daily_need !== scenarioDaily.need ||
          comparison.current_horizon_need !== currentHorizon.horizon_need ||
          comparison.scenario_horizon_need !== scenarioHorizon.horizon_need ||
          comparison.have !== inputRow.have ||
          comparison.current_horizon_gap !== currentHorizon.horizon_gap ||
          comparison.scenario_horizon_gap !== scenarioHorizon.horizon_gap ||
          !isNullableDecimal(comparison.need_delta, true) ||
          !isNullableDecimal(comparison.gap_delta, true) ||
          !validDataStatus(comparison.current_data_status) ||
          !validDataStatus(comparison.scenario_data_status)) {
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
    var isWarehouseOrAdmin =
      userCtx.roles.indexOf('warehouse_staff') !== -1 ||
      userCtx.roles.indexOf('system_admin') !== -1;
    var isStaff = isWarehouseOrAdmin || userCtx.roles.indexOf('shelter_manager') !== -1;
    if (!isStaff) {
      throw { forbidden: 'Only warehouse staff or managers can write stock ledger' };
    }
    if (newDoc.reason === 'distribute' && !isWarehouseOrAdmin) {
      throw { forbidden: 'Only warehouse staff or system admin can write distribute stock ledger' };
    }
    if (newDoc.reason === 'distribute') {
      if (typeof newDoc.ref_id !== 'string' || !/^distribution_batch:.+/.test(newDoc.ref_id)) {
        throw { forbidden: 'Distribute stock ledger requires distribution_batch ref_id' };
      }
      if (typeof newDoc.lot_ref !== 'string' || !/^stock_ledger:.+/.test(newDoc.lot_ref)) {
        throw { forbidden: 'Distribute stock ledger requires physical stock_ledger lot_ref' };
      }
      if (typeof newDoc.qty !== 'string' || !/^-\\d+(\\.\\d{1,4})?$/.test(newDoc.qty)) {
        throw { forbidden: 'Distribute stock ledger qty must be a negative decimal string' };
      }
    }
  }
  // 4. distribution_request lifecycle and role rules
  if (newDoc.type === 'distribution_request') {
    var isWarehouseOrAdminReq =
      userCtx.roles.indexOf('warehouse_staff') !== -1 ||
      userCtx.roles.indexOf('system_admin') !== -1;
    var isRequestEditor =
      userCtx.roles.indexOf('registration_staff') !== -1 ||
      userCtx.roles.indexOf('shelter_manager') !== -1 ||
      userCtx.roles.indexOf('system_admin') !== -1;
    if (!oldDoc) {
      if (newDoc.status !== 'pending') {
        throw { forbidden: 'New distribution_request must start pending' };
      }
      if (!isRequestEditor) {
        throw { forbidden: 'Only registration staff, shelter manager, or system admin can create distribution requests' };
      }
    }
    if (oldDoc) {
      if (newDoc._id !== oldDoc._id) throw { forbidden: 'Cannot change _id' };
      if (newDoc.type !== oldDoc.type) throw { forbidden: 'Cannot change type' };
      if (newDoc.shelter_code !== oldDoc.shelter_code) throw { forbidden: 'Cannot change shelter_code' };
      var fromStatus = oldDoc.status;
      var toStatus = newDoc.status;
      var validTransitions = {
        pending: ['approving', 'rejected', 'cancelled'],
        approving: ['approved', 'pending'],
        approved: [],
        rejected: [],
        cancelled: []
      };
      var allowedNext = validTransitions[fromStatus] || [];
      if (fromStatus !== toStatus && allowedNext.indexOf(toStatus) === -1) {
        throw { forbidden: 'Invalid distribution_request transition from ' + fromStatus + ' to ' + toStatus };
      }
      if (fromStatus === 'approved' || fromStatus === 'rejected' || fromStatus === 'cancelled') {
        throw { forbidden: 'Terminal distribution_request cannot be modified' };
      }
      // Once a request has left pending, no transition (including rollback)
      // may change the immutable business payload in the same write.
      if (fromStatus !== 'pending') {
        if (JSON.stringify(newDoc.items) !== JSON.stringify(oldDoc.items)) {
          throw { forbidden: 'Cannot modify items on non-pending distribution_request' };
        }
        if (newDoc.purpose !== oldDoc.purpose) {
          throw { forbidden: 'Cannot modify purpose on non-pending distribution_request' };
        }
        if (newDoc.active_headcount_snapshot !== oldDoc.active_headcount_snapshot) {
          throw { forbidden: 'Cannot modify active_headcount_snapshot on non-pending distribution_request' };
        }
        if (newDoc.buffer_percent !== oldDoc.buffer_percent) {
          throw { forbidden: 'Cannot modify buffer_percent on non-pending distribution_request' };
        }
      }
      if (fromStatus === 'approving') {
        if (toStatus === 'pending') {
          if (typeof newDoc.approval_operation_id !== 'undefined' && newDoc.approval_operation_id !== oldDoc.approval_operation_id) {
            throw { forbidden: 'Cannot replace approval_operation_id during rollback' };
          }
        } else if (!oldDoc.approval_operation_id || newDoc.approval_operation_id !== oldDoc.approval_operation_id) {
          throw { forbidden: 'Cannot replace approval_operation_id once approval is in progress' };
        }
      }
      if (fromStatus === 'pending' && toStatus === 'pending' && !isRequestEditor) {
        throw { forbidden: 'Only authorized request editors can edit pending distribution requests' };
      }
      if ((toStatus === 'approving' || toStatus === 'approved' || toStatus === 'rejected' || (fromStatus === 'approving' && toStatus === 'pending')) && !isWarehouseOrAdminReq) {
        throw { forbidden: 'Only warehouse staff or system admin can approve or reject distribution requests' };
      }
      if (fromStatus === 'pending' && toStatus === 'approving' && (typeof newDoc.approval_operation_id !== 'string' || !newDoc.approval_operation_id)) {
        throw { forbidden: 'Approving distribution_request requires approval_operation_id' };
      }
    }
    if (newDoc.status === 'approved' && (typeof newDoc.batch_id !== 'string' || !/^distribution_batch:.+/.test(newDoc.batch_id))) {
      throw { forbidden: 'Approved distribution_request must include valid batch_id' };
    }
  }
  // 5. distribution_batch lifecycle and role rules
  if (newDoc.type === 'distribution_batch') {
    var isWarehouseOrAdminBatch =
      userCtx.roles.indexOf('warehouse_staff') !== -1 ||
      userCtx.roles.indexOf('system_admin') !== -1;
    if (!isWarehouseOrAdminBatch) {
      throw { forbidden: 'Only warehouse staff or system admin can manage distribution batches' };
    }
    if (!oldDoc && newDoc.status !== 'activating') {
      throw { forbidden: 'New distribution_batch must start activating' };
    }
    if (oldDoc) {
      if (newDoc._id !== oldDoc._id) throw { forbidden: 'Cannot change _id' };
      if (newDoc.type !== oldDoc.type) throw { forbidden: 'Cannot change type' };
      if (newDoc.shelter_code !== oldDoc.shelter_code) throw { forbidden: 'Cannot change shelter_code' };
      if (newDoc.request_id !== oldDoc.request_id) {
        throw { forbidden: 'Cannot change request_id on distribution_batch' };
      }
      if (JSON.stringify(newDoc.items) !== JSON.stringify(oldDoc.items)) {
        throw { forbidden: 'Cannot modify items on distribution_batch' };
      }
      if (JSON.stringify(newDoc.allocations) !== JSON.stringify(oldDoc.allocations)) {
        throw { forbidden: 'Cannot modify allocations on distribution_batch' };
      }
      if (oldDoc.status === 'activating' && newDoc.status !== 'active') {
        throw { forbidden: 'Activating batch can only transition to active' };
      }
      if (oldDoc.status === 'active' && newDoc.status !== 'active') {
        throw { forbidden: 'Active batch status cannot be changed' };
      }
    }
  }
  // 6. stock_lot_reservation role rules
  if (newDoc.type === 'stock_lot_reservation') {
    var isWarehouseOrAdminRes =
      userCtx.roles.indexOf('warehouse_staff') !== -1 ||
      userCtx.roles.indexOf('system_admin') !== -1;
    if (!isWarehouseOrAdminRes) {
      throw { forbidden: 'Only warehouse staff or system admin can manage stock lot reservations' };
    }
    if (typeof newDoc.lot_ref !== 'string' || !/^stock_ledger:.+/.test(newDoc.lot_ref)) {
      throw { forbidden: 'stock_lot_reservation requires stock_ledger lot_ref' };
    }
    if (!Array.isArray(newDoc.pending_claims)) {
      throw { forbidden: 'stock_lot_reservation pending_claims must be an array' };
    }
    for (var claimIndex = 0; claimIndex < newDoc.pending_claims.length; claimIndex++) {
      var claim = newDoc.pending_claims[claimIndex];
      if (!claim || typeof claim.operation_id !== 'string' || !claim.operation_id ||
          typeof claim.request_id !== 'string' || !/^distribution_request:.+/.test(claim.request_id) ||
          typeof claim.batch_id !== 'string' || !/^distribution_batch:.+/.test(claim.batch_id) ||
          typeof claim.item_id !== 'string' || !claim.item_id ||
          typeof claim.lot_ref !== 'string' || claim.lot_ref !== newDoc.lot_ref ||
          typeof claim.qty !== 'string' || !/^(?:0\\.(?:0*[1-9]\\d{0,3})|[1-9]\\d*(?:\\.\\d{1,4})?)$/.test(claim.qty) ||
          typeof claim.claimed_at !== 'string' || isNaN(Date.parse(claim.claimed_at))) {
        throw { forbidden: 'stock_lot_reservation contains invalid pending claim' };
      }
    }
    if (oldDoc) {
      if (newDoc._id !== oldDoc._id) throw { forbidden: 'Cannot change _id' };
      if (newDoc.type !== oldDoc.type) throw { forbidden: 'Cannot change type' };
      if (newDoc.shelter_code !== oldDoc.shelter_code) throw { forbidden: 'Cannot change shelter_code' };
      if (newDoc.lot_ref !== oldDoc.lot_ref) {
        throw { forbidden: 'Cannot change lot_ref on stock_lot_reservation' };
      }
    }
  }
  // 7. distribution_issue role and validation rules (CR-059 Phase 3B)
  if (newDoc.type === 'distribution_issue') {
    var isIssueStaff =
      userCtx.roles.indexOf('registration_staff') !== -1 ||
      userCtx.roles.indexOf('shelter_manager') !== -1 ||
      userCtx.roles.indexOf('system_admin') !== -1;
    if (!isIssueStaff) {
      throw { forbidden: 'Only registration staff, shelter manager, or system admin can write distribution issues' };
    }
    if (typeof newDoc._id !== 'string' || !/^distribution_issue:[0-9A-HJKMNP-TV-Z]{26}$/.test(newDoc._id)) {
      throw { forbidden: 'distribution_issue requires valid ULID id distribution_issue:{ulid}' };
    }
    if (typeof newDoc.batch_id !== 'string' || !/^distribution_batch:.+/.test(newDoc.batch_id)) {
      throw { forbidden: 'distribution_issue requires valid batch_id' };
    }
    if (typeof newDoc.evacuee_id !== 'string' || !/^evacuee:.+/.test(newDoc.evacuee_id)) {
      throw { forbidden: 'distribution_issue requires valid evacuee_id' };
    }
    if (typeof newDoc.item_id !== 'string' || !newDoc.item_id) {
      throw { forbidden: 'distribution_issue requires non-empty item_id' };
    }
    if (typeof newDoc.qty !== 'string' || !/^(?:0\\.(?:0*[1-9]\\d{0,3})|[1-9]\\d*(?:\\.\\d{1,4})?)$/.test(newDoc.qty)) {
      throw { forbidden: 'distribution_issue requires positive qty decimal string' };
    }
    if (typeof newDoc.unit !== 'string' || !newDoc.unit) {
      throw { forbidden: 'distribution_issue requires non-empty unit' };
    }
    if (newDoc.distribution_type_snapshot !== 'consumable' && newDoc.distribution_type_snapshot !== 'one_time') {
      throw { forbidden: 'distribution_issue requires valid distribution_type_snapshot' };
    }
    if (!newDoc.eligibility_snapshot || typeof newDoc.eligibility_snapshot !== 'object') {
      throw { forbidden: 'distribution_issue requires eligibility_snapshot object' };
    }
    var snapshot = newDoc.eligibility_snapshot;
    if (snapshot.eligible !== true ||
        snapshot.distribution_type !== newDoc.distribution_type_snapshot ||
        typeof snapshot.had_previous_receipt !== 'boolean' ||
        typeof snapshot.previous_receipt_count !== 'number' ||
        snapshot.previous_receipt_count < 0 ||
        Math.floor(snapshot.previous_receipt_count) !== snapshot.previous_receipt_count ||
        snapshot.had_previous_receipt !== (snapshot.previous_receipt_count > 0)) {
      throw { forbidden: 'distribution_issue eligibility_snapshot is structurally invalid' };
    }
    var issueReason = newDoc.repeat_override_reason;
    var snapshotReason = snapshot.repeat_override_reason;
    if (issueReason !== snapshotReason) {
      throw { forbidden: 'distribution_issue repeat_override_reason must match eligibility_snapshot' };
    }
    if (newDoc.distribution_type_snapshot === 'consumable') {
      if (snapshot.decision !== 'consumable' || issueReason) throw { forbidden: 'Invalid consumable eligibility snapshot' };
    } else if (snapshot.decision === 'first_receipt') {
      if (snapshot.had_previous_receipt || snapshot.previous_receipt_count !== 0 || issueReason) throw { forbidden: 'Invalid first_receipt eligibility snapshot' };
    } else if (snapshot.decision === 'repeat_override') {
      if (!snapshot.had_previous_receipt || snapshot.previous_receipt_count <= 0 ||
          (issueReason !== 'lost' && issueReason !== 'damaged')) throw { forbidden: 'Invalid repeat_override eligibility snapshot' };
    } else {
      throw { forbidden: 'distribution_issue eligibility_snapshot decision is invalid' };
    }
    if (typeof newDoc.idempotency_key !== 'string' || !newDoc.idempotency_key) {
      throw { forbidden: 'distribution_issue requires non-empty idempotency_key' };
    }
    if (typeof newDoc.distributed_by !== 'string' || !newDoc.distributed_by) {
      throw { forbidden: 'distribution_issue requires non-empty distributed_by' };
    }
  }
  // 8. distribution_issue_idempotency role and validation rules (CR-059 Phase 3B)
  if (newDoc.type === 'distribution_issue_idempotency') {
    var isIssueStaffIdem =
      userCtx.roles.indexOf('registration_staff') !== -1 ||
      userCtx.roles.indexOf('shelter_manager') !== -1 ||
      userCtx.roles.indexOf('system_admin') !== -1;
    if (!isIssueStaffIdem) {
      throw { forbidden: 'Only registration staff, shelter manager, or system admin can manage issue idempotency' };
    }
    if (typeof newDoc._id !== 'string' || !/^distribution_issue_idempotency:[0-9a-f]{64}$/.test(newDoc._id)) {
      throw { forbidden: 'distribution_issue_idempotency requires deterministic SHA-256 id' };
    }
    if (typeof newDoc.batch_id !== 'string' || !/^distribution_batch:.+/.test(newDoc.batch_id)) {
      throw { forbidden: 'distribution_issue_idempotency requires valid batch_id' };
    }
    if (typeof newDoc.idempotency_key !== 'string' || !newDoc.idempotency_key) {
      throw { forbidden: 'distribution_issue_idempotency requires non-empty idempotency_key' };
    }
    if (typeof newDoc.issue_id !== 'string' || !/^distribution_issue:[0-9A-HJKMNP-TV-Z]{26}$/.test(newDoc.issue_id)) {
      throw { forbidden: 'distribution_issue_idempotency requires valid issue_id' };
    }
    if (typeof newDoc.evacuee_id !== 'string' || !/^evacuee:.+/.test(newDoc.evacuee_id)) {
      throw { forbidden: 'distribution_issue_idempotency requires valid evacuee_id' };
    }
    if (typeof newDoc.item_id !== 'string' || !newDoc.item_id) {
      throw { forbidden: 'distribution_issue_idempotency requires non-empty item_id' };
    }
    if (typeof newDoc.qty !== 'string' || !/^(?:0\\.(?:0*[1-9]\\d{0,3})|[1-9]\\d*(?:\\.\\d{1,4})?)$/.test(newDoc.qty)) {
      throw { forbidden: 'distribution_issue_idempotency requires positive qty decimal string' };
    }
    if (oldDoc) {
      throw { forbidden: 'distribution_issue_idempotency is immutable after creation' };
    }
  }
  // 9. distribution_issue_capacity role and validation rules (CR-059 Phase 3B)
  if (newDoc.type === 'distribution_issue_capacity') {
    var isIssueStaffCap =
      userCtx.roles.indexOf('registration_staff') !== -1 ||
      userCtx.roles.indexOf('shelter_manager') !== -1 ||
      userCtx.roles.indexOf('system_admin') !== -1;
    if (!isIssueStaffCap) {
      throw { forbidden: 'Only registration staff, shelter manager, or system admin can manage issue capacity' };
    }
    if (typeof newDoc._id !== 'string' || !/^distribution_issue_capacity:[0-9a-f]{64}$/.test(newDoc._id)) {
      throw { forbidden: 'distribution_issue_capacity requires deterministic SHA-256 id' };
    }
    if (typeof newDoc.batch_id !== 'string' || !/^distribution_batch:.+/.test(newDoc.batch_id)) {
      throw { forbidden: 'distribution_issue_capacity requires valid batch_id' };
    }
    if (typeof newDoc.item_id !== 'string' || !newDoc.item_id) {
      throw { forbidden: 'distribution_issue_capacity requires non-empty item_id' };
    }
    if (!Array.isArray(newDoc.pending_claims)) {
      throw { forbidden: 'distribution_issue_capacity pending_claims must be an array' };
    }
    for (var capIndex = 0; capIndex < newDoc.pending_claims.length; capIndex++) {
      var capClaim = newDoc.pending_claims[capIndex];
      if (!capClaim || typeof capClaim.operation_id !== 'string' || !capClaim.operation_id ||
          typeof capClaim.issue_id !== 'string' || !/^distribution_issue:[0-9A-HJKMNP-TV-Z]{26}$/.test(capClaim.issue_id) ||
          typeof capClaim.batch_id !== 'string' || capClaim.batch_id !== newDoc.batch_id ||
          typeof capClaim.item_id !== 'string' || capClaim.item_id !== newDoc.item_id ||
          typeof capClaim.qty !== 'string' || !/^(?:0\\.(?:0*[1-9]\\d{0,3})|[1-9]\\d*(?:\\.\\d{1,4})?)$/.test(capClaim.qty) ||
          typeof capClaim.claimed_at !== 'string' || isNaN(Date.parse(capClaim.claimed_at))) {
        throw { forbidden: 'distribution_issue_capacity contains invalid pending claim' };
      }
      for (var priorCapIndex = 0; priorCapIndex < capIndex; priorCapIndex++) {
        if (newDoc.pending_claims[priorCapIndex].operation_id === capClaim.operation_id) {
          throw { forbidden: 'distribution_issue_capacity cannot contain duplicate operation_id' };
        }
      }
    }
    if (oldDoc) {
      if (newDoc._id !== oldDoc._id) throw { forbidden: 'Cannot change _id' };
      if (newDoc.type !== oldDoc.type) throw { forbidden: 'Cannot change type' };
      if (newDoc.shelter_code !== oldDoc.shelter_code) throw { forbidden: 'Cannot change shelter_code' };
      if (newDoc.batch_id !== oldDoc.batch_id) throw { forbidden: 'Cannot change batch_id on capacity record' };
      if (newDoc.item_id !== oldDoc.item_id) throw { forbidden: 'Cannot change item_id on capacity record' };
    }
  }
  // 10. distribution_one_time_guard role and validation rules (CR-059 Phase 3B)
  if (newDoc.type === 'distribution_one_time_guard') {
    var isIssueStaffGuard =
      userCtx.roles.indexOf('registration_staff') !== -1 ||
      userCtx.roles.indexOf('shelter_manager') !== -1 ||
      userCtx.roles.indexOf('system_admin') !== -1;
    if (!isIssueStaffGuard) {
      throw { forbidden: 'Only registration staff, shelter manager, or system admin can manage one-time guard' };
    }
    if (typeof newDoc._id !== 'string' || !/^distribution_one_time_guard:[0-9a-f]{64}$/.test(newDoc._id)) {
      throw { forbidden: 'distribution_one_time_guard requires deterministic SHA-256 id' };
    }
    if (typeof newDoc.evacuee_id !== 'string' || !/^evacuee:.+/.test(newDoc.evacuee_id)) {
      throw { forbidden: 'distribution_one_time_guard requires valid evacuee_id' };
    }
    if (typeof newDoc.item_id !== 'string' || !newDoc.item_id) {
      throw { forbidden: 'distribution_one_time_guard requires non-empty item_id' };
    }
    if (!Array.isArray(newDoc.pending_claims)) {
      throw { forbidden: 'distribution_one_time_guard pending_claims must be an array' };
    }
    if (newDoc.pending_claims.length > 1) {
      throw { forbidden: 'distribution_one_time_guard permits at most one pending claim' };
    }
    for (var guardIndex = 0; guardIndex < newDoc.pending_claims.length; guardIndex++) {
      var guardClaim = newDoc.pending_claims[guardIndex];
      if (!guardClaim || typeof guardClaim.operation_id !== 'string' || !guardClaim.operation_id ||
          typeof guardClaim.issue_id !== 'string' || !/^distribution_issue:[0-9A-HJKMNP-TV-Z]{26}$/.test(guardClaim.issue_id) ||
          typeof guardClaim.evacuee_id !== 'string' || guardClaim.evacuee_id !== newDoc.evacuee_id ||
          typeof guardClaim.item_id !== 'string' || guardClaim.item_id !== newDoc.item_id ||
          typeof guardClaim.claimed_at !== 'string' || isNaN(Date.parse(guardClaim.claimed_at))) {
        throw { forbidden: 'distribution_one_time_guard contains invalid pending claim' };
      }
    }
    if (oldDoc) {
      if (newDoc._id !== oldDoc._id) throw { forbidden: 'Cannot change _id' };
      if (newDoc.type !== oldDoc.type) throw { forbidden: 'Cannot change type' };
      if (newDoc.shelter_code !== oldDoc.shelter_code) throw { forbidden: 'Cannot change shelter_code' };
      if (newDoc.evacuee_id !== oldDoc.evacuee_id) throw { forbidden: 'Cannot change evacuee_id on one-time guard' };
      if (newDoc.item_id !== oldDoc.item_id) throw { forbidden: 'Cannot change item_id on one-time guard' };
    }
  }
}`;
}
