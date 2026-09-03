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
  // §2.7 meal_service, §2.7.2 gas_ledger (CR-086), §6.2 stock_ledger / audit
  var appendOnly = [
    'stock_ledger', 'audit', 'movement', 'screening', 'people_import_log',
    'kitchen_requisition', 'meal_service', 'gas_ledger'
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
  // Volunteers (CR-092/CR-094/CR-095, schema.md §2.8/§2.9/§2.17/§2.18) was
  // missing here entirely too — same class of bug: the back-office volunteers
  // UI shipped and worked in dev only because dev testing used an _admin
  // session; any real session-staff write (walk-in registration, job
  // create/dispatch, check-in/out, identity approval) 403'd with
  // "doc type not allowed yet" (bug found + fixed as CR-096).
  // volunteer_transfer (schema.md §2.20) was cut entirely by CR-104
  // AC-104-10 -- cross-shelter transfer no longer exists; a volunteer applies
  // directly to any shelter's jobs via the Job Board instead.
  var allowed = [
    'evacuee', 'household', 'medical', 'screening', 'movement', 'image',
    'people_import_log',
    'donation', 'donation_campaign', 'stock_ledger', 'donation_slot', 'donation_redirect',
    'audit', 'daily_calc', 'simulation', 'purchase', 'referral',
    'meal_plan', 'kitchen_requisition', 'meal_service', 'gas_cylinder_type', 'gas_ledger',
    'volunteer', 'job', 'job_application', 'shift_assignment',
    'item_category', 'item_master', 'recipe',
    'requirement_group', 'food_sphere_standard', 'replenishment_policy', 'sop_override'
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
