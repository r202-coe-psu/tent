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

/** Mango index definitions required by Ticket & Distribution queries (schema.md §6 / §8 / CR-121). */
export const TICKET_DISTRIBUTION_MANGO_INDEXES = [
	{
		index: { fields: ['type', 'status', 'requisition_type', 'ticket_no'] },
		name: 'ticket-type-status-reqtype-ticketno-idx',
		type: 'json' as const
	},
	{
		index: { fields: ['type', 'status'] },
		name: 'ticket-type-status-idx',
		type: 'json' as const
	},
	{
		index: { fields: ['type', 'ticket_id', 'item_id', 'recipient_id', 'status'] },
		name: 'distlog-type-ticket-item-recipient-status-idx',
		type: 'json' as const
	},
	{
		index: { fields: ['type', 'recipient_id', 'status'] },
		name: 'distlog-type-recipient-status-idx',
		type: 'json' as const
	},
	{
		index: { fields: ['type', 'item_id', 'status'] },
		name: 'pool-type-itemid-status-idx',
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
  if (newDoc.type === 'unit_of_measure' || (oldDoc && oldDoc.type === 'unit_of_measure')) {
    throw { forbidden: 'unit_of_measure is central-only' };
  }
  // Compound Scoped Roles (CR-093): prefer {code}:{cap}, keep legacy bare RoleKey.
  function isRole(cap) {
    return userCtx.roles.indexOf('system_admin') !== -1 ||
      userCtx.roles.indexOf('${code}:' + cap) !== -1 ||
      userCtx.roles.indexOf(cap) !== -1;
  }
  function parseDecimal4(str) {
    if (typeof str !== 'string') return NaN;
    var s = str.trim();
    if (!/^-?\\d+(\\.\\d{1,4})?$/.test(s)) return NaN;
    var parts = s.split('.');
    var intPart = parseInt(parts[0], 10);
    var fracPart = 0;
    if (parts.length === 2) {
      fracPart = parseInt((parts[1] + '0000').slice(0, 4), 10);
    }
    var sign = (parts[0].charAt(0) === '-') ? -1 : 1;
    return intPart * 10000 + (sign * fracPart);
  }
  // Ticket-era writes are made directly by authenticated shelter clients, so
  // these document-local capability checks are the authoritative guard.
  function canCreateTicket() {
    return isRole('warehouse_staff') || isRole('supply_coordinator') || isRole('shelter_manager');
  }
  function canApproveTicket() {
    return isRole('shelter_manager');
  }
  function canDispatchTicket() {
    return isRole('warehouse_staff') || isRole('supply_coordinator') || isRole('shelter_manager');
  }
  function canPerformFrontlineDistribution() {
    return isRole('registration_staff') || isRole('supply_coordinator') || isRole('shelter_manager');
  }
  function canReceivePhysicalStock() {
    return isRole('warehouse_staff') || isRole('supply_coordinator') || isRole('shelter_manager');
  }
  function sameObjectExcept(previousObject, nextObject, ignoredFields) {
    var keys = {};
    var previousKeys = Object.keys(previousObject || {});
    var nextKeys = Object.keys(nextObject || {});
    for (var previousKeyIndex = 0; previousKeyIndex < previousKeys.length; previousKeyIndex++) {
      keys[previousKeys[previousKeyIndex]] = true;
    }
    for (var nextKeyIndex = 0; nextKeyIndex < nextKeys.length; nextKeyIndex++) {
      keys[nextKeys[nextKeyIndex]] = true;
    }
    var allKeys = Object.keys(keys);
    for (var allKeyIndex = 0; allKeyIndex < allKeys.length; allKeyIndex++) {
      var key = allKeys[allKeyIndex];
      if (ignoredFields[key]) continue;
      if ((previousObject || {})[key] !== (nextObject || {})[key]) return false;
    }
    return true;
  }
  function sameTicketItemExceptAllocation(previousItem, nextItem) {
    return sameObjectExcept(previousItem, nextItem, { allocated_qty: true });
  }
  function sameTicketPayloadExceptSelfUpdateFields(previousTicket, nextTicket) {
    return sameObjectExcept(previousTicket, nextTicket, {
      _rev: true, updated_at: true, status: true, items: true, amendments: true
    });
  }

  // schema.md §1.4 movement, §1.5 screening, §1.7 people_import_log, §2.6 kitchen_requisition,
  // §2.7 meal_service, §2.7.2 gas_ledger (CR-086), §6.2 stock_ledger / audit, CR-059 Phase 3B distribution_issue
  var appendOnly = [
    'stock_ledger', 'audit', 'movement', 'screening', 'people_import_log',
    'kitchen_requisition', 'meal_service', 'gas_ledger', 'distribution_issue',
    'distribution_issue_idempotency'
  ];
  var wasAppendOnly = oldDoc && appendOnly.indexOf(oldDoc.type) !== -1;
  if (newDoc._deleted) {
    if (oldDoc && oldDoc.type === 'distribution_batch' && oldDoc.status === 'closed') {
      throw { forbidden: 'Closed distribution_batch cannot be modified' };
    }
    if (oldDoc && oldDoc.type === 'simulation') {
      var canDeleteSimulation = isRole('shelter_manager');
      if (!canDeleteSimulation) {
        throw { forbidden: 'Only shelter managers or system admins can delete simulations' };
      }
      if (newDoc._id !== oldDoc._id || oldDoc.shelter_code !== '${code}') {
        throw { forbidden: 'Simulation delete context is invalid' };
      }
      return;
    }
    var protectedCoordinationDelete = oldDoc && [
      'distribution_issue_idempotency', 'distribution_issue_capacity', 'distribution_one_time_guard', 'distribution_issue_gate'
    ].indexOf(oldDoc.type) !== -1;
    if (oldDoc && (oldDoc.type === 'distribution_log' || oldDoc.type === 'bulk_return_claim' || oldDoc.type === 'bulk_return_pool')) {
      throw { forbidden: 'Cannot delete ' + oldDoc.type + ' documents' };
    }
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
    'audit', 'daily_calc', 'simulation', 'referral',
    'meal_plan', 'kitchen_requisition', 'meal_service', 'gas_cylinder_type', 'gas_ledger',
    'volunteer', 'job', 'job_application', 'shift_assignment',
    'item_category', 'item_master', 'recipe',
    'requirement_group', 'food_sphere_standard', 'replenishment_policy', 'sop_override',
    'distribution_request', 'distribution_batch', 'stock_lot_reservation',
    'distribution_issue', 'distribution_issue_idempotency', 'distribution_issue_capacity', 'distribution_one_time_guard', 'distribution_issue_gate',
    'daily_sop_assessment',
    'requisition_ticket', 'distribution_log', 'bulk_return_pool', 'bulk_return_claim'
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
    var canSimulate = isRole('shelter_manager');
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
  // CR-100: preserve the shelter/day identity; CouchDB _rev handles concurrent edits.
  if (newDoc.type === 'daily_sop_assessment') {
    if (oldDoc && (
        newDoc._id !== oldDoc._id ||
        newDoc.type !== oldDoc.type ||
        newDoc.shelter_code !== oldDoc.shelter_code ||
        newDoc.assessment_date !== oldDoc.assessment_date ||
        newDoc.assessed_at !== oldDoc.assessed_at ||
        newDoc.assessor_name !== oldDoc.assessor_name ||
        newDoc.created_at !== oldDoc.created_at ||
        newDoc.created_by !== oldDoc.created_by)) {
      throw { forbidden: 'Daily SOP identity and creation metadata cannot change' };
    }
    if (newDoc.schema_v !== 1 || ['InProgress', 'Completed'].indexOf(newDoc.status) === -1) {
      throw { forbidden: 'Daily SOP assessment schema/status is invalid' };
    }
    if (!/^daily_sop_assessment:[^:]+:\\d{4}-\\d{2}-\\d{2}$/.test(newDoc._id) ||
        newDoc._id !== 'daily_sop_assessment:' + newDoc.shelter_code + ':' + newDoc.assessment_date) {
      throw { forbidden: 'Daily SOP assessment id must be shelter/date deterministic' };
    }
    if (!Array.isArray(newDoc.controls) || newDoc.controls.length !== 19) {
      throw { forbidden: 'Daily SOP assessment requires 19 controls' };
    }
    var sopStatuses = ['Yes', 'No', 'Pending'];
    var sopSectionById = {
      'sop-reg-1': 'registration', 'sop-reg-2': 'registration', 'sop-reg-3': 'registration',
      'sop-vul-1': 'vulnerable', 'sop-vul-2': 'vulnerable',
      'sop-vol-1': 'volunteer', 'sop-vol-2': 'volunteer', 'sop-vol-3': 'volunteer', 'sop-vol-4': 'volunteer',
      'sop-ut-1': 'utilities', 'sop-ut-2': 'utilities', 'sop-ut-3': 'utilities', 'sop-ut-4': 'utilities', 'sop-ut-5': 'utilities', 'sop-ut-6': 'utilities',
      'sop-com-1': 'communications', 'sop-com-2': 'communications',
      'sop-db-1': 'database', 'sop-db-2': 'database'
    };
    var seenSopIds = {};
    var answeredControlCount = 0;
    var passedControlCount = 0;
    for (var controlIndex = 0; controlIndex < newDoc.controls.length; controlIndex++) {
      var control = newDoc.controls[controlIndex];
      if (!control || typeof control.id !== 'string' || typeof control.section_id !== 'string' ||
          typeof control.question !== 'string' || sopStatuses.indexOf(control.status) === -1 ||
          typeof control.answered !== 'boolean' ||
          typeof control.checked_by !== 'string' || !control.checked_by ||
          typeof control.checked_at !== 'string' || !control.checked_at ||
          !sopSectionById[control.id] || sopSectionById[control.id] !== control.section_id ||
          seenSopIds[control.id] || (!control.answered && control.status !== 'Pending')) {
        throw { forbidden: 'Daily SOP control shape/status is invalid' };
      }
      seenSopIds[control.id] = true;
      var isAnsweredControl = control.answered;
      if (isAnsweredControl) answeredControlCount++;
      if (isAnsweredControl && control.status === 'Yes') passedControlCount++;
      var oldControl = oldDoc && Array.isArray(oldDoc.controls) ? oldDoc.controls[controlIndex] : null;
      var oldHasAudit = oldControl && typeof oldControl.checked_by === 'string' &&
        typeof oldControl.checked_at === 'string';
      var statusChanged = oldControl && oldControl.status !== control.status;
      var oldAnswered = oldControl && oldControl.answered;
      var answeredChanged = oldControl && oldAnswered !== isAnsweredControl;
      var auditChanged = oldHasAudit &&
        (oldControl.checked_by !== control.checked_by || oldControl.checked_at !== control.checked_at);
      if ((!oldDoc || statusChanged || answeredChanged || auditChanged) && control.checked_by !== userCtx.name) {
        throw { forbidden: 'Daily SOP checked_by must match the authenticated user' };
      }
    }
    if (!newDoc.lifelines ||
        Object.keys(newDoc.lifelines).length !== 4 ||
        newDoc.lifelines.electricity === undefined ||
        newDoc.lifelines.water === undefined ||
        newDoc.lifelines.gas === undefined ||
        newDoc.lifelines.telecom === undefined) {
      throw { forbidden: 'Daily SOP assessment requires four lifelines' };
    }
    var lifelineStatuses = ['Operational', 'Interrupted', 'Critical'];
    var lifelineKeys = ['electricity', 'water', 'gas', 'telecom'];
    var reportedLifelineCount = 0;
    var allOperational = true;
    for (var lifelineIndex = 0; lifelineIndex < lifelineKeys.length; lifelineIndex++) {
      var lifelineStatus = newDoc.lifelines[lifelineKeys[lifelineIndex]];
      if (lifelineStatus !== null && lifelineStatuses.indexOf(lifelineStatus) === -1) {
        throw { forbidden: 'Daily SOP lifeline status is invalid' };
      }
      if (lifelineStatus !== null) reportedLifelineCount++;
      if (lifelineStatus !== 'Operational') allOperational = false;
    }
    var isCompleteDailySop = answeredControlCount === 19 && reportedLifelineCount === 4;
    if ((newDoc.status === 'Completed') !== isCompleteDailySop) {
      throw { forbidden: 'Daily SOP status must match answer completion' };
    }
    var expectedProgress = Math.round(((answeredControlCount + reportedLifelineCount) / 23) * 100);
    var expectedPass = answeredControlCount === 0 ? 0 : Math.round((passedControlCount / answeredControlCount) * 100);
    var expectedRisk = isCompleteDailySop && passedControlCount === 19 && allOperational ? 'ไม่พบความเสี่ยง' : 'พบความเสี่ยง';
    if (newDoc.progress_percent !== expectedProgress || newDoc.pass_percent !== expectedPass || newDoc.risk_label !== expectedRisk) {
      throw { forbidden: 'Daily SOP summary is inconsistent with answers' };
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
    var isWarehouseOrAdmin = isRole('warehouse_staff');
    var isStaff =
      isWarehouseOrAdmin ||
      isRole('supply_coordinator') ||
      isRole('shelter_manager');
    if (!isStaff) {
      throw { forbidden: 'Only warehouse staff or managers can write stock ledger' };
    }
    if (newDoc.reason === 'distribution_return' && !isWarehouseOrAdmin) {
      throw { forbidden: 'Only warehouse staff or system admin can write distribution return stock ledger' };
    }
    if (newDoc.reason === 'distribute') {
      if (typeof newDoc.ref_id !== 'string' || (!/^distribution_batch:.+/.test(newDoc.ref_id) && !/^requisition_ticket:.+/.test(newDoc.ref_id))) {
        throw { forbidden: 'Distribute stock ledger requires distribution_batch ref_id or requisition_ticket ref_id' };
      }
      if (/^requisition_ticket:.+/.test(newDoc.ref_id)) {
        if (!isStaff) {
          throw { forbidden: 'Only warehouse staff, supply coordinator, shelter manager, or system admin can write ticket distribute stock ledger' };
        }
      } else if (/^distribution_batch:.+/.test(newDoc.ref_id)) {
        if (!isWarehouseOrAdmin) {
          throw { forbidden: 'Only warehouse staff or system admin can write distribute stock ledger' };
        }
      }
      if (typeof newDoc.lot_ref !== 'string' || !/^stock_ledger:.+/.test(newDoc.lot_ref)) {
        throw { forbidden: 'Distribute stock ledger requires physical stock_ledger lot_ref' };
      }
      if (typeof newDoc.qty !== 'string' || !/^-\\d+(\\.\\d{1,4})?$/.test(newDoc.qty)) {
        throw { forbidden: 'Distribute stock ledger qty must be a negative decimal string' };
      }
    }
    if (newDoc.reason === 'distribution_return') {
      if (typeof newDoc.ref_id !== 'string' || !/^distribution_batch:.+/.test(newDoc.ref_id)) {
        throw { forbidden: 'Distribution return stock ledger requires distribution_batch ref_id' };
      }
      if (typeof newDoc.lot_ref !== 'string' || !/^stock_ledger:.+/.test(newDoc.lot_ref)) {
        throw { forbidden: 'Distribution return stock ledger requires physical stock_ledger lot_ref' };
      }
      if (typeof newDoc.qty !== 'string' || !/^(?:[1-9]\\d*(?:\\.\\d{1,4})?|0\\.(?!0+$)\\d{1,4})$/.test(newDoc.qty)) {
        throw { forbidden: 'Distribution return stock ledger qty must be a positive decimal string' };
      }
    }
    if (newDoc.reason === 'requisition') {
      if (typeof newDoc.ref_id !== 'string' || (!/^requisition_ticket:.+/.test(newDoc.ref_id) && !/^kitchen_requisition:.+/.test(newDoc.ref_id))) {
        throw { forbidden: 'Requisition stock ledger requires requisition_ticket or kitchen_requisition ref_id' };
      }
    }
    if (newDoc.reason === 'receive') {
      if (newDoc.ref_id !== null && typeof newDoc.ref_id !== 'undefined') {
        if (typeof newDoc.ref_id !== 'string' || (!/^meal_service:.+/.test(newDoc.ref_id) && !/^requisition_ticket:.+/.test(newDoc.ref_id) && !/^distribution_log:.+/.test(newDoc.ref_id) && !/^bulk_return_pool:[0-9A-HJKMNP-TV-Z]{26}$/.test(newDoc.ref_id))) {
          throw { forbidden: 'Receive stock ledger ref_id must reference meal_service, requisition_ticket, distribution_log, or bulk_return_pool' };
        }
      }
    }
  }
  // 4. distribution_request lifecycle and role rules
  if (newDoc.type === 'distribution_request') {
    if (Array.isArray(newDoc.items)) {
      var itemMetaMap = {};
      var requestItemIds = {};
      for (var i = 0; i < newDoc.items.length; i++) {
        var it = newDoc.items[i];
        if (it && it.item_id) {
          if (!oldDoc && requestItemIds[it.item_id]) {
            throw { forbidden: 'New distribution_request cannot contain duplicate item_id values' };
          }
          requestItemIds[it.item_id] = true;
          if (!itemMetaMap[it.item_id]) {
            itemMetaMap[it.item_id] = { unit: it.unit, type: it.distribution_type_snapshot };
          } else {
            if (itemMetaMap[it.item_id].unit !== it.unit ||
                itemMetaMap[it.item_id].type !== it.distribution_type_snapshot) {
              throw { forbidden: 'Duplicate request item rows must have identical unit and distribution_type_snapshot' };
            }
          }
        }
      }
    }
    var isWarehouseOrAdminReq = isRole('warehouse_staff');
    var isRequestEditor =
      isRole('registration_staff') ||
      isRole('shelter_manager');
    if (!oldDoc) {
      if (newDoc.status !== 'pending') {
        throw { forbidden: 'New distribution_request must start pending' };
      }
      if (!isRequestEditor) {
        throw { forbidden: 'Only registration staff, shelter manager, or system admin can create distribution requests' };
      }
      if (newDoc.created_by !== userCtx.name) {
        throw { forbidden: 'created_by must match authenticated user' };
      }
      if (newDoc.requested_by !== userCtx.name) {
        throw { forbidden: 'requested_by must match authenticated user' };
      }
      if (typeof newDoc.approval_operation_id !== 'undefined' ||
          typeof newDoc.approved_by !== 'undefined' ||
          typeof newDoc.approved_at !== 'undefined' ||
          typeof newDoc.batch_id !== 'undefined' ||
          typeof newDoc.rejected_by !== 'undefined' ||
          typeof newDoc.rejected_at !== 'undefined' ||
          typeof newDoc.rejection_reason !== 'undefined') {
        throw { forbidden: 'New distribution_request cannot contain lifecycle metadata' };
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
      if (fromStatus === 'pending' && toStatus === 'cancelled') {
        if (!isRequestEditor) {
          throw { forbidden: 'Only authorized request editors can cancel distribution requests' };
        }
        if (newDoc.created_by !== oldDoc.created_by ||
            newDoc.created_at !== oldDoc.created_at ||
            newDoc.requested_by !== oldDoc.requested_by ||
            newDoc.requested_at !== oldDoc.requested_at ||
            newDoc.purpose !== oldDoc.purpose ||
            newDoc.note !== oldDoc.note ||
            newDoc.active_headcount_snapshot !== oldDoc.active_headcount_snapshot ||
            newDoc.buffer_percent !== oldDoc.buffer_percent ||
            JSON.stringify(newDoc.items) !== JSON.stringify(oldDoc.items)) {
          throw { forbidden: 'Cannot modify request content or provenance while cancelling distribution_request' };
        }
        if (typeof newDoc.approval_operation_id !== 'undefined' ||
            typeof newDoc.approved_by !== 'undefined' ||
            typeof newDoc.approved_at !== 'undefined' ||
            typeof newDoc.batch_id !== 'undefined' ||
            typeof newDoc.rejected_by !== 'undefined' ||
            typeof newDoc.rejected_at !== 'undefined' ||
            typeof newDoc.rejection_reason !== 'undefined') {
          throw { forbidden: 'Cannot inject approval or rejection metadata while cancelling distribution_request' };
        }
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
    var isWarehouseOrAdminBatch = isRole('warehouse_staff');
    if (!isWarehouseOrAdminBatch) {
      throw { forbidden: 'Only warehouse staff or system admin can manage distribution batches' };
    }
    if (!oldDoc && newDoc.status !== 'activating') {
      throw { forbidden: 'New distribution_batch must start activating' };
    }
    if (oldDoc) {
      if (oldDoc.status === 'closed') {
        throw { forbidden: 'Closed distribution_batch cannot be modified' };
      }
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
      var validBatchTransitions = {
        activating: ['active'],
        active: ['closing'],
        closing: ['closed'],
        closed: []
      };
      var validBatchStatuses = ['activating', 'active', 'closing', 'closed'];
      if (validBatchStatuses.indexOf(oldDoc.status) === -1 ||
          validBatchStatuses.indexOf(newDoc.status) === -1) {
        throw { forbidden: 'Invalid distribution_batch status' };
      }
      if (oldDoc.status !== newDoc.status &&
          validBatchTransitions[oldDoc.status].indexOf(newDoc.status) === -1) {
        throw { forbidden: 'Invalid distribution_batch transition from ' + oldDoc.status + ' to ' + newDoc.status };
      }
    }
  }
  // 6. stock_lot_reservation role rules
  if (newDoc.type === 'stock_lot_reservation') {
    var isWarehouseOrAdminRes = isRole('warehouse_staff');
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
      isRole('registration_staff') ||
      isRole('shelter_manager');
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
      isRole('registration_staff') ||
      isRole('shelter_manager');
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
      isRole('registration_staff') ||
      isRole('shelter_manager');
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
  // 9.5 batch-wide Issue/Close gate: Issue roles mutate open claims; close roles seal/reopen.
  if (newDoc.type === 'distribution_issue_gate') {
    var isIssueGateStaff = isRole('registration_staff') || isRole('shelter_manager');
    var isCloseGateStaff = isRole('warehouse_staff');
    if (typeof newDoc._id !== 'string' || !/^distribution_issue_gate:[0-9a-f]{64}$/.test(newDoc._id)) {
      throw { forbidden: 'distribution_issue_gate requires deterministic SHA-256 id' };
    }
    if (typeof newDoc.batch_id !== 'string' || !/^distribution_batch:.+/.test(newDoc.batch_id)) {
      throw { forbidden: 'distribution_issue_gate requires valid batch_id' };
    }
    if ((newDoc.state !== 'open' && newDoc.state !== 'sealed') || !Array.isArray(newDoc.pending_claims)) {
      throw { forbidden: 'distribution_issue_gate requires valid state and pending_claims' };
    }
    for (var gateIndex = 0; gateIndex < newDoc.pending_claims.length; gateIndex++) {
      var gateClaim = newDoc.pending_claims[gateIndex];
      if (!gateClaim || typeof gateClaim.operation_id !== 'string' || !gateClaim.operation_id ||
          typeof gateClaim.issue_id !== 'string' || !/^distribution_issue:[0-9A-HJKMNP-TV-Z]{26}$/.test(gateClaim.issue_id) ||
          typeof gateClaim.claimed_at !== 'string' || isNaN(Date.parse(gateClaim.claimed_at))) {
        throw { forbidden: 'distribution_issue_gate contains invalid pending claim' };
      }
      for (var priorGateIndex = 0; priorGateIndex < gateIndex; priorGateIndex++) {
        if (newDoc.pending_claims[priorGateIndex].operation_id === gateClaim.operation_id) {
          throw { forbidden: 'distribution_issue_gate cannot contain duplicate operation_id' };
        }
      }
    }
    if (newDoc.state === 'sealed') {
      if (newDoc.pending_claims.length !== 0 || typeof newDoc.closing_operation_id !== 'string' || !newDoc.closing_operation_id) {
        throw { forbidden: 'Sealed distribution_issue_gate requires zero claims and closing_operation_id' };
      }
      if (!isCloseGateStaff) throw { forbidden: 'Only warehouse staff or system admin can seal issue gate' };
    } else {
      if (typeof newDoc.closing_operation_id !== 'undefined') {
        throw { forbidden: 'Open distribution_issue_gate cannot retain closing_operation_id' };
      }
      if (oldDoc && oldDoc.state === 'sealed') {
        if (!isCloseGateStaff) throw { forbidden: 'Only warehouse staff or system admin can reopen issue gate' };
      } else if (!isIssueGateStaff && !( !oldDoc && isCloseGateStaff && newDoc.pending_claims.length === 0)) {
        throw { forbidden: 'Only issue staff can manage open issue gate claims' };
      }
    }
    if (oldDoc) {
      if (newDoc._id !== oldDoc._id) throw { forbidden: 'Cannot change _id' };
      if (newDoc.type !== oldDoc.type) throw { forbidden: 'Cannot change type' };
      if (newDoc.shelter_code !== oldDoc.shelter_code) throw { forbidden: 'Cannot change shelter_code' };
      if (newDoc.batch_id !== oldDoc.batch_id) throw { forbidden: 'Cannot change batch_id on issue gate' };
      if (oldDoc.state === 'sealed' && newDoc.state === 'sealed') {
        throw { forbidden: 'Sealed distribution_issue_gate cannot be modified' };
      }
    }
  }
  // 10. distribution_one_time_guard role and validation rules (CR-059 Phase 3B)
  if (newDoc.type === 'distribution_one_time_guard') {
    var isIssueStaffGuard =
      isRole('registration_staff') ||
      isRole('shelter_manager');
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
  // 12. CR-121: requisition_ticket validation (Rule 12)
  if (newDoc.type === 'requisition_ticket') {
    if (newDoc.schema_v !== 1) {
      throw { forbidden: 'Unsupported requisition_ticket schema version' };
    }
    if (!/^requisition_ticket:[0-9A-HJKMNP-TV-Z]{26}$/.test(newDoc._id)) {
      throw { forbidden: 'requisition_ticket id must be requisition_ticket:{ulid}' };
    }
    var allowedReqTypes = ['kitchen', 'food', 'supplies', 'transfer'];
    if (allowedReqTypes.indexOf(newDoc.requisition_type) === -1) {
      throw { forbidden: 'Invalid requisition_type: ' + newDoc.requisition_type };
    }
    if (!Array.isArray(newDoc.items) || newDoc.items.length === 0) {
      throw { forbidden: 'requisition_ticket must have at least one item' };
    }
    var seenTicketItemIds = {};
    for (var ti = 0; ti < newDoc.items.length; ti++) {
      var tItem = newDoc.items[ti];
      if (!tItem || typeof tItem.item_id !== 'string' || !tItem.item_id) {
        throw { forbidden: 'requisition_ticket item requires item_id' };
      }
      if (seenTicketItemIds[tItem.item_id]) {
        throw { forbidden: 'requisition_ticket item_id values must be unique' };
      }
      seenTicketItemIds[tItem.item_id] = true;
      var reqQty = parseDecimal4(tItem.requested_qty);
      var allocQty = parseDecimal4(tItem.allocated_qty);
      if (isNaN(reqQty) || reqQty <= 0) {
        throw { forbidden: 'requested_qty must be a positive decimal string' };
      }
      if (isNaN(allocQty) || allocQty <= 0) {
        throw { forbidden: 'allocated_qty must be a positive decimal string' };
      }
    }
    if (oldDoc) {
      var immutableTicketFields = [
        '_id', 'type', 'schema_v', 'shelter_code', 'ticket_no', 'requisition_type', 'created_at', 'created_by', 'requested_by'
      ];
      for (var f = 0; f < immutableTicketFields.length; f++) {
        var tf = immutableTicketFields[f];
        if (newDoc[tf] !== oldDoc[tf]) {
          throw { forbidden: 'requisition_ticket.' + tf + ' is immutable' };
        }
      }

      var oldAmendments = oldDoc.amendments || [];
      var nextAmendments = newDoc.amendments || [];
      if (!Array.isArray(oldAmendments) || !Array.isArray(nextAmendments) || nextAmendments.length < oldAmendments.length) {
        throw { forbidden: 'requisition_ticket amendments must be append-only' };
      }
      for (var ai = 0; ai < oldAmendments.length; ai++) {
        var oldAmendment = oldAmendments[ai];
        var nextAmendment = nextAmendments[ai];
        if (!nextAmendment ||
            nextAmendment.amendment_id !== oldAmendment.amendment_id ||
            nextAmendment.item_id !== oldAmendment.item_id ||
            nextAmendment.added_qty !== oldAmendment.added_qty ||
            nextAmendment.amended_at !== oldAmendment.amended_at ||
            nextAmendment.amended_by !== oldAmendment.amended_by ||
            nextAmendment.reason !== oldAmendment.reason) {
          throw { forbidden: 'requisition_ticket amendment history is immutable' };
        }
      }
      if (
        nextAmendments.length > oldAmendments.length &&
        !(oldDoc.status === 'DISTRIBUTING' && newDoc.status === 'DISTRIBUTING')
      ) {
        throw { forbidden: 'requisition_ticket amendments may only be appended while DISTRIBUTING' };
      }

      var actorFields = ['approved_by', 'dispatched_by', 'received_by'];
      for (var af = 0; af < actorFields.length; af++) {
        var actorField = actorFields[af];
        var actorChanged = newDoc[actorField] !== oldDoc[actorField];
        var isExpectedActorTransition =
          (actorField === 'approved_by' && oldDoc.status === 'PENDING_PICK' && newDoc.status === 'READY_FOR_DISPATCH') ||
          (actorField === 'dispatched_by' && oldDoc.status === 'READY_FOR_DISPATCH' && newDoc.status === 'IN_TRANSIT') ||
          (actorField === 'received_by' && oldDoc.status === 'IN_TRANSIT' && newDoc.status === 'DISTRIBUTING');
        if (actorChanged && !isExpectedActorTransition) {
          throw { forbidden: 'requisition_ticket.' + actorField + ' is immutable after introduction' };
        }
      }

      var postDistStatuses = ['DISTRIBUTING', 'SHIFT_CLOSED', 'RETURN_PENDING_RECEIPT', 'RETURN_COMPLETED', 'COMPLETED'];
      if (postDistStatuses.indexOf(oldDoc.status) !== -1) {
        var nextItemMap = {};
        for (var ni = 0; ni < newDoc.items.length; ni++) {
          nextItemMap[newDoc.items[ni].item_id] = newDoc.items[ni];
        }
        for (var oi = 0; oi < oldDoc.items.length; oi++) {
          var oldItem = oldDoc.items[oi];
          var nextItem = nextItemMap[oldItem.item_id];
          if (!nextItem || parseDecimal4(nextItem.requested_qty) < parseDecimal4(oldItem.requested_qty)) {
            throw { forbidden: 'requested_qty cannot be decreased or removed after DISTRIBUTING' };
          }
        }
      }

      if (oldDoc.status === newDoc.status) {
        if (oldDoc.status === 'PENDING_PICK') {
          if (!canCreateTicket()) throw { forbidden: 'Only warehouse staff, supply coordinators, shelter managers, or system admins can allocate requisition_ticket items' };
          if (!sameTicketPayloadExceptSelfUpdateFields(oldDoc, newDoc)) {
            throw { forbidden: 'PENDING_PICK self-updates may only change item allocation quantities' };
          }
          if ((typeof oldDoc.amendments === 'undefined') !== (typeof newDoc.amendments === 'undefined')) {
            throw { forbidden: 'PENDING_PICK self-updates may only change item allocation quantities' };
          }
          if (oldDoc.items.length !== newDoc.items.length) {
            throw { forbidden: 'PENDING_PICK allocation cannot add or remove ticket items' };
          }
          for (var pendingItemIndex = 0; pendingItemIndex < oldDoc.items.length; pendingItemIndex++) {
            if (!sameTicketItemExceptAllocation(oldDoc.items[pendingItemIndex], newDoc.items[pendingItemIndex])) {
              throw { forbidden: 'PENDING_PICK allocation cannot change ticket item content' };
            }
          }
        } else if (oldDoc.status === 'DISTRIBUTING') {
          if (!canDispatchTicket()) throw { forbidden: 'Only warehouse staff, supply coordinators, shelter managers, or system admins can amend requisition_ticket items' };
          if (!sameTicketPayloadExceptSelfUpdateFields(oldDoc, newDoc)) {
            throw { forbidden: 'DISTRIBUTING self-updates may only change amendment allocation fields' };
          }
          if (oldDoc.items.length !== newDoc.items.length) {
            throw { forbidden: 'DISTRIBUTING amendments cannot add or remove ticket items' };
          }
          if (nextAmendments.length === oldAmendments.length) {
            // A CAS retry may PUT the already-amended document again; this is a
            // no-op recovery write, not a second amendment operation.
            for (var noOpItemIndex = 0; noOpItemIndex < oldDoc.items.length; noOpItemIndex++) {
              var noOpOldItem = oldDoc.items[noOpItemIndex];
              var noOpNewItem = newDoc.items[noOpItemIndex];
              if (!sameTicketItemExceptAllocation(noOpOldItem, noOpNewItem) ||
                  parseDecimal4(noOpOldItem.allocated_qty) !== parseDecimal4(noOpNewItem.allocated_qty)) {
                throw { forbidden: 'DISTRIBUTING amendment update must append exactly one amendment' };
              }
            }
          } else {
            if (nextAmendments.length !== oldAmendments.length + 1) {
              throw { forbidden: 'DISTRIBUTING amendment update must append exactly one amendment' };
            }
          var appendedAmendment = nextAmendments[oldAmendments.length];
          if (!appendedAmendment ||
              typeof appendedAmendment.amendment_id !== 'string' ||
              !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(appendedAmendment.amendment_id) ||
              typeof appendedAmendment.item_id !== 'string' ||
              !appendedAmendment.item_id ||
              typeof appendedAmendment.amended_at !== 'string' ||
              isNaN(Date.parse(appendedAmendment.amended_at)) ||
              typeof appendedAmendment.amended_by !== 'string' ||
              appendedAmendment.amended_by !== userCtx.name ||
              (typeof appendedAmendment.reason !== 'undefined' &&
                (typeof appendedAmendment.reason !== 'string' || !appendedAmendment.reason.trim()))) {
            throw { forbidden: 'New requisition_ticket amendments must bind amended_by to the current actor and contain valid audit fields' };
          }
          for (var existingAmendmentIndex = 0; existingAmendmentIndex < oldAmendments.length; existingAmendmentIndex++) {
            if (oldAmendments[existingAmendmentIndex].amendment_id === appendedAmendment.amendment_id) {
              throw { forbidden: 'requisition_ticket amendment_id values must be unique' };
            }
          }
          var appendedQty = parseDecimal4(appendedAmendment.added_qty);
          if (isNaN(appendedQty) || appendedQty <= 0) {
            throw { forbidden: 'New requisition_ticket amendment added_qty must be positive' };
          }
          var appendedItemFound = false;
          for (var amendmentItemIndex = 0; amendmentItemIndex < oldDoc.items.length; amendmentItemIndex++) {
            var oldTicketItem = oldDoc.items[amendmentItemIndex];
            var newTicketItem = newDoc.items[amendmentItemIndex];
            if (!sameTicketItemExceptAllocation(oldTicketItem, newTicketItem)) {
              throw { forbidden: 'DISTRIBUTING amendment cannot change ticket item content' };
            }
            var oldAllocated = parseDecimal4(oldTicketItem.allocated_qty);
            var newAllocated = parseDecimal4(newTicketItem.allocated_qty);
            if (isNaN(oldAllocated) || isNaN(newAllocated)) {
              throw { forbidden: 'DISTRIBUTING amendment requires valid allocated_qty values' };
            }
            var allocationDelta = newAllocated - oldAllocated;
            var expectedDelta = newTicketItem.item_id === appendedAmendment.item_id ? appendedQty : 0;
            if (newTicketItem.item_id === appendedAmendment.item_id) appendedItemFound = true;
            if (allocationDelta < 0 || allocationDelta !== expectedDelta) {
              throw { forbidden: 'DISTRIBUTING allocated_qty delta must equal appended amendment added_qty' };
            }
          }
          if (!appendedItemFound) {
            throw { forbidden: 'DISTRIBUTING amendment must reference an existing ticket item' };
          }
          }
        } else {
          throw { forbidden: 'Same-status requisition_ticket update is not allowed for ' + oldDoc.status };
        }
      } else {
        var validTransitions = {
          'PENDING_PICK': ['READY_FOR_DISPATCH', 'CANCELLED'],
          'READY_FOR_DISPATCH': ['IN_TRANSIT', 'CANCELLED'],
          'IN_TRANSIT': ['DISTRIBUTING', 'COMPLETED'],
          'DISTRIBUTING': ['SHIFT_CLOSED'],
          'SHIFT_CLOSED': ['RETURN_PENDING_RECEIPT', 'COMPLETED'],
          'RETURN_PENDING_RECEIPT': ['RETURN_COMPLETED'],
          'RETURN_COMPLETED': ['COMPLETED'],
          'COMPLETED': [],
          'CANCELLED': []
        };
        var targets = validTransitions[oldDoc.status] || [];
        if (targets.indexOf(newDoc.status) === -1) {
          throw { forbidden: 'Illegal requisition_ticket transition: ' + oldDoc.status + ' -> ' + newDoc.status };
        }
        if (oldDoc.status === 'PENDING_PICK' && newDoc.status === 'READY_FOR_DISPATCH') {
          if (!canApproveTicket()) throw { forbidden: 'Only shelter managers or system admins can approve requisition_tickets' };
          if (newDoc.approved_by !== userCtx.name) throw { forbidden: 'requisition_ticket.approved_by must match the current actor' };
        } else if (oldDoc.status === 'PENDING_PICK' && newDoc.status === 'CANCELLED') {
          if (!canCreateTicket()) throw { forbidden: 'Only warehouse staff, supply coordinators, shelter managers, or system admins can cancel requisition_tickets' };
        } else if (oldDoc.status === 'READY_FOR_DISPATCH' && newDoc.status === 'IN_TRANSIT') {
          if (!canDispatchTicket()) throw { forbidden: 'Only warehouse staff, supply coordinators, shelter managers, or system admins can dispatch requisition_tickets' };
          if (newDoc.dispatched_by !== userCtx.name) throw { forbidden: 'requisition_ticket.dispatched_by must match the current actor' };
        } else if (oldDoc.status === 'READY_FOR_DISPATCH' && newDoc.status === 'CANCELLED') {
          if (!canCreateTicket()) throw { forbidden: 'Only warehouse staff, supply coordinators, shelter managers, or system admins can cancel requisition_tickets' };
        } else if (oldDoc.status === 'IN_TRANSIT' && newDoc.status === 'DISTRIBUTING') {
          if (!canPerformFrontlineDistribution()) throw { forbidden: 'Only frontline distribution staff can receive requisition_tickets at distribution points' };
          if (newDoc.received_by !== userCtx.name) throw { forbidden: 'requisition_ticket.received_by must match the current actor' };
        } else if (oldDoc.status === 'IN_TRANSIT' && newDoc.status === 'COMPLETED') {
          if (newDoc.requisition_type !== 'transfer') {
            throw { forbidden: 'Only transfer requisition_tickets can transition from IN_TRANSIT to COMPLETED' };
          }
          if (!canReceivePhysicalStock()) throw { forbidden: 'Only warehouse staff, supply coordinators, shelter managers, or system admins can complete transfer requisition_tickets' };
        } else if (oldDoc.status === 'DISTRIBUTING' && newDoc.status === 'SHIFT_CLOSED') {
          if (!canPerformFrontlineDistribution()) throw { forbidden: 'Only frontline distribution staff can close requisition_ticket shifts' };
        } else if (oldDoc.status === 'SHIFT_CLOSED' && (newDoc.status === 'RETURN_PENDING_RECEIPT' || newDoc.status === 'COMPLETED')) {
          if (!canPerformFrontlineDistribution()) throw { forbidden: 'Only frontline distribution staff can submit or complete requisition_ticket shifts' };
        } else if (oldDoc.status === 'RETURN_PENDING_RECEIPT' && newDoc.status === 'RETURN_COMPLETED') {
          if (!canReceivePhysicalStock()) throw { forbidden: 'Only warehouse staff, supply coordinators, shelter managers, or system admins can receive warehouse returns' };
        } else if (oldDoc.status === 'RETURN_COMPLETED' && newDoc.status === 'COMPLETED') {
          if (!canReceivePhysicalStock()) throw { forbidden: 'Only warehouse staff, supply coordinators, shelter managers, or system admins can complete requisition_ticket returns' };
        }
      }
    } else {
      if (newDoc.status !== 'PENDING_PICK') {
        throw { forbidden: 'Initial requisition_ticket status must be PENDING_PICK' };
      }
      if (!canCreateTicket()) {
        throw { forbidden: 'Only warehouse staff, supply coordinators, shelter managers, or system admins can create requisition_tickets' };
      }
      if (newDoc.created_by !== userCtx.name || newDoc.requested_by !== userCtx.name) {
        throw { forbidden: 'requisition_ticket created_by and requested_by must match the current actor' };
      }
      if (newDoc.approved_by !== undefined || newDoc.dispatched_by !== undefined || newDoc.received_by !== undefined) {
        throw { forbidden: 'Initial requisition_ticket cannot contain transition actor fields' };
      }
      if (Array.isArray(newDoc.amendments) && newDoc.amendments.length > 0) {
        throw { forbidden: 'Initial requisition_ticket cannot contain amendments' };
      }
    }
  }
  // 13. CR-121: distribution_log validation (Rules 12-14)
  if (newDoc.type === 'distribution_log') {
    if (newDoc.schema_v !== 1) {
      throw { forbidden: 'Unsupported distribution_log schema version' };
    }
    if (!/^distribution_log:[0-9A-HJKMNP-TV-Z]{26}$/.test(newDoc._id)) {
      throw { forbidden: 'distribution_log id must be distribution_log:{ulid}' };
    }
    if (typeof newDoc.ticket_id !== 'string' || !/^requisition_ticket:[0-9A-HJKMNP-TV-Z]{26}$/.test(newDoc.ticket_id)) {
      throw { forbidden: 'distribution_log requires requisition_ticket ticket_id' };
    }
    if (typeof newDoc.item_id !== 'string' || !newDoc.item_id) {
      throw { forbidden: 'distribution_log requires item_id' };
    }
    if (typeof newDoc.qty !== 'string' || parseDecimal4(newDoc.qty) <= 0) {
      throw { forbidden: 'distribution_log qty must be a positive decimal string' };
    }
    if (typeof newDoc.is_returnable !== 'boolean') {
      throw { forbidden: 'distribution_log requires boolean is_returnable' };
    }
    if (['evacuee', 'volunteer', 'outside'].indexOf(newDoc.recipient_type) === -1) {
      throw { forbidden: 'Invalid recipient_type: ' + newDoc.recipient_type };
    }
    if (newDoc.recipient_type === 'evacuee' && (typeof newDoc.recipient_id !== 'string' || newDoc.recipient_id.indexOf('evacuee:') !== 0)) {
      throw { forbidden: 'evacuee recipient_id is required' };
    }
    if (newDoc.recipient_type === 'volunteer' && (typeof newDoc.recipient_id !== 'string' || newDoc.recipient_id.indexOf('volunteer:') !== 0)) {
      throw { forbidden: 'volunteer recipient_id is required' };
    }
    if (newDoc.recipient_type === 'outside' && typeof newDoc.recipient_id !== 'undefined' && newDoc.recipient_id !== null) {
      throw { forbidden: 'outside recipients must not carry recipient_id' };
    }
    if (oldDoc) {
      var immutableLogFields = [
        '_id', 'type', 'schema_v', 'shelter_code', 'ticket_id', 'item_id', 'qty',
        'recipient_type', 'recipient_id', 'household_id', 'is_returnable',
        'distributed_at', 'distributed_by', 'created_at', 'created_by'
      ];
      for (var lf = 0; lf < immutableLogFields.length; lf++) {
        var lfName = immutableLogFields[lf];
        if (newDoc[lfName] !== oldDoc[lfName]) {
          throw { forbidden: 'distribution_log.' + lfName + ' is immutable after issuance' };
        }
      }

      var oldStatus = oldDoc.status;
      var nextStatus = newDoc.status;
      if (nextStatus === 'voided') {
        if (!newDoc.voided_at || !newDoc.voided_by) {
          throw { forbidden: 'Voided logs require void audit fields' };
        }
        var previousReturnedQty = oldDoc.qty_returned === undefined ? 0 : parseDecimal4(oldDoc.qty_returned);
        if (
          (oldStatus !== 'fulfilled' && oldStatus !== 'active') ||
          previousReturnedQty > 0 ||
          oldDoc.returned_at ||
          oldDoc.returned_by ||
          oldDoc.clear_reason ||
          oldDoc.bulk_pool_id
        ) {
          throw { forbidden: 'Cannot void a distribution_log after return or clear activity has begun' };
        }
      }
      var isVoidTransition = nextStatus === 'voided' && (oldStatus === 'fulfilled' || oldStatus === 'active');
      var isRoutineReturn =
        (nextStatus === 'partially_returned' || nextStatus === 'returned') &&
        newDoc.clear_reason === 'routine' &&
        (oldStatus === 'active' || oldStatus === 'partially_returned');
      var isBulkReturn =
        nextStatus === 'returned' &&
        newDoc.clear_reason === 'bulk_dropoff' &&
        (oldStatus === 'active' || oldStatus === 'partially_returned');
      var isNonPhysicalClear =
        (nextStatus === 'lost' || nextStatus === 'waived') &&
        (oldStatus === 'active' || oldStatus === 'partially_returned');

      if (isVoidTransition) {
        if (!canPerformFrontlineDistribution()) throw { forbidden: 'Only frontline distribution staff can void distribution logs' };
        if (newDoc.voided_by !== userCtx.name) throw { forbidden: 'distribution_log.voided_by must match the current actor' };
      } else if (isRoutineReturn) {
        if (!canReceivePhysicalStock()) throw { forbidden: 'Only warehouse staff, supply coordinators, shelter managers, or system admins can record routine physical returns' };
        if (newDoc.returned_by !== userCtx.name) throw { forbidden: 'distribution_log.returned_by must match the current actor' };
        if (oldStatus === 'partially_returned' && parseDecimal4(newDoc.qty_returned) <= parseDecimal4(oldDoc.qty_returned)) {
          throw { forbidden: 'partially_returned distribution_log qty_returned must increase' };
        }
      } else if (isBulkReturn || isNonPhysicalClear) {
        if (!canPerformFrontlineDistribution()) throw { forbidden: 'Only frontline distribution staff can clear distribution logs' };
        if (newDoc.returned_by !== userCtx.name) throw { forbidden: 'distribution_log.returned_by must match the current actor' };
      } else {
        throw { forbidden: 'Illegal distribution_log transition: ' + oldStatus + ' -> ' + nextStatus };
      }

      var returnClearStatuses = ['partially_returned', 'returned', 'lost', 'waived'];
      if (returnClearStatuses.indexOf(newDoc.status) !== -1) {
        if (!newDoc.returned_at || !newDoc.returned_by || !newDoc.clear_reason) {
          throw { forbidden: 'Loan clear status requires return audit fields' };
        }
        if (newDoc.clear_reason === 'bulk_dropoff') {
          if (typeof newDoc.bulk_pool_id !== 'string' || !/^bulk_return_pool:[0-9A-HJKMNP-TV-Z]{26}$/.test(newDoc.bulk_pool_id)) {
            throw { forbidden: 'bulk_dropoff requires bulk_pool_id' };
          }
        }
        if (newDoc.status === 'lost') {
          if (newDoc.clear_reason !== 'lost' || !newDoc.notes) {
            throw { forbidden: 'Lost loans require notes and clear_reason lost' };
          }
        }
        if (newDoc.status === 'waived') {
          if (newDoc.clear_reason !== 'waived' || !newDoc.notes) {
            throw { forbidden: 'Waived loans require notes and clear_reason waived' };
          }
        }
        if (newDoc.status === 'returned') {
          if (['routine', 'bulk_dropoff'].indexOf(newDoc.clear_reason) === -1) {
            throw { forbidden: 'Returned log must record clear_reason routine or bulk_dropoff' };
          }
          if (parseDecimal4(newDoc.qty_returned) !== parseDecimal4(newDoc.qty)) {
            throw { forbidden: 'Returned log must record full qty_returned' };
          }
        }
        if (newDoc.status === 'partially_returned') {
          var prQty = parseDecimal4(newDoc.qty_returned);
          if (isNaN(prQty) || prQty <= 0 || prQty >= parseDecimal4(newDoc.qty)) {
            throw { forbidden: 'Partial return requires qty_returned greater than zero and less than issued qty' };
          }
        }
      }
    } else {
      if (!canPerformFrontlineDistribution()) {
        throw { forbidden: 'Only frontline distribution staff can create distribution logs' };
      }
      if (newDoc.created_by !== userCtx.name || newDoc.distributed_by !== userCtx.name) {
        throw { forbidden: 'distribution_log created_by and distributed_by must match the current actor' };
      }
      if (!newDoc.is_returnable && newDoc.status !== 'fulfilled') {
        throw { forbidden: 'Non-returnable logs must start as fulfilled' };
      }
      if (newDoc.is_returnable && newDoc.status !== 'active') {
        throw { forbidden: 'Returnable logs must start as active' };
      }
    }
  }
  // 14. CR-121 / CR-134: bulk_return_pool validation (Rule 14)
  if (newDoc.type === 'bulk_return_pool') {
    var canCreatePool = isRole('warehouse_staff') || isRole('supply_coordinator') || isRole('shelter_manager');
    var canClaimPool = isRole('registration_staff') || isRole('supply_coordinator') || isRole('shelter_manager');
    var canClosePool = isRole('warehouse_staff') || isRole('supply_coordinator') || isRole('shelter_manager');
    if (newDoc.schema_v !== 1 && newDoc.schema_v !== 2) {
      throw { forbidden: 'Unsupported bulk_return_pool schema version' };
    }
    if (!/^bulk_return_pool:[0-9A-HJKMNP-TV-Z]{26}$/.test(newDoc._id)) {
      throw { forbidden: 'bulk_return_pool id must be bulk_return_pool:{ulid}' };
    }
    if (oldDoc) {
      if (oldDoc.schema_v === 2 && newDoc.schema_v === 1) {
        throw { forbidden: 'Cannot downgrade bulk_return_pool from schema_v 2 to 1' };
      }
      var immutablePoolFields = [
        '_id', 'type', 'shelter_code', 'item_id', 'stock_ledger_id', 'total_received_qty', 'created_at', 'created_by'
      ];
      for (var pf = 0; pf < immutablePoolFields.length; pf++) {
        var pfName = immutablePoolFields[pf];
        if (newDoc[pfName] !== oldDoc[pfName]) {
          throw { forbidden: 'bulk_return_pool.' + pfName + ' is immutable' };
        }
      }
    }
    var totalRec = parseDecimal4(newDoc.total_received_qty);
    var claimed = parseDecimal4(newDoc.claimed_qty);
    var unclaimed = parseDecimal4(newDoc.unclaimed_quota);
    if (isNaN(totalRec) || totalRec <= 0) {
      throw { forbidden: 'bulk_return_pool total_received_qty must be a positive decimal string' };
    }
    if (isNaN(claimed) || claimed < 0) {
      throw { forbidden: 'bulk_return_pool claimed_qty must be a non-negative decimal string' };
    }
    if (isNaN(unclaimed) || unclaimed < 0) {
      throw { forbidden: 'bulk_return_pool unclaimed_quota must be a non-negative decimal string' };
    }
    if (claimed + unclaimed !== totalRec) {
      throw { forbidden: 'claimed_qty + unclaimed_quota must equal total_received_qty' };
    }
    if (['ACTIVE', 'EXHAUSTED', 'CLOSED'].indexOf(newDoc.status) === -1) {
      throw { forbidden: 'Invalid bulk_return_pool status: ' + newDoc.status };
    }
    if (newDoc.status === 'ACTIVE' && unclaimed <= 0) {
      throw { forbidden: 'ACTIVE bulk_return_pool must have remaining quota' };
    }
    if (newDoc.status === 'EXHAUSTED' && unclaimed !== 0) {
      throw { forbidden: 'EXHAUSTED bulk_return_pool must have zero unclaimed quota' };
    }
    if (newDoc.schema_v === 2) {
      if (!Array.isArray(newDoc.claim_ids)) {
        throw { forbidden: 'bulk_return_pool schema_v 2 requires claim_ids array' };
      }
      var seenClaimIds = {};
      for (var ci = 0; ci < newDoc.claim_ids.length; ci++) {
        var cid = newDoc.claim_ids[ci];
        if (typeof cid !== 'string' || !/^bulk_return_claim:[0-9A-HJKMNP-TV-Z]{26}$/.test(cid)) {
          throw { forbidden: 'Invalid claim_id format in bulk_return_pool: ' + cid };
        }
        if (seenClaimIds[cid]) {
          throw { forbidden: 'Duplicate claim_id in bulk_return_pool: ' + cid };
        }
        seenClaimIds[cid] = true;
      }
      if (oldDoc && oldDoc.schema_v === 2 && Array.isArray(oldDoc.claim_ids)) {
        for (var oci = 0; oci < oldDoc.claim_ids.length; oci++) {
          if (!seenClaimIds[oldDoc.claim_ids[oci]]) {
            throw { forbidden: 'Cannot remove claim_ids from bulk_return_pool' };
          }
        }
      }
    }
    if (oldDoc) {
      var oldClaimed = parseDecimal4(oldDoc.claimed_qty);
      var oldUnclaimed = parseDecimal4(oldDoc.unclaimed_quota);
      if (isNaN(oldClaimed) || isNaN(oldUnclaimed)) {
        throw { forbidden: 'Existing bulk_return_pool has invalid quota accounting' };
      }
      var validPoolTransitions = {
        ACTIVE: ['ACTIVE', 'EXHAUSTED', 'CLOSED'],
        EXHAUSTED: ['EXHAUSTED', 'CLOSED'],
        CLOSED: ['CLOSED']
      };
      var allowedPoolStatuses = validPoolTransitions[oldDoc.status] || [];
      if (allowedPoolStatuses.indexOf(newDoc.status) === -1) {
        throw { forbidden: 'Invalid bulk_return_pool status transition ' + oldDoc.status + ' -> ' + newDoc.status };
      }

      if (claimed < oldClaimed) {
        throw { forbidden: 'bulk_return_pool claimed_qty cannot decrease' };
      }
      if (unclaimed > oldUnclaimed) {
        throw { forbidden: 'bulk_return_pool unclaimed_quota cannot increase' };
      }

      if (oldDoc.status === 'CLOSED' &&
          (claimed !== oldClaimed || unclaimed !== oldUnclaimed)) {
        throw { forbidden: 'CLOSED bulk_return_pool accounting is immutable' };
      }

      if (oldDoc.schema_v === 1 && newDoc.schema_v === 2) {
        if (oldDoc.status !== 'ACTIVE' ||
            newDoc.claim_ids.length !== 1 ||
            claimed <= oldClaimed ||
            unclaimed >= oldUnclaimed) {
          throw { forbidden: 'bulk_return_pool v1 to v2 upgrade must include the first quota claim and claim_id' };
        }
      }

      if (newDoc.status === 'CLOSED') {
        if (!canClosePool) {
          throw { forbidden: 'Only warehouse staff, supply coordinator, or shelter manager can close bulk return pool' };
        }
        if (!newDoc.closed_at || !newDoc.closed_by) {
          throw { forbidden: 'CLOSED pool requires close audit fields' };
        }
      } else if (!canClaimPool) {
        throw { forbidden: 'Only frontline distribution staff can claim bulk return pool quota' };
      }
    } else {
      if (!canCreatePool) {
        throw { forbidden: 'Only warehouse staff, supply coordinator, or shelter manager can create bulk return pool' };
      }
      if (newDoc.status !== 'ACTIVE') {
        throw { forbidden: 'Initial bulk_return_pool status must be ACTIVE' };
      }
    }
  }
  // 15. CR-134: bulk_return_claim validation (Rule 15)
  if (newDoc.type === 'bulk_return_claim') {
    var canManageClaim =
      isRole('registration_staff') ||
      isRole('supply_coordinator') ||
      isRole('shelter_manager') ||
      isRole('system_admin');
    if (!canManageClaim) {
      throw { forbidden: 'Only registration staff, supply coordinator, shelter manager, or system admin can manage bulk return claims' };
    }
    if (newDoc.schema_v !== 1) {
      throw { forbidden: 'Unsupported bulk_return_claim schema version' };
    }
    if (!/^bulk_return_claim:[0-9A-HJKMNP-TV-Z]{26}$/.test(newDoc._id)) {
      throw { forbidden: 'bulk_return_claim id must be bulk_return_claim:{ulid}' };
    }
    if (typeof newDoc.operation_id !== 'string' || !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(newDoc.operation_id)) {
      throw { forbidden: 'bulk_return_claim requires operation_id ULID' };
    }
    if (typeof newDoc.distribution_log_id !== 'string' || !/^distribution_log:[0-9A-HJKMNP-TV-Z]{26}$/.test(newDoc.distribution_log_id)) {
      throw { forbidden: 'bulk_return_claim requires distribution_log_id' };
    }
    if (newDoc._id !== 'bulk_return_claim:' + newDoc.distribution_log_id.replace('distribution_log:', '')) {
      throw { forbidden: 'bulk_return_claim id must derive from distribution_log_id' };
    }
    if (typeof newDoc.bulk_pool_id !== 'string' || !/^bulk_return_pool:[0-9A-HJKMNP-TV-Z]{26}$/.test(newDoc.bulk_pool_id)) {
      throw { forbidden: 'bulk_return_claim requires bulk_pool_id' };
    }
    if (typeof newDoc.item_id !== 'string' || !newDoc.item_id) {
      throw { forbidden: 'bulk_return_claim requires item_id' };
    }
    var claimedQty = parseDecimal4(newDoc.claimed_qty);
    if (isNaN(claimedQty) || claimedQty <= 0) {
      throw { forbidden: 'bulk_return_claim claimed_qty must be a positive decimal string' };
    }
    var validStatuses = ['CLAIM_INTENT', 'POOL_CLAIMED', 'COMPLETE', 'ABORTED'];
    if (validStatuses.indexOf(newDoc.status) === -1) {
      throw { forbidden: 'Invalid bulk_return_claim status: ' + newDoc.status };
    }

    if (oldDoc) {
      var permImmutable = [
        '_id', 'type', 'schema_v', 'shelter_code', 'distribution_log_id', 'item_id', 'created_at', 'created_by'
      ];
      for (var pi = 0; pi < permImmutable.length; pi++) {
        var piName = permImmutable[pi];
        if (newDoc[piName] !== oldDoc[piName]) {
          throw { forbidden: 'bulk_return_claim.' + piName + ' is permanently immutable' };
        }
      }

      var oldStatus = oldDoc.status;
      var newStatus = newDoc.status;

      if (oldStatus === newStatus) {
        if (newDoc.operation_id !== oldDoc.operation_id ||
            newDoc.bulk_pool_id !== oldDoc.bulk_pool_id ||
            newDoc.claimed_qty !== oldDoc.claimed_qty) {
          throw { forbidden: 'Attempt-scoped fields cannot change within the same status' };
        }
      } else {
        var validClaimTransitions = {
          CLAIM_INTENT: ['POOL_CLAIMED', 'ABORTED'],
          POOL_CLAIMED: ['COMPLETE'],
          COMPLETE: [],
          ABORTED: ['CLAIM_INTENT']
        };
        var allowedNext = validClaimTransitions[oldStatus] || [];
        if (allowedNext.indexOf(newStatus) === -1) {
          throw { forbidden: 'Invalid bulk_return_claim transition from ' + oldStatus + ' to ' + newStatus };
        }

        if (oldStatus === 'ABORTED' && newStatus === 'CLAIM_INTENT') {
          // Allowed: new attempt resets operation_id, bulk_pool_id, claimed_qty, notes, updated_at
        } else {
          if (newDoc.operation_id !== oldDoc.operation_id) {
            throw { forbidden: 'bulk_return_claim.operation_id is immutable during transition ' + oldStatus + ' to ' + newStatus };
          }
          if (newDoc.bulk_pool_id !== oldDoc.bulk_pool_id) {
            throw { forbidden: 'bulk_return_claim.bulk_pool_id is immutable during transition ' + oldStatus + ' to ' + newStatus };
          }
          if (newDoc.claimed_qty !== oldDoc.claimed_qty) {
            throw { forbidden: 'bulk_return_claim.claimed_qty is immutable during transition ' + oldStatus + ' to ' + newStatus };
          }
        }
      }
    } else {
      if (newDoc.status !== 'CLAIM_INTENT') {
        throw { forbidden: 'Initial bulk_return_claim status must be CLAIM_INTENT' };
      }
    }
  }
  // item_master base_unit invariant guard
  function isUnitCode(value) {
    return typeof value === 'string' && /^[a-z][a-z0-9_]{0,15}$/.test(value);
  }
  function isLegacyUnitLabel(value) {
    return typeof value === 'string' && [
      'ชิ้น', 'หน่วย', 'อัน', 'ตัว', 'ชุด', 'คู่', 'กล่อง', 'แพ็ค', 'ถุง', 'ซอง',
      'ขวด', 'กระป๋อง', 'เม็ด', 'ก้อน', 'หลอด', 'ม้วน', 'แผ่น', 'ผืน', 'ห่อ', 'ฟอง',
      'ผล', 'แกลลอน', 'ถัง', 'กรัม', 'กิโลกรัม', 'กก', 'กก.', 'มิลลิลิตร', 'ลิตร', 'เมตร'
    ].indexOf(value.trim()) !== -1;
  }
  function validateUnitField(value, field) {
    if (value && !isUnitCode(value)) {
      throw { forbidden: field + ' must match ^[a-z][a-z0-9_]{0,15}$' };
    }
  }
  if (newDoc.type === 'item_master') {
    var isLegacyBaseUnitUpdate = oldDoc && oldDoc.type === 'item_master' &&
      oldDoc.base_unit === newDoc.base_unit && isLegacyUnitLabel(newDoc.base_unit);
    if (newDoc.base_unit && !/^[a-z][a-z0-9_]{0,15}$/.test(newDoc.base_unit) && !isLegacyBaseUnitUpdate) {
      throw { forbidden: 'base_unit must match ^[a-z][a-z0-9_]{0,15}$' };
    }
    validateUnitField(newDoc.default_inventory_uom, 'default_inventory_uom');
    validateUnitField(newDoc.default_issue_uom, 'default_issue_uom');
    if (Array.isArray(newDoc.conversions)) {
      for (var conversionIndex = 0; conversionIndex < newDoc.conversions.length; conversionIndex++) {
        validateUnitField(newDoc.conversions[conversionIndex].uom_name, 'conversions.uom_name');
      }
    }
  }
  if (newDoc.type === 'recipe' && Array.isArray(newDoc.ingredients)) {
    for (var ingredientIndex = 0; ingredientIndex < newDoc.ingredients.length; ingredientIndex++) {
      validateUnitField(newDoc.ingredients[ingredientIndex].uom, 'ingredients.uom');
    }
  }
  if (newDoc.type === 'donation_campaign' && Array.isArray(newDoc.needs)) {
    for (var needIndex = 0; needIndex < newDoc.needs.length; needIndex++) {
      validateUnitField(newDoc.needs[needIndex].unit, 'needs.unit');
    }
  }
}`;
}
