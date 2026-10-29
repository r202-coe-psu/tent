/**
 * CouchDB `_design/access` helpers for per-shelter databases.
 * Shared by provisioning (+server.ts) and admin redeploy (shelters.admin.ts).
 */

// Keep this server/seed helper domain-only. Importing the feature barrel pulls
// Svelte/TanStack modules into Node-only scripts such as `pnpm seed`.
import { SOP_RATIO_KEYS, SOP_RATIO_KIND } from '$lib/features/sop-ratios/server';
import {
	DAILY_SOP_ROLE_METRIC_CONTRACTS,
	DAILY_SOP_ROLES,
	DAILY_SOP_ROLE_QUESTION_VERSION,
	DAILY_SOP_ROLE_QUESTIONS
} from '$lib/features/daily-sop/server';
import { consentVduClause } from '$lib/features/consent/server';

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

/** Index required by role-based Daily SOP history (CR: daily-sop-role-assessment). */
export const DAILY_SOP_ROLE_MANGO_INDEX = {
	index: {
		fields: [
			{ type: 'desc' },
			{ shelter_code: 'desc' },
			{ assessment_date: 'desc' },
			{ role_code: 'desc' }
		]
	},
	ddoc: 'daily-sop-role-assessment',
	name: 'daily-sop-role-assessment-by-shelter-date',
	type: 'json' as const
};

const DAILY_SOP_ROLE_VDU_CONTRACT = JSON.stringify({
	version: DAILY_SOP_ROLE_QUESTION_VERSION,
	roles: DAILY_SOP_ROLES.map((role) => ({
		code: role.code,
		key: role.key,
		label: role.label,
		capabilities: [...role.capabilities],
		questions: DAILY_SOP_ROLE_QUESTIONS.filter((question) => question.role === role.code).map(
			(question) => ({
				id: question.id,
				text: question.text,
				metric: DAILY_SOP_ROLE_METRIC_CONTRACTS[question.id] ?? null
			})
		)
	}))
});

/** Mango indexes for kiosk pre-registration lookup and report-in (FR-KPC-62..65). */
export const KIOSK_LOOKUP_MANGO_INDEXES = [
	{
		index: { fields: ['type', 'phone'] },
		name: 'evacuee-type-phone-idx',
		type: 'json' as const
	},
	{
		index: { fields: ['type', 'person_id.number'] },
		name: 'evacuee-type-person-id-idx',
		type: 'json' as const
	},
	{
		index: { fields: ['type', 'household_id'] },
		name: 'evacuee-type-household-idx',
		type: 'json' as const
	},
	{
		// Walk-in household join (`findJoinableKioskHousehold`) looks kiosk walk-ins up by card address.
		index: { fields: ['type', 'card_snapshot.address_no'] },
		name: 'evacuee-type-card-address-no-idx',
		type: 'json' as const
	}
];

/**
 * Warm-up `_find` selector per kiosk lookup index, keyed by index name. Every deploy path runs
 * one query per index after creating it so CouchDB builds the index before the first kiosk
 * lookup. Must cover every entry of `KIOSK_LOOKUP_MANGO_INDEXES` (see the unit test).
 */
export const KIOSK_LOOKUP_WARMUP_SELECTORS: Readonly<Record<string, Record<string, string>>> = {
	'evacuee-type-phone-idx': { type: 'evacuee', phone: '__warmup__' },
	'evacuee-type-person-id-idx': { type: 'evacuee', 'person_id.number': '__warmup__' },
	'evacuee-type-household-idx': { type: 'evacuee', household_id: '__warmup__' },
	'evacuee-type-card-address-no-idx': { type: 'evacuee', 'card_snapshot.address_no': '__warmup__' }
};

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
 * Mango index definitions backing the scoped-by-evacuee/household `_find` lookups used by
 * `EvacueeProfileView` (household members, medical/screening/movement history) — without these,
 * those lookups fall back to a full DB scan as a shelter's people data grows.
 */
export const PEOPLE_MANGO_INDEXES = [
	{
		index: { fields: ['type', 'household_id'] },
		name: 'evacuee-type-household-idx',
		type: 'json' as const
	},
	{
		// Shared by medical/screening/movement lookups scoped to one evacuee_id —
		// `type` is part of both the index and every selector using it, so one
		// index covers all three doc types instead of three duplicates.
		index: { fields: ['type', 'evacuee_id'] },
		name: 'people-type-evacuee-idx',
		type: 'json' as const
	},
	{
		// CR-192 FR-STL-13: finds the live `start` of an (evacuee_id, station) pair so a staff
		// page reopen / refresh does not write a duplicate station_log `start`.
		index: { fields: ['type', 'evacuee_id', 'station', 'occurred_at'] },
		name: 'station-log-type-evacuee-station-idx',
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

/** Mango index definitions required by requisition_ticket list/find (CR-121/CR-141). */
export const REQUISITION_TICKET_MANGO_INDEXES = [
	{
		index: { fields: ['type', 'requisition_type', 'status'] },
		name: 'requisition-ticket-type-status-idx',
		type: 'json' as const
	},
	{
		index: { fields: ['type', 'meal_plan_id'] },
		name: 'requisition-ticket-mealplan-idx',
		type: 'json' as const
	}
];

/**
 * Mango index definitions for bulk return event lookups by pool (#658): entries by creation pool,
 * moves by target pool (pool-scoped reads find moved-in entries through `to_pool_id`).
 */
export const BULK_RETURN_ENTRY_MANGO_INDEXES = [
	{
		index: { fields: ['type', 'pool_id'] },
		name: 'bulk-return-entry-type-pool-idx',
		type: 'json' as const
	},
	{
		index: { fields: ['type', 'to_pool_id'] },
		name: 'bulk-return-move-type-to-pool-idx',
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
 *    `people_import_log` / `station_log` — reject any update or delete of an existing doc
 *    (schema.md §1.4–1.5, §1.7–1.8, §6.2). A wrong ledger entry is corrected by writing
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
	const dailySopRoleContract = DAILY_SOP_ROLE_VDU_CONTRACT;
	return `function (newDoc, oldDoc, userCtx) {
  var isCouchAdmin = userCtx.roles.indexOf('_admin') !== -1;
  var isRoleAssessmentWrite = newDoc.type === 'daily_sop_role_assessment' ||
    (oldDoc && oldDoc.type === 'daily_sop_role_assessment');
  if (isRoleAssessmentWrite && newDoc._deleted === true) {
    throw { forbidden: 'Daily SOP role assessments cannot be deleted' };
  }
  if (isRoleAssessmentWrite && oldDoc && oldDoc.type === 'daily_sop_role_assessment' &&
      newDoc.type !== 'daily_sop_role_assessment') {
    throw { forbidden: 'Daily SOP role assessment type cannot change' };
  }
${consentVduClause()}
  if (isCouchAdmin && !isRoleAssessmentWrite) return;
  if (newDoc.type === 'unit_of_measure' || (oldDoc && oldDoc.type === 'unit_of_measure')) {
    throw { forbidden: 'unit_of_measure is central-only' };
  }
  // Compound Scoped Roles (CR-093): prefer {code}:{cap}. A legacy bare RoleKey counts only when
  // the user holds exactly one shelter scope and it is this shelter (CR-093, CR-161 R1).
  function isRole(cap) {
    if (userCtx.roles.indexOf('system_admin') !== -1) return true;
    if (userCtx.roles.indexOf('${code}:' + cap) !== -1) return true;
    if (userCtx.roles.indexOf(cap) === -1) return false;
    var shelterCount = 0;
    var hasThisShelter = false;
    for (var r = 0; r < userCtx.roles.length; r++) {
      if (userCtx.roles[r].indexOf('shelter:') === 0) {
        shelterCount++;
        if (userCtx.roles[r] === 'shelter:${code}') hasThisShelter = true;
      }
    }
    return shelterCount === 1 && hasThisShelter;
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
  // CR-179: Step 2 approve (PENDING_PICK -> READY_FOR_DISPATCH) is WH, SC, SM, SA.
  function canApproveTicket() {
    return isRole('warehouse_staff') || isRole('supply_coordinator') || isRole('shelter_manager');
  }
  function canDispatchTicket() {
    return isRole('warehouse_staff') || isRole('supply_coordinator') || isRole('shelter_manager');
  }
  // CR-161 R3: frontline Step 4/4B/5/6 and BULK / NON_PHYSICAL loan clears are SA, SM, DST.
  function canPerformFrontlineDistribution() {
    return isRole('distribution_staff') || isRole('shelter_manager');
  }
  function canReceivePhysicalStock() {
    return isRole('warehouse_staff') || isRole('supply_coordinator') || isRole('shelter_manager');
  }
  // CR-161 R3: physical loan return (PHYSICAL → receive) is WH, SC, SM, SA + DST.
  function canReturnLoanPhysical() {
    return canReceivePhysicalStock() || isRole('distribution_staff');
  }
  // #658: every bulk_return_pool write (create, edit while OPEN, lock, submit, receive, cancel)
  // is WH, SC, SM (+ SA via isRole). Entries / moves / voids additionally allow distribution_staff.
  // system_admin keeps the usual isRole() override (kong, PR #768): no SA-specific block.
  function canManageBulkReturnPool() {
    return isRole('warehouse_staff') || isRole('supply_coordinator') || isRole('shelter_manager');
  }
  function canWriteBulkReturnEntry() {
    return canManageBulkReturnPool() || isRole('distribution_staff');
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
    // Previous VDU ignore set did not include _revisions:
    // _rev, updated_at, status, items, amendments
    //
    // CouchDB injects _revisions into oldDoc during validate_doc_update,
    // while normal client PUT payloads do not include it. Treating this
    // internal revision metadata as a business-field change caused valid
    // PENDING_PICK allocation updates to be rejected with HTTP 403 (discovered
    // by real Playwright/CouchDB E2E allocation path).
    return sameObjectExcept(previousTicket, nextTicket, {
      _rev: true,
      _revisions: true,
      updated_at: true,
      status: true,
      items: true,
      amendments: true
    });
  }

  // schema.md §1.4 movement, §1.5 screening, §1.7 people_import_log, §2.6 kitchen_requisition,
  // §2.7 meal_service, §6.2 stock_ledger / audit, CR-059 Phase 3B distribution_issue,
  // §1.8 station_log (CR-192)
  var appendOnly = [
    'stock_ledger', 'audit', 'movement', 'screening', 'people_import_log', 'station_log',
    'meal_service', 'meal_service_receipt',
    'distribution_issue', 'distribution_issue_idempotency',
    // #658: event log of a bulk return pool — never updated, never deleted.
    'bulk_return_entry', 'bulk_return_entry_move', 'bulk_return_entry_void',
    'bulk_return_loan_reopen'
  ];
  var wasAppendOnly = oldDoc && appendOnly.indexOf(oldDoc.type) !== -1;
  if (newDoc._deleted) {
    if (oldDoc && oldDoc.type === 'daily_sop_assessment') {
      throw { forbidden: 'Legacy Daily SOP documents are read-only' };
    }
    if (oldDoc && oldDoc.type === 'item_category' && oldDoc.is_protected === true) {
      throw { forbidden: 'Cannot delete system protected category: ' + oldDoc._id };
    }
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
    // Incident Log is an occurrence book — records are closed or cancelled, never deleted.
    if (oldDoc && (oldDoc.type === 'distribution_log' || oldDoc.type === 'bulk_return_claim' || oldDoc.type === 'bulk_return_pool' || oldDoc.type === 'loan_return_reservation' ||
        oldDoc.type === 'shelter_incident')) {
      throw { forbidden: 'Cannot delete ' + oldDoc.type + ' documents' };
    }
    if (wasAppendOnly || protectedCoordinationDelete || (oldDoc && oldDoc.type === 'kitchen_requisition')) {
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
  if (oldDoc && oldDoc.type === 'item_category' && oldDoc.is_protected === true) {
    if (newDoc.system_key !== oldDoc.system_key) {
      throw { forbidden: 'system_key is immutable on protected categories' };
    }
    // CR-140: default_class is editable on protected categories (amends CR-119 FR-04).
    if (newDoc.is_protected !== true) {
      throw { forbidden: 'is_protected flag cannot be removed' };
    }
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
  // record without an _admin session (bug found + fixed
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
    'people_import_log', 'station_log',
    'donation', 'donation_campaign', 'stock_ledger', 'donation_slot', 'donation_redirect',
    'audit', 'daily_calc', 'simulation', 'referral',
    'meal_session', 'kitchen_counter',
    'meal_plan', 'kitchen_requisition', 'meal_service',
    'volunteer', 'job', 'job_application', 'shift_assignment',
    'item_category', 'item_master', 'recipe',
    'requirement_group', 'food_sphere_standard', 'replenishment_policy', 'sop_override',
    'distribution_request', 'distribution_batch', 'stock_lot_reservation',
    'distribution_issue', 'distribution_issue_idempotency', 'distribution_issue_capacity', 'distribution_one_time_guard', 'distribution_issue_gate',
		'shelter_readiness_assessment',
    'requisition_ticket', 'distribution_log', 'bulk_return_pool', 'bulk_return_claim', 'loan_return_reservation',
    'bulk_return_entry', 'bulk_return_entry_move', 'bulk_return_entry_void',
    'bulk_return_loan_reopen',
    'meal_service_receipt',
    'shelter_incident', 'daily_sop_role_assessment'
  ];
  if (allowed.indexOf(newDoc.type) === -1) {
    throw { forbidden: 'doc type not allowed yet: ' + newDoc.type };
  }
  // 1. append-only: stock_ledger / audit / movement / screening are never rewritten
  if (appendOnly.indexOf(newDoc.type) !== -1 && oldDoc) {
    throw { forbidden: 'Cannot update append-only ' + newDoc.type + ' documents' };
  }
  if (newDoc.type === 'kitchen_requisition' && oldDoc) {
    if (oldDoc.status === 'approved' || oldDoc.status === 'rejected') {
      throw { forbidden: 'Cannot update finalized kitchen_requisition documents' };
    }
  }
  // Shelter Incident Log (CR-155, schema.md §2.10): incident staff (system_admin, or a security officer /
  // shelter manager of this shelter) open a record and become owner; each update appends exactly one timeline entry by the caller. Owner or
  // manager changes status / hands over / identifies the respondent; any incident staff may
  // add a note; cancel is manager-only; closed/cancelled are final and records are never deleted.
  if (newDoc.type === 'shelter_incident') {
    var incStatuses = ['reported', 'action_in_progress', 'resolved', 'closed', 'cancelled'];
    var incTransitions = {
      reported: ['action_in_progress', 'cancelled'],
      action_in_progress: ['resolved', 'cancelled'],
      resolved: ['closed', 'action_in_progress'],
      closed: [],
      cancelled: []
    };
    var incManager = isRole('shelter_manager');
    var incStaff = userCtx.roles.indexOf('system_admin') !== -1 ||
      (userCtx.roles.indexOf('shelter:${code}') !== -1 &&
        (isRole('security_officer') || isRole('shelter_manager')));
    if (!incStaff) {
      throw { forbidden: 'Only security officers or shelter managers of this shelter can write shelter_incident' };
    }
    if (!/^shelter_incident:[0-9A-HJKMNP-TV-Z]{26}$/.test(newDoc._id)) {
      throw { forbidden: 'shelter_incident id must be shelter_incident:{ulid}' };
    }
    if (newDoc.schema_v !== 1) {
      throw { forbidden: 'shelter_incident schema_v must be 1' };
    }
    if (incStatuses.indexOf(newDoc.current_status) === -1) {
      throw { forbidden: 'Invalid shelter_incident current_status' };
    }
    if (typeof newDoc.assigned_to !== 'string' || !newDoc.assigned_to) {
      throw { forbidden: 'shelter_incident assigned_to is required' };
    }
    if (!Array.isArray(newDoc.timeline)) {
      throw { forbidden: 'shelter_incident timeline must be an array' };
    }
    if (!oldDoc) {
      if (newDoc.reported_by !== userCtx.name || newDoc.assigned_to !== userCtx.name ||
          newDoc.created_by !== userCtx.name) {
        throw { forbidden: 'New shelter_incident must be reported by and assigned to its creator' };
      }
      if (newDoc.current_status !== 'reported' || newDoc.timeline.length !== 0) {
        throw { forbidden: 'New shelter_incident must start as reported with an empty timeline' };
      }
      if (typeof newDoc.title !== 'string' || !newDoc.title.trim() || newDoc.title.length > 120) {
        throw { forbidden: 'shelter_incident title is required (1-120 characters)' };
      }
      // Facts are immutable after create, so shape is checked once here (IL-D4/D5/D7/D8).
      var incCategories = ['harassment_violence', 'theft_property_damage', 'substance_rule_violation',
        'fraud_resource_abuse', 'medical_mental_health', 'dispute', 'other'];
      if (incCategories.indexOf(newDoc.category) === -1 ||
          ['low', 'medium', 'high', 'critical'].indexOf(newDoc.severity) === -1) {
        throw { forbidden: 'Invalid shelter_incident category or severity' };
      }
      if (typeof newDoc.occurred_at !== 'string' || isNaN(Date.parse(newDoc.occurred_at))) {
        throw { forbidden: 'shelter_incident occurred_at must be a timestamp' };
      }
      var incTexts = [['incident_no', 40], ['location_detail', 200], ['description', 4000]];
      for (var incTextIndex = 0; incTextIndex < incTexts.length; incTextIndex++) {
        var incText = newDoc[incTexts[incTextIndex][0]];
        if (typeof incText !== 'string' || !incText.trim() || incText.length > incTexts[incTextIndex][1]) {
          throw { forbidden: 'shelter_incident ' + incTexts[incTextIndex][0] + ' is required' };
        }
      }
      if (!Array.isArray(newDoc.attachments)) {
        throw { forbidden: 'shelter_incident attachments must be an array' };
      }
      var incComplainant = newDoc.complainant || {};
      var incRespondent = newDoc.respondent || {};
      if (['evacuee', 'staff', 'external', 'shelter_property', 'anonymous']
            .indexOf(incComplainant.type) === -1 ||
          (incComplainant.type === 'evacuee' && !incComplainant.evacuee_id) ||
          ((incComplainant.type === 'staff' || incComplainant.type === 'external') &&
            !incComplainant.name_or_detail)) {
        throw { forbidden: 'Invalid shelter_incident complainant' };
      }
      if (['known_evacuee', 'known_external', 'unknown', 'none'].indexOf(incRespondent.status) === -1 ||
          (incRespondent.status === 'known_evacuee' && !incRespondent.evacuee_id) ||
          (incRespondent.status === 'known_external' && !incRespondent.name_or_detail)) {
        throw { forbidden: 'Invalid shelter_incident respondent' };
      }
    } else {
      if (oldDoc.current_status === 'closed' || oldDoc.current_status === 'cancelled') {
        throw { forbidden: 'Closed or cancelled shelter_incident cannot be modified' };
      }
      var incFixed = ['incident_no', 'title', 'location_detail', 'category', 'severity', 'occurred_at',
        'reported_by', 'description', 'attachments', 'complainant', 'created_at', 'created_by'];
      for (var incFixedIndex = 0; incFixedIndex < incFixed.length; incFixedIndex++) {
        var incField = incFixed[incFixedIndex];
        if (JSON.stringify(newDoc[incField]) !== JSON.stringify(oldDoc[incField])) {
          throw { forbidden: 'shelter_incident ' + incField + ' is immutable' };
        }
      }
      var oldTimeline = oldDoc.timeline || [];
      if (newDoc.timeline.length !== oldTimeline.length + 1 ||
          JSON.stringify(newDoc.timeline.slice(0, oldTimeline.length)) !== JSON.stringify(oldTimeline)) {
        throw { forbidden: 'shelter_incident update must append exactly one timeline entry' };
      }
      var incEntry = newDoc.timeline[newDoc.timeline.length - 1] || {};
      if (incEntry.actor_id !== userCtx.name) {
        throw { forbidden: 'shelter_incident timeline actor must be the caller' };
      }
      if (typeof incEntry.timestamp !== 'string' || !incEntry.timestamp) {
        throw { forbidden: 'shelter_incident timeline timestamp is required' };
      }
      if (typeof incEntry.details !== 'string' || !incEntry.details.trim()) {
        throw { forbidden: 'shelter_incident timeline details (action & reason) are required' };
      }
      var incOwnerOrManager = oldDoc.assigned_to === userCtx.name || incManager;
      var incStatusSame = newDoc.current_status === oldDoc.current_status;
      var incAssigneeSame = newDoc.assigned_to === oldDoc.assigned_to;
      var incRespondentSame = JSON.stringify(newDoc.respondent) === JSON.stringify(oldDoc.respondent);
      if (incEntry.type === 'add_note') {
        if (!incStatusSame || !incAssigneeSame || !incRespondentSame) {
          throw { forbidden: 'shelter_incident add_note cannot change other fields' };
        }
      } else if (incEntry.type === 'status_change') {
        var incFrom = oldDoc.current_status;
        var incTo = newDoc.current_status;
        if (incEntry.from_status !== incFrom || incEntry.to_status !== incTo ||
            (incTransitions[incFrom] || []).indexOf(incTo) === -1) {
          throw { forbidden: 'Invalid shelter_incident transition from ' + incFrom + ' to ' + incTo };
        }
        if (!incAssigneeSame || !incRespondentSame) {
          throw { forbidden: 'shelter_incident status_change cannot change other fields' };
        }
        if (incTo === 'cancelled' && !incManager) {
          throw { forbidden: 'Only shelter managers can cancel a shelter_incident' };
        }
        if (!incOwnerOrManager) {
          throw { forbidden: 'Only the assignee or a shelter manager can change shelter_incident status' };
        }
      } else if (incEntry.type === 'reassignment') {
        if (!incOwnerOrManager) {
          throw { forbidden: 'Only the assignee or a shelter manager can reassign a shelter_incident' };
        }
        if (incAssigneeSame || incEntry.from_assignee !== oldDoc.assigned_to ||
            incEntry.to_assignee !== newDoc.assigned_to) {
          throw { forbidden: 'shelter_incident reassignment entry does not match assigned_to' };
        }
        if (!incStatusSame || !incRespondentSame) {
          throw { forbidden: 'shelter_incident reassignment cannot change other fields' };
        }
      } else if (incEntry.type === 'identify_respondent') {
        if (!incOwnerOrManager) {
          throw { forbidden: 'Only the assignee or a shelter manager can identify the respondent' };
        }
        var incNextRespondent = newDoc.respondent || {};
        if (!oldDoc.respondent || oldDoc.respondent.status !== 'unknown' ||
            (incNextRespondent.status !== 'known_evacuee' && incNextRespondent.status !== 'known_external')) {
          throw { forbidden: 'shelter_incident respondent can only go from unknown to known' };
        }
        if (incNextRespondent.status === 'known_evacuee' && !incNextRespondent.evacuee_id) {
          throw { forbidden: 'known_evacuee respondent requires evacuee_id' };
        }
        if (incNextRespondent.status === 'known_external' && !incNextRespondent.name_or_detail) {
          throw { forbidden: 'known_external respondent requires name_or_detail' };
        }
        if (!incStatusSame || !incAssigneeSame) {
          throw { forbidden: 'shelter_incident identify_respondent cannot change other fields' };
        }
      } else {
        throw { forbidden: 'Unknown shelter_incident timeline entry type' };
      }
    }
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
  // Each role assessment is checked against the embedded CR v1 contract. Keep
  // this self-contained: CouchDB must not need external configuration at write time.
  if (newDoc.type === 'daily_sop_role_assessment') {
    var contract = ${dailySopRoleContract};
    var roles = contract.roles;
    var role = null;
    for (var roleIndex = 0; roleIndex < roles.length; roleIndex++) {
      if (roles[roleIndex].code === newDoc.role_code) role = roles[roleIndex];
    }
    function exactKeys(value, allowedKeys) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      var keys = Object.keys(value).sort();
      var expected = allowedKeys.slice().sort();
      if (keys.length !== expected.length) return false;
      for (var keyIndex = 0; keyIndex < keys.length; keyIndex++) {
        if (keys[keyIndex] !== expected[keyIndex]) return false;
      }
      return true;
    }
    function validDate(value) {
      if (typeof value !== 'string' || !/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return false;
      var parts = value.split('-');
      var year = Number(parts[0]);
      var month = Number(parts[1]);
      var day = Number(parts[2]);
      if (month < 1 || month > 12 || day < 1) return false;
      var leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
      var days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      return day <= days[month - 1];
    }
    function validTimestamp(value) {
      if (typeof value !== 'string') return false;
      var match = /^(\\d{4}-\\d{2}-\\d{2})T(\\d{2}):(\\d{2}):(\\d{2})(?:\\.\\d+)?Z$/.exec(value);
      return !!match && validDate(match[1]) && Number(match[2]) <= 23 &&
        Number(match[3]) <= 59 && Number(match[4]) <= 59 && isFinite(Date.parse(value));
    }
    function nonEmpty(value) { return typeof value === 'string' && value.trim().length > 0; }
    function validPositiveDecimal(value) {
      return typeof value === 'string' && /^(?:0|[1-9]\\d*)(?:\\.\\d+)?$/.test(value) &&
        isFinite(Number(value)) && Number(value) > 0;
    }
    function decimalPlaces(value) {
      var text = String(value);
      if (text.indexOf('e') !== -1 || text.indexOf('E') !== -1) {
        var parts = text.toLowerCase().split('e');
        var fraction = parts[0].split('.')[1] || '';
        return Math.max(0, fraction.length - Number(parts[1]));
      }
      return (text.split('.')[1] || '').length;
    }
    function stepAligned(value, step) {
      if (typeof value !== 'number' || !isFinite(value) || value < 0) return false;
      var precision = Math.max(decimalPlaces(value), decimalPlaces(step));
      var scale = Math.pow(10, precision);
      var scaledValue = Math.round(value * scale);
      var scaledStep = Math.round(Number(step) * scale);
      return isFinite(scaledValue) && Math.abs(value * scale - scaledValue) < 1e-7 &&
        scaledValue <= 9007199254740991 && scaledStep > 0 && scaledValue % scaledStep === 0;
    }
    function hasCapability(capability) {
      if (userCtx.roles.indexOf('${code}:' + capability) !== -1) return true;
      var shelterScopes = [];
      for (var scopeIndex = 0; scopeIndex < userCtx.roles.length; scopeIndex++) {
        if (/^shelter:[^:]+$/.test(userCtx.roles[scopeIndex])) shelterScopes.push(userCtx.roles[scopeIndex]);
      }
      return userCtx.roles.indexOf(capability) !== -1 && shelterScopes.length === 1 &&
        shelterScopes[0] === 'shelter:${code}';
    }
    function validControlSnapshot(control, question) {
      if (!exactKeys(control, ['id', 'question', 'metric_spec', 'status', 'notes', 'observations',
          'measured_values', 'checked_by', 'checked_by_name', 'checked_at']) &&
          !exactKeys(control, ['id', 'question', 'metric_spec', 'status', 'notes', 'observations',
            'measured_values', 'checked_by', 'checked_at'])) return false;
      if (control.id !== question.id || typeof control.question !== 'string' ||
          ['Pass', 'Fail', 'Pending', null].indexOf(control.status) === -1 ||
          typeof control.notes !== 'string' || typeof control.observations !== 'string' ||
          !control.measured_values || typeof control.measured_values !== 'object' ||
          Array.isArray(control.measured_values) ||
          !nonEmpty(control.checked_by) || !validTimestamp(control.checked_at) ||
          (typeof control.checked_by_name !== 'undefined' && !nonEmpty(control.checked_by_name))) return false;
      if (control.status === 'Pending' && !control.notes.trim()) return false;
      if (question.metric === null) {
        return control.question === question.text && control.metric_spec === null &&
          exactKeys(control.measured_values, []);
      }
      var definition = question.metric;
      if (definition.parameterKey && control.metric_spec === null) {
        return control.question === question.text && control.status === 'Pending' &&
          !!control.notes.trim() && exactKeys(control.measured_values, []);
      }
      if (!exactKeys(control.metric_spec, ['fields', 'threshold']) &&
          !exactKeys(control.metric_spec, ['fields', 'threshold', 'parameter'])) return false;
      if (!Array.isArray(control.metric_spec.fields) || control.metric_spec.fields.length !== definition.fields.length) return false;
      for (var fieldIndex = 0; fieldIndex < definition.fields.length; fieldIndex++) {
        var actualField = control.metric_spec.fields[fieldIndex];
        var expectedField = definition.fields[fieldIndex];
        if (!exactKeys(actualField, ['key', 'label', 'unit', 'step']) ||
            actualField.key !== expectedField.key || actualField.label !== expectedField.label ||
            actualField.unit !== expectedField.unit || actualField.step !== expectedField.step ||
            !validPositiveDecimal(actualField.step)) return false;
      }
      var threshold = definition.threshold;
      if (definition.parameterKey) {
        var parameter = control.metric_spec.parameter;
        if (!exactKeys(parameter, ['key', 'value']) || parameter.key !== definition.parameterKey ||
            !validPositiveDecimal(parameter.value)) return false;
        threshold = threshold.replace('{parameter}', parameter.value);
        if (control.question !== question.text.replace('{' + definition.parameterKey + '}', parameter.value)) return false;
      } else if (typeof control.metric_spec.parameter !== 'undefined') {
        return false;
      } else if (control.question !== question.text) {
        return false;
      }
      if (control.metric_spec.threshold !== threshold) return false;
      var expectedKeys = [];
      for (var expectedIndex = 0; expectedIndex < definition.fields.length; expectedIndex++) {
        expectedKeys.push(definition.fields[expectedIndex].key);
      }
      if (!exactKeys(control.measured_values, expectedKeys)) return false;
      for (var measureIndex = 0; measureIndex < definition.fields.length; measureIndex++) {
        var measure = control.measured_values[definition.fields[measureIndex].key];
        if (measure !== null && !stepAligned(measure, definition.fields[measureIndex].step)) return false;
      }
      return true;
    }
    var applicationKeys = ['_id', '_rev', '_revisions', 'type', 'schema_v', 'shelter_code',
      'assessment_date', 'role_code', 'role_key', 'role_label', 'question_set_version', 'assessed_at',
      'assessor_name', 'status', 'pass_count', 'fail_count', 'pending_count', 'unanswered_count',
      'controls', 'created_at', 'updated_at', 'created_by'];
    var topKeys = Object.keys(newDoc);
    for (var topIndex = 0; topIndex < topKeys.length; topIndex++) {
      if (applicationKeys.indexOf(topKeys[topIndex]) === -1) {
        throw { forbidden: 'Daily SOP role assessment contains an unregistered field' };
      }
    }
    if (!role || newDoc.type !== 'daily_sop_role_assessment' || newDoc.schema_v !== 1 ||
        newDoc.shelter_code !== '${code}' || !validDate(newDoc.assessment_date) ||
        newDoc._id !== 'daily_sop_role_assessment:' + newDoc.shelter_code + ':' +
          newDoc.assessment_date + ':' + newDoc.role_code ||
        newDoc.role_key !== role.key || newDoc.role_label !== role.label ||
        (typeof newDoc.question_set_version !== 'undefined' && newDoc.question_set_version !== contract.version) ||
        !validTimestamp(newDoc.assessed_at) || !nonEmpty(newDoc.assessor_name) ||
        !validTimestamp(newDoc.created_at) || !validTimestamp(newDoc.updated_at) || !nonEmpty(newDoc.created_by) ||
        ['InProgress', 'Completed'].indexOf(newDoc.status) === -1 || !Array.isArray(newDoc.controls) ||
        newDoc.controls.length !== role.questions.length) {
      throw { forbidden: 'Daily SOP role assessment schema, date, identity, or question set is invalid' };
    }
    var bangkokNow = new Date(new Date().getTime() + 7 * 60 * 60 * 1000);
    var bangkokMonth = String(bangkokNow.getUTCMonth() + 1);
    var bangkokDay = String(bangkokNow.getUTCDate());
    var currentBangkokDate = bangkokNow.getUTCFullYear() + '-' +
      (bangkokMonth.length === 1 ? '0' + bangkokMonth : bangkokMonth) + '-' +
      (bangkokDay.length === 1 ? '0' + bangkokDay : bangkokDay);
    if (!isCouchAdmin && newDoc.assessment_date !== currentBangkokDate) {
      throw { forbidden: 'Daily SOP role assessments can only be saved for the current Bangkok date' };
    }
    var allowedOwner = false;
    for (var capabilityIndex = 0; capabilityIndex < role.capabilities.length; capabilityIndex++) {
      if (hasCapability(role.capabilities[capabilityIndex])) allowedOwner = true;
    }
    if (!isCouchAdmin && userCtx.roles.indexOf('system_admin') === -1 &&
        !hasCapability('shelter_manager') && !allowedOwner) {
      throw { forbidden: 'Daily SOP role assessment requires the role owner or shelter manager' };
    }
    if (oldDoc && (
        newDoc._id !== oldDoc._id || newDoc.shelter_code !== oldDoc.shelter_code ||
        newDoc.assessment_date !== oldDoc.assessment_date || newDoc.role_code !== oldDoc.role_code ||
        newDoc.role_key !== oldDoc.role_key || newDoc.role_label !== oldDoc.role_label ||
        newDoc.question_set_version !== oldDoc.question_set_version || newDoc.assessed_at !== oldDoc.assessed_at ||
        newDoc.assessor_name !== oldDoc.assessor_name || newDoc.created_at !== oldDoc.created_at ||
        newDoc.created_by !== oldDoc.created_by)) {
      throw { forbidden: 'Daily SOP role identity, version, and creation metadata cannot change' };
    }
    if (!oldDoc && !isCouchAdmin && newDoc.created_by !== userCtx.name) {
      throw { forbidden: 'Daily SOP role created_by must match the authenticated user' };
    }
    var passCount = 0;
    var failCount = 0;
    var pendingCount = 0;
    var unansweredCount = 0;
    var hasRecordedInput = false;
    for (var controlIndex = 0; controlIndex < role.questions.length; controlIndex++) {
      var control = newDoc.controls[controlIndex];
      var question = role.questions[controlIndex];
      if (!validControlSnapshot(control, question)) {
        throw { forbidden: 'Daily SOP role control does not match the registered snapshot contract' };
      }
      var previous = oldDoc && oldDoc.controls ? oldDoc.controls[controlIndex] : null;
      if (oldDoc && (!previous || previous.id !== control.id || previous.question !== control.question ||
          JSON.stringify(previous.metric_spec) !== JSON.stringify(control.metric_spec))) {
        throw { forbidden: 'Daily SOP role question and metric snapshots cannot change' };
      }
      var controlChanged = !previous || previous.status !== control.status || previous.notes !== control.notes ||
        previous.observations !== control.observations ||
        JSON.stringify(previous.measured_values) !== JSON.stringify(control.measured_values) ||
        previous.checked_by !== control.checked_by || previous.checked_by_name !== control.checked_by_name ||
        previous.checked_at !== control.checked_at;
      if (!isCouchAdmin && controlChanged && control.checked_by !== userCtx.name) {
        throw { forbidden: 'Daily SOP role checked_by must match the authenticated user' };
      }
      if (!oldDoc && !isCouchAdmin && control.checked_by !== userCtx.name) {
        throw { forbidden: 'New Daily SOP role controls must record the authenticated creator' };
      }
      if (control.status !== null || control.notes.trim() || control.observations.trim()) hasRecordedInput = true;
      var recordedKeys = Object.keys(control.measured_values);
      for (var recordedIndex = 0; recordedIndex < recordedKeys.length; recordedIndex++) {
        if (control.measured_values[recordedKeys[recordedIndex]] !== null) hasRecordedInput = true;
      }
      if (control.status === 'Pass') passCount++;
      else if (control.status === 'Fail') failCount++;
      else if (control.status === 'Pending') pendingCount++;
      else unansweredCount++;
    }
    if (newDoc.pass_count !== passCount || newDoc.fail_count !== failCount ||
        newDoc.pending_count !== pendingCount || newDoc.unanswered_count !== unansweredCount ||
        newDoc.status !== (unansweredCount === 0 ? 'Completed' : 'InProgress')) {
      throw { forbidden: 'Daily SOP role summary does not match its controls' };
    }
    if (!oldDoc && !hasRecordedInput) {
      throw { forbidden: 'Daily SOP role assessment cannot be saved without an answer or recorded observation' };
    }
    if (JSON.stringify(newDoc).length > 524288) {
      throw { forbidden: 'Daily SOP role assessment document is too large' };
    }
  }
  // Shelter Readiness SOP Assessment
  if (newDoc.type === 'shelter_readiness_assessment') {
    if (oldDoc && (
        newDoc._id !== oldDoc._id ||
        newDoc.type !== oldDoc.type ||
        newDoc.shelter_code !== oldDoc.shelter_code ||
        newDoc.created_at !== oldDoc.created_at ||
        newDoc.created_by !== oldDoc.created_by)) {
      throw { forbidden: 'Shelter readiness assessment identity and creation metadata cannot change' };
    }
    if (newDoc.schema_v !== 1 || ['draft', 'submitted'].indexOf(newDoc.status) === -1) {
      throw { forbidden: 'Shelter readiness assessment schema/status is invalid' };
    }
    if (newDoc._id.indexOf('shelter_readiness_assessment:' + newDoc.shelter_code + ':') !== 0) {
      throw { forbidden: 'Shelter readiness assessment id must start with shelter_readiness_assessment:' + newDoc.shelter_code + ':' };
    }
  }
  // 2. donation status is forward-only — no going back to declared
  if (newDoc.type === 'donation' && oldDoc) {
    if (oldDoc.status === 'received' && newDoc.status === 'declared') {
      throw { forbidden: 'Cannot revert donation status back to declared' };
    }
  }
  // 2b. zone_change (schema.md §1.4, CR-106 FR-16) must only apply to a person
  // currently active/room_confirmed. The movement doc that names the action
  // is append-only and cannot see the evacuee it refers to, so the rule has
  // to live here instead: a same-status zone change (status unchanged,
  // zone changed) is the movement-doc signature of a rezone/zone_change —
  // mirror ZONE_CHANGE_ELIGIBLE_STATUSES in
  // frontend/src/lib/features/people/domain/people.ts if that list ever changes.
  if (newDoc.type === 'evacuee' && oldDoc && oldDoc.current_stay && newDoc.current_stay) {
    var zoneChanged = newDoc.current_stay.zone !== oldDoc.current_stay.zone;
    var stayStatusUnchanged = newDoc.current_stay.status === oldDoc.current_stay.status;
    if (zoneChanged && stayStatusUnchanged) {
      var zoneChangeEligibleStatuses = ['active', 'room_confirmed'];
      if (zoneChangeEligibleStatuses.indexOf(oldDoc.current_stay.status) === -1) {
        throw { forbidden: 'zone_change requires current_stay.status active or room_confirmed' };
      }
    }
  }
  // 3. only warehouse staff / managers may write stock
  if (newDoc.type === 'stock_ledger') {
    var isWarehouseOrAdmin = isRole('warehouse_staff');
    var isStaff =
      isWarehouseOrAdmin ||
      isRole('supply_coordinator') ||
      isRole('shelter_manager');
    // CR-161 R3: distribution_staff may only receive a physical loan return back into stock.
    var isLoanReturnReceipt =
      newDoc.reason === 'receive' &&
      typeof newDoc.ref_id === 'string' &&
      /^distribution_log:.+/.test(newDoc.ref_id);
    if (!isStaff && !(isLoanReturnReceipt && isRole('distribution_staff'))) {
      throw { forbidden: 'Only warehouse staff or managers can write stock ledger' };
    }
    // A DST receipt must look exactly like a counter loan return (return-workflow.ts): own actor,
    // whole positive qty, the counter-return lot note and a deterministic id. The VDU cannot read
    // the referenced log, so item/qty are not bound to it — that residual risk is accepted by
    // CR-161 R3 (physical return for DST) and mirrors warehouse receipts.
    if (!isStaff) {
      if (newDoc.created_by !== userCtx.name) {
        throw { forbidden: 'Loan return stock ledger created_by must match the current actor' };
      }
      if (typeof newDoc.qty !== 'string' || !/^[1-9]\\d*$/.test(newDoc.qty)) {
        throw { forbidden: 'Loan return stock ledger qty must be a positive whole number' };
      }
      if (!newDoc.lot || newDoc.lot.note !== 'counter_loan_return') {
        throw { forbidden: 'Loan return stock ledger must carry the counter_loan_return lot note' };
      }
      // Only the fields returnLoanAtCounter writes — no expiry or other lot metadata.
      var loanReturnLotKeys = Object.keys(newDoc.lot);
      for (var lk = 0; lk < loanReturnLotKeys.length; lk++) {
        if (['note', 'produced_at'].indexOf(loanReturnLotKeys[lk]) === -1) {
          throw { forbidden: 'Loan return stock ledger lot may only carry note and produced_at' };
        }
      }
      if (typeof newDoc._id !== 'string' || !/^stock_ledger:[0-9A-HJKMNP-TV-Z]{26}$/.test(newDoc._id)) {
        throw { forbidden: 'Loan return stock ledger requires a stock_ledger:{26-char id}' };
      }
    }
    if (newDoc.reason === 'distribute') {
      if (typeof newDoc.ref_id !== 'string' || (!/^distribution_batch:.+/.test(newDoc.ref_id) && !/^requisition_ticket:.+/.test(newDoc.ref_id))) {
        throw { forbidden: 'Distribute stock ledger requires distribution_batch ref_id or requisition_ticket ref_id' };
      }
      if (/^requisition_ticket:direct-.+/.test(newDoc.ref_id)) {
        // Direct issue from the stock page (#837): supply_coordinator does not issue (CR-156 FR-H1).
        if (!isWarehouseOrAdmin && !isRole('shelter_manager')) {
          throw { forbidden: 'Only warehouse staff, shelter manager, or system admin can write direct distribute stock ledger' };
        }
      } else if (/^requisition_ticket:.+/.test(newDoc.ref_id)) {
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
      // CR-208: a ticket's leftovers go back into their source lot; a direct issue has no return step.
      var isTicketReturn =
        typeof newDoc.ref_id === 'string' &&
        /^requisition_ticket:.+/.test(newDoc.ref_id) &&
        !/^requisition_ticket:direct-/.test(newDoc.ref_id);
      var isBatchReturn = typeof newDoc.ref_id === 'string' && /^distribution_batch:.+/.test(newDoc.ref_id);
      if (!isTicketReturn && !isBatchReturn) {
        throw { forbidden: 'Distribution return stock ledger requires distribution_batch or non-direct requisition_ticket ref_id' };
      }
      // Ticket returns follow canReceiveWarehouseReturns; the legacy batch flow keeps its narrower gate.
      if (isBatchReturn && !isWarehouseOrAdmin) {
        throw { forbidden: 'Only warehouse staff or system admin can write distribution return stock ledger' };
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
      // CR-178: ticket-era requisition dispatch is per lot; legacy kitchen_requisition rows stay unrestricted.
      if (/^requisition_ticket:.+/.test(newDoc.ref_id)) {
        if (typeof newDoc.lot_ref !== 'string' || !/^stock_ledger:.+/.test(newDoc.lot_ref)) {
          throw { forbidden: 'Requisition stock ledger for a requisition_ticket requires physical stock_ledger lot_ref' };
        }
        if (typeof newDoc.qty !== 'string' || !/^-\\d+(\\.\\d{1,4})?$/.test(newDoc.qty)) {
          throw { forbidden: 'Requisition stock ledger qty must be a negative decimal string' };
        }
      }
    }
    if (newDoc.reason === 'receive') {
      if (newDoc.ref_id !== null && typeof newDoc.ref_id !== 'undefined') {
        if (typeof newDoc.ref_id !== 'string' || (!/^meal_service:.+/.test(newDoc.ref_id) && !/^requisition_ticket:.+/.test(newDoc.ref_id) && !/^distribution_log:.+/.test(newDoc.ref_id) && !/^bulk_return_pool:[0-9A-HJKMNP-TV-Z]{26}$/.test(newDoc.ref_id))) {
          throw { forbidden: 'Receive stock ledger ref_id must reference meal_service, requisition_ticket, distribution_log, or bulk_return_pool' };
        }
      }
    }
    // CR-143 §C (stock_ledger schema_v 6): adjust_reason + note belong to adjust rows only.
    var hasAdjustReason = typeof newDoc.adjust_reason !== 'undefined' && newDoc.adjust_reason !== null;
    var hasLedgerNote = typeof newDoc.note !== 'undefined' && newDoc.note !== null;
    if (newDoc.reason === 'adjust') {
      var adjustReasons = ['expired', 'damaged', 'count_mismatch', 'lost', 'found', 'merge', 'other'];
      if (hasAdjustReason && adjustReasons.indexOf(newDoc.adjust_reason) === -1) {
        throw { forbidden: 'Adjust stock ledger adjust_reason must be one of ' + adjustReasons.join(', ') };
      }
      // Rows stamped before schema_v 6 (older clients mid-rollout) have no reason; readers map it to other.
      if (!hasAdjustReason && typeof newDoc.schema_v === 'number' && newDoc.schema_v >= 6) {
        throw { forbidden: 'Adjust stock ledger requires adjust_reason' };
      }
      // CR-156 FR-C9: the catch-all reason must say what happened. Old rows stay readable (FR-C10).
      if (newDoc.adjust_reason === 'other' && (typeof newDoc.note !== 'string' || newDoc.note.trim().length === 0)) {
        throw { forbidden: 'Adjust stock ledger with adjust_reason other requires a non-empty note' };
      }
      if (hasLedgerNote && (typeof newDoc.note !== 'string' || newDoc.note.length > 500)) {
        throw { forbidden: 'Adjust stock ledger note must be a string of at most 500 characters' };
      }
      // CR-143 §F (FR-F4): moving stock between items is the merge flow's job; a supply
      // coordinator may adjust stock but may not merge items, and 'note' must name the other side.
      if (newDoc.adjust_reason === 'merge') {
        if (!isWarehouseOrAdmin && !isRole('shelter_manager')) {
          throw { forbidden: 'Only warehouse staff, shelter manager, or system admin can write merge stock ledger' };
        }
        if (typeof newDoc.note !== 'string' || !/^item_master:.+/.test(newDoc.note)) {
          throw { forbidden: 'Merge stock ledger note must be the item_master id of the other side' };
        }
        if (newDoc.ref_id !== null && typeof newDoc.ref_id !== 'undefined') {
          throw { forbidden: 'Merge stock ledger must not carry a ref_id' };
        }
      }
    } else {
      if (hasAdjustReason) {
        throw { forbidden: 'Stock ledger adjust_reason is only allowed when reason is adjust' };
      }
      if (hasLedgerNote) {
        throw { forbidden: 'Stock ledger note is only allowed when reason is adjust' };
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
      isRole('distribution_staff') ||
      isRole('shelter_manager');
    if (!oldDoc) {
      if (newDoc.status !== 'pending') {
        throw { forbidden: 'New distribution_request must start pending' };
      }
      if (!isRequestEditor) {
        throw { forbidden: 'Only distribution staff, shelter manager, or system admin can create distribution requests' };
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
    // shelter_manager may also issue stock directly (#837), which claims the lot first.
    var isReservationStaff = isRole('warehouse_staff') || isRole('shelter_manager');
    if (!isReservationStaff) {
      throw { forbidden: 'Only warehouse staff, shelter manager, or system admin can manage stock lot reservations' };
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
      isRole('distribution_staff') ||
      isRole('shelter_manager');
    if (!isIssueStaff) {
      throw { forbidden: 'Only distribution staff, shelter manager, or system admin can write distribution issues' };
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
      isRole('distribution_staff') ||
      isRole('shelter_manager');
    if (!isIssueStaffIdem) {
      throw { forbidden: 'Only distribution staff, shelter manager, or system admin can manage issue idempotency' };
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
      isRole('distribution_staff') ||
      isRole('shelter_manager');
    if (!isIssueStaffCap) {
      throw { forbidden: 'Only distribution staff, shelter manager, or system admin can manage issue capacity' };
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
    var isIssueGateStaff = isRole('distribution_staff') || isRole('shelter_manager');
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
      isRole('distribution_staff') ||
      isRole('shelter_manager');
    if (!isIssueStaffGuard) {
      throw { forbidden: 'Only distribution staff, shelter manager, or system admin can manage one-time guard' };
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
  // 11. requisition_ticket lifecycle and role rules — kitchen slice carve-out
  // (CR-121/CR-141..145). food/supplies/transfer use the fuller CR-121 lifecycle
  // (amendments/DISTRIBUTING/frontline distribution) in the next rule below —
  // implemented independently on develop while this carve-out shipped on this
  // branch, so the two are kept as separate requisition_type-gated rules
  // rather than merged into one transition table.
  if (newDoc.type === 'requisition_ticket' && newDoc.requisition_type === 'kitchen') {
    if (!oldDoc) {
      if (newDoc.status !== 'PENDING_PICK') {
        throw { forbidden: 'New requisition_ticket must start PENDING_PICK' };
      }
      if (!isRole('kitchen_staff')) {
        throw { forbidden: 'Only kitchen staff or system admin can open a requisition_ticket' };
      }
      if (typeof newDoc.meal_plan_id !== 'string' || !newDoc.meal_plan_id) {
        throw { forbidden: 'requisition_ticket requires meal_plan_id' };
      }
      if (newDoc.requested_by !== userCtx.name) {
        throw { forbidden: 'requested_by must match the authenticated user' };
      }
      if (!Array.isArray(newDoc.items) || newDoc.items.length === 0) {
        throw { forbidden: 'requisition_ticket requires at least one item' };
      }
      for (var newTicketIndex = 0; newTicketIndex < newDoc.items.length; newTicketIndex++) {
        if (newDoc.items[newTicketIndex].allocated_qty !== '0') {
          throw { forbidden: 'New requisition_ticket items must start allocated_qty "0"' };
        }
      }
      if (typeof newDoc.approved_by !== 'undefined' || typeof newDoc.dispatched_by !== 'undefined' ||
          typeof newDoc.received_by !== 'undefined') {
        throw { forbidden: 'New requisition_ticket cannot contain lifecycle metadata' };
      }
    }
    if (oldDoc) {
      if (newDoc._id !== oldDoc._id) throw { forbidden: 'Cannot change _id' };
      if (newDoc.type !== oldDoc.type) throw { forbidden: 'Cannot change type' };
      if (newDoc.shelter_code !== oldDoc.shelter_code) throw { forbidden: 'Cannot change shelter_code' };
      if (newDoc.meal_plan_id !== oldDoc.meal_plan_id) throw { forbidden: 'Cannot change meal_plan_id' };
      var ticketFrom = oldDoc.status;
      var ticketTo = newDoc.status;
      var ticketTransitions = {
        PENDING_PICK: ['PENDING_PICK', 'READY_FOR_DISPATCH', 'CANCELLED'],
        READY_FOR_DISPATCH: ['IN_TRANSIT', 'CANCELLED'],
        IN_TRANSIT: ['COMPLETED'],
        COMPLETED: [],
        CANCELLED: []
      };
      var ticketAllowedNext = ticketTransitions[ticketFrom] || [];
      if (ticketAllowedNext.indexOf(ticketTo) === -1) {
        throw { forbidden: 'Invalid requisition_ticket transition from ' + ticketFrom + ' to ' + ticketTo };
      }
      if (ticketFrom !== 'PENDING_PICK' && JSON.stringify(newDoc.items) !== JSON.stringify(oldDoc.items)) {
        throw { forbidden: 'Cannot modify requisition_ticket items once past PENDING_PICK' };
      }
      if (
        ticketFrom === 'PENDING_PICK' &&
        ticketTo === 'PENDING_PICK' &&
        !isRole('warehouse_staff') &&
        !isRole('supply_coordinator') &&
        !isRole('kitchen_staff')
      ) {
        // warehouse_staff allocates (allocated_qty); kitchen_staff edits its own
        // request while nothing's been picked yet (CR-142, requested_qty only).
        throw { forbidden: 'Only warehouse staff, supply coordinator, kitchen staff, or system admin can update requisition_ticket items while PENDING_PICK' };
      }
      if (
        ticketFrom === 'PENDING_PICK' &&
        ticketTo === 'PENDING_PICK' &&
        isRole('kitchen_staff') &&
        !isRole('warehouse_staff') &&
        !isRole('supply_coordinator')
      ) {
        // Kitchen-only editors must not touch allocated_qty (warehouse's field):
        // existing lines keep their old value, new lines start at '0'.
        var kitchenOldItems = oldDoc.items || [];
        var kitchenNewItems = newDoc.items || [];
        for (var kitchenIdx = 0; kitchenIdx < kitchenNewItems.length; kitchenIdx++) {
          var kitchenLine = kitchenNewItems[kitchenIdx];
          var kitchenPrev = null;
          for (var kitchenOldIdx = 0; kitchenOldIdx < kitchenOldItems.length; kitchenOldIdx++) {
            if (kitchenOldItems[kitchenOldIdx].item_id === kitchenLine.item_id) {
              kitchenPrev = kitchenOldItems[kitchenOldIdx];
              break;
            }
          }
          if (kitchenPrev) {
            if (kitchenLine.allocated_qty !== kitchenPrev.allocated_qty) {
              throw { forbidden: 'Kitchen staff cannot change allocated_qty on requisition_ticket items' };
            }
          } else if (kitchenLine.allocated_qty !== '0') {
            throw { forbidden: 'Kitchen staff must add new requisition_ticket items with allocated_qty "0"' };
          }
        }
      }
      if (ticketTo === 'READY_FOR_DISPATCH') {
        if (!isRole('warehouse_staff') && !isRole('supply_coordinator') && !isRole('shelter_manager')) {
          throw { forbidden: 'Only warehouse staff, supply coordinator, shelter manager or system admin can approve a requisition_ticket' };
        }
        var approveAnyPositive = false;
        for (var approveIndex = 0; approveIndex < newDoc.items.length; approveIndex++) {
          var approveAlloc = parseDecimal4(newDoc.items[approveIndex].allocated_qty);
          if (isNaN(approveAlloc) || approveAlloc < 0) {
            throw { forbidden: 'Every requisition_ticket item needs a valid allocated_qty >= 0 before approval' };
          }
          if (approveAlloc > 0) approveAnyPositive = true;
        }
        if (!approveAnyPositive) {
          throw { forbidden: 'At least one requisition_ticket item needs allocated_qty > 0 before approval' };
        }
        if (newDoc.approved_by !== userCtx.name) {
          throw { forbidden: 'approved_by must match the authenticated user' };
        }
      }
      if (ticketTo === 'IN_TRANSIT') {
        if (!isRole('warehouse_staff') && !isRole('supply_coordinator')) {
          throw { forbidden: 'Only warehouse staff, supply coordinator or system admin can dispatch a requisition_ticket' };
        }
        if (newDoc.dispatched_by !== userCtx.name) {
          throw { forbidden: 'dispatched_by must match the authenticated user' };
        }
      }
      if (ticketTo === 'COMPLETED' && ticketFrom === 'IN_TRANSIT') {
        if (!isRole('kitchen_staff')) {
          throw { forbidden: 'Only kitchen staff or system admin can receive a requisition_ticket' };
        }
        if (newDoc.received_by !== userCtx.name) {
          throw { forbidden: 'received_by must match the authenticated user' };
        }
      }
      if (ticketTo === 'CANCELLED') {
        var canCancelTicket = ticketFrom === 'PENDING_PICK'
          ? (isRole('kitchen_staff') || isRole('warehouse_staff') || isRole('supply_coordinator') || isRole('shelter_manager'))
          : (isRole('warehouse_staff') || isRole('supply_coordinator') || isRole('shelter_manager'));
        if (!canCancelTicket) {
          throw { forbidden: 'Not authorized to cancel this requisition_ticket' };
        }
      }
    }
  }
  // 12. CR-121: requisition_ticket validation (Rule 12) — food/supplies/transfer only
  // (kitchen is handled entirely by rule 11 above and never reaches this branch).
  if (newDoc.type === 'requisition_ticket' && newDoc.requisition_type !== 'kitchen') {
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
          if (!canApproveTicket()) throw { forbidden: 'Only warehouse staff, supply coordinators, shelter managers, or system admins can approve requisition_tickets' };
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
  // #658: schema_v 2 adds applied_bulk_entry_ids (v3 bulk return pool entries applied to the loan).
  // A v1 log is lazily upgraded to v2 when the bulk path first writes the field; never 2 -> 1.
  // The legacy bulk path (bulk_pool_id, frontline DST/SM) is unchanged.
  if (newDoc.type === 'distribution_log') {
    if (newDoc.schema_v !== 1 && newDoc.schema_v !== 2) {
      throw { forbidden: 'Unsupported distribution_log schema version' };
    }
    if (typeof newDoc.applied_bulk_entry_ids !== 'undefined') {
      if (newDoc.schema_v !== 2) {
        throw { forbidden: 'distribution_log.applied_bulk_entry_ids requires schema_v 2' };
      }
      if (!Array.isArray(newDoc.applied_bulk_entry_ids)) {
        throw { forbidden: 'distribution_log.applied_bulk_entry_ids must be an array' };
      }
      var seenAppliedEntryIds = {};
      for (var ae = 0; ae < newDoc.applied_bulk_entry_ids.length; ae++) {
        var appliedEntryId = newDoc.applied_bulk_entry_ids[ae];
        if (typeof appliedEntryId !== 'string' || !/^bulk_return_entry:[0-9A-HJKMNP-TV-Z]{26}$/.test(appliedEntryId)) {
          throw { forbidden: 'distribution_log.applied_bulk_entry_ids must contain bulk_return_entry:{ulid} ids' };
        }
        if (seenAppliedEntryIds[appliedEntryId] === true) {
          throw { forbidden: 'Duplicate id in distribution_log.applied_bulk_entry_ids: ' + appliedEntryId };
        }
        seenAppliedEntryIds[appliedEntryId] = true;
      }
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
        '_id', 'type', 'shelter_code', 'ticket_id', 'item_id', 'qty',
        'recipient_type', 'recipient_id', 'household_id', 'is_returnable',
        'distributed_at', 'distributed_by', 'created_at', 'created_by'
      ];
      for (var lf = 0; lf < immutableLogFields.length; lf++) {
        var lfName = immutableLogFields[lf];
        if (newDoc[lfName] !== oldDoc[lfName]) {
          throw { forbidden: 'distribution_log.' + lfName + ' is immutable after issuance' };
        }
      }
      // schema_v may stay equal or go 1 -> 2 (lazy upgrade); never downgrade.
      if (newDoc.schema_v !== oldDoc.schema_v && !(oldDoc.schema_v === 1 && newDoc.schema_v === 2)) {
        throw { forbidden: 'distribution_log.schema_v can only stay the same or upgrade from 1 to 2' };
      }
      var oldAppliedIds = Array.isArray(oldDoc.applied_bulk_entry_ids) ? oldDoc.applied_bulk_entry_ids : [];
      var newAppliedIds = Array.isArray(newDoc.applied_bulk_entry_ids) ? newDoc.applied_bulk_entry_ids : [];
      var appliedIdsUnchanged = JSON.stringify(oldAppliedIds) === JSON.stringify(newAppliedIds);
      var isBulkApplyV3 = newAppliedIds.length === oldAppliedIds.length + 1;
      var isBulkRevertV3 = newAppliedIds.length === oldAppliedIds.length - 1;
      if (!appliedIdsUnchanged && !isBulkApplyV3 && !isBulkRevertV3) {
        throw { forbidden: 'distribution_log.applied_bulk_entry_ids can only gain or lose exactly one id per write' };
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
          oldDoc.bulk_pool_id ||
          oldAppliedIds.length > 0
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

      if (isBulkApplyV3 || isBulkRevertV3) {
        // #658 v3 bulk return path (apply an entry / revert a voided entry): WH, SC, SM, DST.
        // The legacy bulk path below (bulk_pool_id) stays frontline-only and never changes the ids.
        if (!canReturnLoanPhysical()) throw { forbidden: 'Only warehouse staff, supply coordinators, distribution staff, shelter managers, or system admins can apply bulk return entries to loans' };
        if (newDoc.schema_v !== 2) throw { forbidden: 'distribution_log bulk entry changes require schema_v 2' };
        if (newDoc.bulk_pool_id !== oldDoc.bulk_pool_id) {
          throw { forbidden: 'distribution_log.bulk_pool_id is immutable on the v3 bulk path' };
        }
        if (newDoc.clear_reason !== 'bulk_dropoff') {
          throw { forbidden: 'v3 bulk entry changes require clear_reason bulk_dropoff' };
        }
        if (!newDoc.returned_at || newDoc.returned_by !== userCtx.name) {
          throw { forbidden: 'distribution_log.returned_by must match the current actor' };
        }
        var bulkOldQty = oldDoc.qty_returned === undefined ? 0 : parseDecimal4(oldDoc.qty_returned);
        var bulkNewQty = parseDecimal4(newDoc.qty_returned);
        if (typeof newDoc.qty_returned !== 'string' || !/^\\d+$/.test(newDoc.qty_returned.trim()) || isNaN(bulkNewQty)) {
          throw { forbidden: 'distribution_log qty_returned must be a whole number on the v3 bulk path' };
        }
        var bulkIssuedQty = parseDecimal4(newDoc.qty);
        if (isBulkApplyV3) {
          if (oldStatus !== 'active' && oldStatus !== 'partially_returned') {
            throw { forbidden: 'Illegal distribution_log transition: ' + oldStatus + ' -> ' + nextStatus };
          }
          for (var oa = 0; oa < oldAppliedIds.length; oa++) {
            if (newAppliedIds.indexOf(oldAppliedIds[oa]) === -1) {
              throw { forbidden: 'applied_bulk_entry_ids must keep every previously applied id' };
            }
          }
          if (bulkNewQty <= bulkOldQty) {
            throw { forbidden: 'distribution_log qty_returned must increase when applying a bulk entry' };
          }
          if (bulkNewQty > bulkIssuedQty) {
            throw { forbidden: 'distribution_log qty_returned must not exceed issued qty' };
          }
          if (nextStatus !== (bulkNewQty === bulkIssuedQty ? 'returned' : 'partially_returned')) {
            throw { forbidden: 'distribution_log status must be returned when fully returned, otherwise partially_returned' };
          }
        } else {
          if (oldStatus !== 'partially_returned' && oldStatus !== 'returned') {
            throw { forbidden: 'Illegal distribution_log transition: ' + oldStatus + ' -> ' + nextStatus };
          }
          for (var na = 0; na < newAppliedIds.length; na++) {
            if (oldAppliedIds.indexOf(newAppliedIds[na]) === -1) {
              throw { forbidden: 'applied_bulk_entry_ids can only lose ids when reverting' };
            }
          }
          if (bulkNewQty >= bulkOldQty || bulkNewQty < 0) {
            throw { forbidden: 'distribution_log qty_returned must decrease when reverting a bulk entry' };
          }
          if (nextStatus !== (bulkNewQty === 0 ? 'active' : 'partially_returned')) {
            throw { forbidden: 'distribution_log status must be active when nothing is returned, otherwise partially_returned' };
          }
        }
      } else if (isVoidTransition) {
        if (!canPerformFrontlineDistribution()) throw { forbidden: 'Only frontline distribution staff can void distribution logs' };
        if (newDoc.voided_by !== userCtx.name) throw { forbidden: 'distribution_log.voided_by must match the current actor' };
      } else if (isRoutineReturn) {
        if (!canReturnLoanPhysical()) throw { forbidden: 'Only warehouse staff, supply coordinators, distribution staff, shelter managers, or system admins can record routine physical returns' };
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
          // Either a legacy bulk_pool_id, or (schema_v 2) the applied_bulk_entry_ids array.
          var hasLegacyBulkPool = typeof newDoc.bulk_pool_id === 'string' && /^bulk_return_pool:[0-9A-HJKMNP-TV-Z]{26}$/.test(newDoc.bulk_pool_id);
          var hasAppliedBulkEntries = newDoc.schema_v === 2 && Array.isArray(newDoc.applied_bulk_entry_ids);
          if (!hasLegacyBulkPool && !hasAppliedBulkEntries) {
            throw { forbidden: 'bulk_dropoff requires bulk_pool_id or applied_bulk_entry_ids' };
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
      if (Array.isArray(newDoc.applied_bulk_entry_ids) && newDoc.applied_bulk_entry_ids.length > 0) {
        throw { forbidden: 'New distribution_log cannot carry applied_bulk_entry_ids' };
      }
      if (!newDoc.is_returnable && newDoc.status !== 'fulfilled') {
        throw { forbidden: 'Non-returnable logs must start as fulfilled' };
      }
      if (newDoc.is_returnable && newDoc.status !== 'active') {
        throw { forbidden: 'Returnable logs must start as active' };
      }
    }
  }
  // 14. #658 (amends CR-134; CR-121 is not affected): bulk_return_pool validation (Rule 14).
  // Legacy schema_v 1/2 pools are FROZEN: no further updates are accepted (no migration).
  // New pools are schema_v 3: a small mutable header (OPEN -> SUBMITTED -> RECEIVED, or
  // OPEN -> CANCELLED) whose contents live in append-only bulk_return_entry / _move / _void docs
  // (Rules 14b / 14c / 14d). Every pool write is WH, SC, SM (+ SA); deletes stay banned (see above).
  // Advisory: VDU cannot count entry docs, so "cancel only when empty" is enforced by the domain
  // fold (isPoolEmpty) + the CANCEL lock in the cancel workflow, not here.
  if (newDoc.type === 'bulk_return_pool') {
    if (oldDoc && oldDoc.schema_v !== 3) {
      throw { forbidden: 'bulk_return_pool schema_v ' + oldDoc.schema_v + ' documents are frozen and cannot be updated' };
    }
    if (newDoc.schema_v !== 3) {
      throw { forbidden: 'New bulk_return_pool documents must be schema_v 3' };
    }
    if (!/^bulk_return_pool:[0-9A-HJKMNP-TV-Z]{26}$/.test(newDoc._id)) {
      throw { forbidden: 'bulk_return_pool id must be bulk_return_pool:{ulid}' };
    }
    var isNonEmptyString = function (value) {
      return typeof value === 'string' && value.trim().length > 0;
    };
    var isPoolDateString = function (value) {
      return isNonEmptyString(value) && !isNaN(Date.parse(value));
    };
    var isPoolStoragePair = function (pointId, zone, label) {
      var hasPoint = typeof pointId !== 'undefined';
      var hasZone = typeof zone !== 'undefined';
      if (hasPoint !== hasZone) {
        throw { forbidden: 'bulk_return_pool ' + label + ' storage point id and zone must be set together' };
      }
      if (hasPoint) {
        if (!isNonEmptyString(pointId)) {
          throw { forbidden: 'bulk_return_pool ' + label + ' storage point id must be a non-empty string' };
        }
        if (!isNonEmptyString(zone) || zone.trim().length > 100) {
          throw { forbidden: 'bulk_return_pool ' + label + ' storage zone must be a non-empty string of at most 100 characters' };
        }
      }
    };
    if (!canManageBulkReturnPool()) {
      throw { forbidden: 'Only warehouse staff, supply coordinators, shelter managers, or system admins can write bulk return pools' };
    }
    if (typeof newDoc.name !== 'string' || newDoc.name.trim().length < 1 || newDoc.name.trim().length > 80) {
      throw { forbidden: 'bulk_return_pool name must be 1 to 80 characters' };
    }
    isPoolStoragePair(newDoc.location_storage_point_id, newDoc.location_storage_zone, 'location');
    if (typeof newDoc.notes !== 'undefined' && !isNonEmptyString(newDoc.notes)) {
      throw { forbidden: 'bulk_return_pool notes must be a non-empty string' };
    }
    if (['OPEN', 'SUBMITTED', 'RECEIVED', 'CANCELLED'].indexOf(newDoc.status) === -1) {
      throw { forbidden: 'Invalid bulk_return_pool status: ' + newDoc.status };
    }
    var poolSameJson = function (a, b) {
      return JSON.stringify(a) === JSON.stringify(b);
    };
    if (typeof newDoc.lock !== 'undefined' && newDoc.lock !== null) {
      var poolLock = newDoc.lock;
      if (newDoc.status !== 'OPEN') {
        throw { forbidden: 'bulk_return_pool lock is only allowed while OPEN' };
      }
      if (typeof poolLock !== 'object' || ['SUBMIT', 'CANCEL'].indexOf(poolLock.op) === -1) {
        throw { forbidden: 'bulk_return_pool lock.op must be SUBMIT or CANCEL' };
      }
      if (typeof poolLock.op_id !== 'string' || !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(poolLock.op_id)) {
        throw { forbidden: 'bulk_return_pool lock.op_id must be a ULID' };
      }
      if (!isNonEmptyString(poolLock.locked_at) || !isNonEmptyString(poolLock.locked_by)) {
        throw { forbidden: 'bulk_return_pool lock requires locked_at and locked_by' };
      }
      // locked_by is checked only when the lock is newly written or changed.
      if (!oldDoc || !poolSameJson(poolLock, oldDoc.lock)) {
        if (poolLock.locked_by !== userCtx.name) {
          throw { forbidden: 'bulk_return_pool lock.locked_by must match the current actor' };
        }
      }
    }
    var poolReceiveFields = ['received_at', 'received_by', 'received_storage_point_id', 'received_storage_zone', 'received_items'];
    var poolCancelFields = ['cancelled_at', 'cancelled_by'];
    var poolSubmitFields = ['items_summary', 'entry_ids', 'submitted_at', 'submitted_by'];
    var poolFieldsAbsent = function (fields, label) {
      for (var fi = 0; fi < fields.length; fi++) {
        if (typeof newDoc[fields[fi]] !== 'undefined') {
          throw { forbidden: label + ' bulk_return_pool must not have ' + fields[fi] };
        }
      }
    };
    if (newDoc.status === 'OPEN') {
      poolFieldsAbsent(poolSubmitFields, 'OPEN');
      poolFieldsAbsent(poolCancelFields, 'OPEN');
      poolFieldsAbsent(poolReceiveFields, 'OPEN');
    } else if (newDoc.status === 'CANCELLED') {
      poolFieldsAbsent(poolSubmitFields, 'CANCELLED');
      poolFieldsAbsent(poolReceiveFields, 'CANCELLED');
      if (!isPoolDateString(newDoc.cancelled_at) || !isNonEmptyString(newDoc.cancelled_by)) {
        throw { forbidden: 'CANCELLED bulk_return_pool requires cancelled_at and cancelled_by' };
      }
    } else {
      poolFieldsAbsent(poolCancelFields, newDoc.status);
      // Submit snapshot: items_summary + entry_ids are non-empty (an empty pool cannot be submitted).
      if (!Array.isArray(newDoc.items_summary) || newDoc.items_summary.length === 0) {
        throw { forbidden: newDoc.status + ' bulk_return_pool requires a non-empty items_summary array' };
      }
      if (!Array.isArray(newDoc.entry_ids) || newDoc.entry_ids.length === 0) {
        throw { forbidden: newDoc.status + ' bulk_return_pool requires a non-empty entry_ids array' };
      }
      var seenPoolEntryIds = {};
      for (var ei = 0; ei < newDoc.entry_ids.length; ei++) {
        var poolEntryId = newDoc.entry_ids[ei];
        if (typeof poolEntryId !== 'string' || !/^bulk_return_entry:[0-9A-HJKMNP-TV-Z]{26}$/.test(poolEntryId)) {
          throw { forbidden: 'bulk_return_pool entry_ids must contain bulk_return_entry:{ulid} ids' };
        }
        if (seenPoolEntryIds[poolEntryId] === true) {
          throw { forbidden: 'Duplicate id in bulk_return_pool entry_ids: ' + poolEntryId };
        }
        seenPoolEntryIds[poolEntryId] = true;
      }
      var seenSummaryItems = {};
      var summaryQtyByItem = {};
      for (var si = 0; si < newDoc.items_summary.length; si++) {
        var summaryRow = newDoc.items_summary[si];
        if (!summaryRow || typeof summaryRow !== 'object' || !isNonEmptyString(summaryRow.item_id)) {
          throw { forbidden: 'bulk_return_pool items_summary row requires item_id' };
        }
        if (typeof summaryRow.qty !== 'string' || !/^0*[1-9]\\d*$/.test(summaryRow.qty.trim())) {
          throw { forbidden: 'bulk_return_pool items_summary qty must be a positive whole number string' };
        }
        if (seenSummaryItems[summaryRow.item_id] === true) {
          throw { forbidden: 'Duplicate item_id in bulk_return_pool items_summary: ' + summaryRow.item_id };
        }
        seenSummaryItems[summaryRow.item_id] = true;
        summaryQtyByItem[summaryRow.item_id] = summaryRow.qty.trim();
      }
      if (!isPoolDateString(newDoc.submitted_at) || !isNonEmptyString(newDoc.submitted_by)) {
        throw { forbidden: newDoc.status + ' bulk_return_pool requires submitted_at and submitted_by' };
      }
      if (newDoc.status === 'SUBMITTED') {
        poolFieldsAbsent(poolReceiveFields, 'SUBMITTED');
      } else {
        // RECEIVED: receipt audit + optional storage point + one inspection row per summary item.
        if (!isPoolDateString(newDoc.received_at) || !isNonEmptyString(newDoc.received_by)) {
          throw { forbidden: 'RECEIVED bulk_return_pool requires received_at and received_by' };
        }
        isPoolStoragePair(newDoc.received_storage_point_id, newDoc.received_storage_zone, 'received');
        if (!Array.isArray(newDoc.received_items) || newDoc.received_items.length !== newDoc.items_summary.length) {
          throw { forbidden: 'bulk_return_pool received_items must have exactly one row per items_summary item' };
        }
        var seenReceivedItems = {};
        var poolDiscrepancyReasons = ['damaged', 'missing', 'miscount', 'other'];
        for (var ri = 0; ri < newDoc.received_items.length; ri++) {
          var receivedRow = newDoc.received_items[ri];
          if (!receivedRow || typeof receivedRow !== 'object' || !isNonEmptyString(receivedRow.item_id) ||
              typeof summaryQtyByItem[receivedRow.item_id] === 'undefined') {
            throw { forbidden: 'bulk_return_pool received_items row must reference an items_summary item_id' };
          }
          if (seenReceivedItems[receivedRow.item_id] === true) {
            throw { forbidden: 'Duplicate item_id in bulk_return_pool received_items: ' + receivedRow.item_id };
          }
          seenReceivedItems[receivedRow.item_id] = true;
          if (typeof receivedRow.expected_qty !== 'string' || !/^\\d+$/.test(receivedRow.expected_qty.trim()) ||
              parseDecimal4(receivedRow.expected_qty) !== parseDecimal4(summaryQtyByItem[receivedRow.item_id])) {
            throw { forbidden: 'bulk_return_pool received_items expected_qty must equal the items_summary qty' };
          }
          if (typeof receivedRow.received_qty !== 'string' || !/^\\d+$/.test(receivedRow.received_qty.trim())) {
            throw { forbidden: 'bulk_return_pool received_items received_qty must be a non-negative whole number string' };
          }
          var rowExpected = parseDecimal4(receivedRow.expected_qty);
          var rowReceived = parseDecimal4(receivedRow.received_qty);
          if (rowReceived > rowExpected) {
            throw { forbidden: 'bulk_return_pool received_items received_qty must not exceed expected_qty' };
          }
          var hasRowReason = typeof receivedRow.discrepancy_reason !== 'undefined';
          var hasRowNote = typeof receivedRow.discrepancy_note !== 'undefined';
          if (hasRowReason && poolDiscrepancyReasons.indexOf(receivedRow.discrepancy_reason) === -1) {
            throw { forbidden: 'bulk_return_pool received_items discrepancy_reason is invalid' };
          }
          if (hasRowNote && !isNonEmptyString(receivedRow.discrepancy_note)) {
            throw { forbidden: 'bulk_return_pool received_items discrepancy_note must be a non-empty string' };
          }
          if (rowReceived === rowExpected) {
            if (hasRowReason || hasRowNote) {
              throw { forbidden: 'bulk_return_pool received_items must not carry a discrepancy when received_qty equals expected_qty' };
            }
          } else {
            if (!hasRowReason) {
              throw { forbidden: 'bulk_return_pool received_items requires discrepancy_reason when received_qty is below expected_qty' };
            }
            if (receivedRow.discrepancy_reason === 'other' && !hasRowNote) {
              throw { forbidden: 'bulk_return_pool received_items requires discrepancy_note when the reason is other' };
            }
          }
        }
      }
    }
    if (oldDoc) {
      var immutablePoolFields = ['_id', 'type', 'schema_v', 'shelter_code', 'created_at', 'created_by'];
      for (var pf = 0; pf < immutablePoolFields.length; pf++) {
        var pfName = immutablePoolFields[pf];
        if (newDoc[pfName] !== oldDoc[pfName]) {
          throw { forbidden: 'bulk_return_pool.' + pfName + ' is immutable' };
        }
      }
      // Forward-only: OPEN -> SUBMITTED, SUBMITTED -> RECEIVED, OPEN -> CANCELLED. Everything else
      // (SUBMITTED -> OPEN, SUBMITTED -> CANCELLED, RECEIVED -> *, CANCELLED -> *) is rejected.
      if (oldDoc.status !== newDoc.status) {
        var poolStepOk =
          (oldDoc.status === 'OPEN' && newDoc.status === 'SUBMITTED') ||
          (oldDoc.status === 'SUBMITTED' && newDoc.status === 'RECEIVED') ||
          (oldDoc.status === 'OPEN' && newDoc.status === 'CANCELLED');
        if (!poolStepOk) {
          throw { forbidden: 'Invalid bulk_return_pool status transition ' + oldDoc.status + ' -> ' + newDoc.status };
        }
        if (newDoc.status === 'SUBMITTED' && newDoc.submitted_by !== userCtx.name) {
          throw { forbidden: 'bulk_return_pool.submitted_by must match the current actor' };
        }
        if (newDoc.status === 'RECEIVED' && newDoc.received_by !== userCtx.name) {
          throw { forbidden: 'bulk_return_pool.received_by must match the current actor' };
        }
        if (newDoc.status === 'CANCELLED' && newDoc.cancelled_by !== userCtx.name) {
          throw { forbidden: 'bulk_return_pool.cancelled_by must match the current actor' };
        }
      }
      // name / location are editable only while OPEN and stay as they were on any transition.
      // notes stay editable in every status.
      if (oldDoc.status !== 'OPEN' || oldDoc.status !== newDoc.status) {
        if (newDoc.name !== oldDoc.name ||
            newDoc.location_storage_point_id !== oldDoc.location_storage_point_id ||
            newDoc.location_storage_zone !== oldDoc.location_storage_zone) {
          throw { forbidden: 'bulk_return_pool name and location are immutable once the pool has left OPEN' };
        }
      }
      // Everything written at or after the freeze is immutable (a transition writes only its own step).
      if (oldDoc.status !== 'OPEN') {
        var frozenPoolFields = poolSubmitFields.concat(poolCancelFields);
        if (oldDoc.status === 'RECEIVED') frozenPoolFields = frozenPoolFields.concat(poolReceiveFields);
        for (var zf = 0; zf < frozenPoolFields.length; zf++) {
          if (!poolSameJson(newDoc[frozenPoolFields[zf]], oldDoc[frozenPoolFields[zf]])) {
            throw { forbidden: 'bulk_return_pool.' + frozenPoolFields[zf] + ' is immutable once written' };
          }
        }
      }
    } else if (newDoc.status !== 'OPEN') {
      throw { forbidden: 'Initial bulk_return_pool status must be OPEN' };
    } else if (newDoc.created_by !== userCtx.name) {
      throw { forbidden: 'bulk_return_pool.created_by must match the current actor' };
    }
  }
  // 14b. #658: bulk_return_entry (append-only; the guard above already rejects any update/delete).
  if (newDoc.type === 'bulk_return_entry') {
    if (newDoc.schema_v !== 1) {
      throw { forbidden: 'Unsupported bulk_return_entry schema version' };
    }
    if (!/^bulk_return_entry:[0-9A-HJKMNP-TV-Z]{26}$/.test(newDoc._id)) {
      throw { forbidden: 'bulk_return_entry id must be bulk_return_entry:{ulid}' };
    }
    if (typeof newDoc.pool_id !== 'string' || !/^bulk_return_pool:[0-9A-HJKMNP-TV-Z]{26}$/.test(newDoc.pool_id)) {
      throw { forbidden: 'bulk_return_entry requires pool_id' };
    }
    if (typeof newDoc.item_id !== 'string' || !newDoc.item_id) {
      throw { forbidden: 'bulk_return_entry requires item_id' };
    }
    if (typeof newDoc.qty !== 'string' || !/^0*[1-9]\\d*$/.test(newDoc.qty.trim())) {
      throw { forbidden: 'bulk_return_entry qty must be a positive whole number string' };
    }
    if (!canWriteBulkReturnEntry()) {
      throw { forbidden: 'Only warehouse staff, supply coordinators, distribution staff, shelter managers, or system admins can record bulk return entries' };
    }
    if (newDoc.created_by !== userCtx.name) {
      throw { forbidden: 'bulk_return_entry.created_by must match the current actor' };
    }
    // returner_type: unspecified carries an explicit returner_id null and no loan_refs.
    if (['evacuee', 'volunteer', 'unspecified'].indexOf(newDoc.returner_type) === -1) {
      throw { forbidden: 'bulk_return_entry returner_type must be evacuee, volunteer or unspecified' };
    }
    if (newDoc.returner_type === 'unspecified') {
      if (newDoc.returner_id !== null) {
        throw { forbidden: 'unspecified bulk_return_entry requires returner_id null' };
      }
      if (Array.isArray(newDoc.loan_refs) && newDoc.loan_refs.length > 0) {
        throw { forbidden: 'unspecified bulk_return_entry must not have loan_refs' };
      }
    } else if (typeof newDoc.returner_id !== 'string' ||
        newDoc.returner_id.indexOf(newDoc.returner_type + ':') !== 0) {
      throw { forbidden: 'bulk_return_entry returner_id must start with ' + newDoc.returner_type + ':' };
    }
    if (typeof newDoc.notes !== 'undefined' && (typeof newDoc.notes !== 'string' || !newDoc.notes.trim())) {
      throw { forbidden: 'bulk_return_entry notes must be a non-empty string' };
    }
    if (!Array.isArray(newDoc.loan_refs)) {
      throw { forbidden: 'bulk_return_entry requires loan_refs array' };
    }
    var seenLoanRefs = {};
    var loanRefTotal = 0;
    for (var lr = 0; lr < newDoc.loan_refs.length; lr++) {
      var loanRef = newDoc.loan_refs[lr];
      if (!loanRef || typeof loanRef !== 'object' ||
          typeof loanRef.distribution_log_id !== 'string' ||
          !/^distribution_log:[0-9A-HJKMNP-TV-Z]{26}$/.test(loanRef.distribution_log_id)) {
        throw { forbidden: 'bulk_return_entry loan_refs require distribution_log_id' };
      }
      if (typeof loanRef.qty !== 'string' || !/^0*[1-9]\\d*$/.test(loanRef.qty.trim())) {
        throw { forbidden: 'bulk_return_entry loan_refs qty must be a positive whole number string' };
      }
      if (seenLoanRefs[loanRef.distribution_log_id] === true) {
        throw { forbidden: 'Duplicate distribution_log_id in bulk_return_entry loan_refs: ' + loanRef.distribution_log_id };
      }
      seenLoanRefs[loanRef.distribution_log_id] = true;
      loanRefTotal += parseDecimal4(loanRef.qty);
    }
    // sum(loan_refs.qty) <= qty: the surplus may be unattributed (a returner with no outstanding
    // loan has empty loan_refs; the UI warning lives in the application layer).
    if (loanRefTotal > parseDecimal4(newDoc.qty)) {
      throw { forbidden: 'bulk_return_entry loan_refs qty must not exceed entry qty' };
    }
  }
  // 14c. #658: bulk_return_entry_move (append-only whole-entry move). VDU cannot see other docs, so
  // from_pool_id == current pool and "pools are OPEN" are checked by the domain fold, not here.
  if (newDoc.type === 'bulk_return_entry_move') {
    if (newDoc.schema_v !== 1) {
      throw { forbidden: 'Unsupported bulk_return_entry_move schema version' };
    }
    if (!canWriteBulkReturnEntry()) {
      throw { forbidden: 'Only warehouse staff, supply coordinators, distribution staff, shelter managers, or system admins can move bulk return entries' };
    }
    if (newDoc.created_by !== userCtx.name) {
      throw { forbidden: 'bulk_return_entry_move.created_by must match the current actor' };
    }
    var moveIdMatch = /^bulk_return_entry_move:([0-9A-HJKMNP-TV-Z]{26}):(\\d{4})$/.exec(newDoc._id);
    if (!moveIdMatch) {
      throw { forbidden: 'bulk_return_entry_move id must be bulk_return_entry_move:{entryUlid}:{seq}' };
    }
    if (newDoc.entry_id !== 'bulk_return_entry:' + moveIdMatch[1]) {
      throw { forbidden: 'bulk_return_entry_move entry_id must match the entry ULID in _id' };
    }
    if (typeof newDoc.seq !== 'number' || Math.floor(newDoc.seq) !== newDoc.seq || newDoc.seq < 1 ||
        newDoc.seq !== parseInt(moveIdMatch[2], 10)) {
      throw { forbidden: 'bulk_return_entry_move seq must be an integer >= 1 matching _id' };
    }
    if (typeof newDoc.from_pool_id !== 'string' || !/^bulk_return_pool:[0-9A-HJKMNP-TV-Z]{26}$/.test(newDoc.from_pool_id) ||
        typeof newDoc.to_pool_id !== 'string' || !/^bulk_return_pool:[0-9A-HJKMNP-TV-Z]{26}$/.test(newDoc.to_pool_id)) {
      throw { forbidden: 'bulk_return_entry_move requires from_pool_id and to_pool_id' };
    }
    if (newDoc.from_pool_id === newDoc.to_pool_id) {
      throw { forbidden: 'bulk_return_entry_move from_pool_id and to_pool_id must differ' };
    }
    if (typeof newDoc.item_id !== 'string' || !newDoc.item_id) {
      throw { forbidden: 'bulk_return_entry_move requires item_id' };
    }
    if (typeof newDoc.qty !== 'string' || !/^0*[1-9]\\d*$/.test(newDoc.qty.trim())) {
      throw { forbidden: 'bulk_return_entry_move qty must be a positive whole number string' };
    }
    if (typeof newDoc.notes !== 'undefined' && (typeof newDoc.notes !== 'string' || !newDoc.notes.trim())) {
      throw { forbidden: 'bulk_return_entry_move notes must be a non-empty string' };
    }
  }
  // 14d. #658: bulk_return_entry_void (append-only; deterministic id so an entry is voided at most
  // once — a second void is a CouchDB 409 conflict, not a VDU rejection). Voider / time are the
  // envelope created_by / created_at. Advisory (VDU cannot read other docs): the pool is still OPEN
  // and unlocked, and pool_id is the entry's current pool — enforced by the domain canVoidEntry +
  // fold consistency checks.
  if (newDoc.type === 'bulk_return_entry_void') {
    if (newDoc.schema_v !== 1) {
      throw { forbidden: 'Unsupported bulk_return_entry_void schema version' };
    }
    if (!canWriteBulkReturnEntry()) {
      throw { forbidden: 'Only warehouse staff, supply coordinators, distribution staff, shelter managers, or system admins can void bulk return entries' };
    }
    if (newDoc.created_by !== userCtx.name) {
      throw { forbidden: 'bulk_return_entry_void.created_by must match the current actor' };
    }
    var voidIdMatch = /^bulk_return_entry_void:([0-9A-HJKMNP-TV-Z]{26})$/.exec(newDoc._id);
    if (!voidIdMatch) {
      throw { forbidden: 'bulk_return_entry_void id must be bulk_return_entry_void:{entryUlid}' };
    }
    if (newDoc.entry_id !== 'bulk_return_entry:' + voidIdMatch[1]) {
      throw { forbidden: 'bulk_return_entry_void entry_id must match the entry ULID in _id' };
    }
    if (typeof newDoc.pool_id !== 'string' || !/^bulk_return_pool:[0-9A-HJKMNP-TV-Z]{26}$/.test(newDoc.pool_id)) {
      throw { forbidden: 'bulk_return_entry_void requires pool_id' };
    }
    if (typeof newDoc.item_id !== 'string' || !newDoc.item_id) {
      throw { forbidden: 'bulk_return_entry_void requires item_id' };
    }
    if (typeof newDoc.qty !== 'string' || !/^0*[1-9]\\d*$/.test(newDoc.qty.trim())) {
      throw { forbidden: 'bulk_return_entry_void qty must be a positive whole number string' };
    }
    if (typeof newDoc.notes !== 'undefined' && (typeof newDoc.notes !== 'string' || !newDoc.notes.trim())) {
      throw { forbidden: 'bulk_return_entry_void notes must be a non-empty string' };
    }
  }
  // 14e. CR-193 §35: bulk_return_loan_reopen (append-only; deterministic id so an entry's loans are
  // reopened at most once — a second reopen is a CouchDB 409 conflict, not a VDU rejection). A shelter
  // manager or warehouse staff reopens the loans of ONE bulk_return_entry whose pool is closed. Advisory (VDU cannot
  // read other docs): the pool is closed, entry_id belongs to pool_id, and loan_ids are exactly the
  // loans that hold the entry in applied_bulk_entry_ids — enforced by the domain checks. The loan
  // revert itself is authorised by the existing distribution_log rule (canReturnLoanPhysical); the
  // narrower shelter_manager / warehouse_staff role applies to this doc only.
  if (newDoc.type === 'bulk_return_loan_reopen') {
    if (newDoc.schema_v !== 1) {
      throw { forbidden: 'Unsupported bulk_return_loan_reopen schema version' };
    }
    if (!isRole('shelter_manager') && !isRole('warehouse_staff')) {
      throw { forbidden: 'Only shelter managers, warehouse staff or system admins can reopen bulk return loans' };
    }
    if (newDoc.created_by !== userCtx.name) {
      throw { forbidden: 'bulk_return_loan_reopen.created_by must match the current actor' };
    }
    var reopenIdMatch = /^bulk_return_loan_reopen:([0-9A-HJKMNP-TV-Z]{26})$/.exec(newDoc._id);
    if (!reopenIdMatch) {
      throw { forbidden: 'bulk_return_loan_reopen id must be bulk_return_loan_reopen:{entryUlid}' };
    }
    if (newDoc.entry_id !== 'bulk_return_entry:' + reopenIdMatch[1]) {
      throw { forbidden: 'bulk_return_loan_reopen entry_id must match the entry ULID in _id' };
    }
    if (typeof newDoc.pool_id !== 'string' || !/^bulk_return_pool:[0-9A-HJKMNP-TV-Z]{26}$/.test(newDoc.pool_id)) {
      throw { forbidden: 'bulk_return_loan_reopen requires pool_id' };
    }
    if (typeof newDoc.reason !== 'string' || newDoc.reason.trim().length < 1 || newDoc.reason.trim().length > 500) {
      throw { forbidden: 'bulk_return_loan_reopen reason must be 1-500 characters' };
    }
    if (!Array.isArray(newDoc.loan_ids) || newDoc.loan_ids.length === 0) {
      throw { forbidden: 'bulk_return_loan_reopen loan_ids must be a non-empty array' };
    }
    for (var rl = 0; rl < newDoc.loan_ids.length; rl++) {
      var reopenLoanId = newDoc.loan_ids[rl];
      if (typeof reopenLoanId !== 'string' || !/^distribution_log:[0-9A-HJKMNP-TV-Z]{26}$/.test(reopenLoanId)) {
        throw { forbidden: 'bulk_return_loan_reopen.loan_ids must contain distribution_log:{ulid} ids' };
      }
      if (newDoc.loan_ids.indexOf(reopenLoanId) !== rl) {
        throw { forbidden: 'Duplicate id in bulk_return_loan_reopen.loan_ids: ' + reopenLoanId };
      }
    }
  }
  // 15. CR-134: bulk_return_claim validation (Rule 15)
  if (newDoc.type === 'bulk_return_claim') {
    var canManageClaim =
      isRole('registration_staff') ||
      isRole('distribution_staff') ||
      isRole('supply_coordinator') ||
      isRole('shelter_manager') ||
      isRole('system_admin');
    if (!canManageClaim) {
      throw { forbidden: 'Only registration staff, distribution staff, supply coordinator, shelter manager, or system admin can manage bulk return claims' };
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
      if (newDoc.created_by !== userCtx.name) {
        throw { forbidden: 'bulk_return_claim.created_by must match the current actor' };
      }
    }
  }
  // 16. CR-134 R4: loan_return_reservation validation (Rule 16)
  if (newDoc.type === 'loan_return_reservation') {
    if (newDoc.schema_v !== 1) {
      throw { forbidden: 'Unsupported loan_return_reservation schema version' };
    }
    if (!/^loan_return_reservation:[0-9A-HJKMNP-TV-Z]{26}$/.test(newDoc._id)) {
      throw { forbidden: 'loan_return_reservation id must be loan_return_reservation:{ulid}' };
    }
    if (typeof newDoc.operation_id !== 'string' || !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(newDoc.operation_id)) {
      throw { forbidden: 'loan_return_reservation requires operation_id ULID' };
    }
    if (typeof newDoc.distribution_log_id !== 'string' || !/^distribution_log:[0-9A-HJKMNP-TV-Z]{26}$/.test(newDoc.distribution_log_id)) {
      throw { forbidden: 'loan_return_reservation requires distribution_log_id' };
    }
    if (newDoc._id !== 'loan_return_reservation:' + newDoc.distribution_log_id.replace('distribution_log:', '')) {
      throw { forbidden: 'loan_return_reservation id must derive from distribution_log_id' };
    }
    if (newDoc.mode !== 'PHYSICAL' && newDoc.mode !== 'BULK' && newDoc.mode !== 'NON_PHYSICAL') {
      throw { forbidden: 'Invalid loan_return_reservation mode: ' + newDoc.mode };
    }
    var validResStatuses = ['RESERVED', 'FENCED', 'COMMITTED', 'ABORTED'];
    if (validResStatuses.indexOf(newDoc.status) === -1) {
      throw { forbidden: 'Invalid loan_return_reservation status: ' + newDoc.status };
    }
    if (typeof newDoc.operation_by !== 'string' || !newDoc.operation_by) {
      throw { forbidden: 'loan_return_reservation requires operation_by' };
    }

    // Mode-specific RBAC enforced on EVERY write/transition
    var canReservePhysical = canReturnLoanPhysical();
    var canReserveBulk = canPerformFrontlineDistribution();
    var canReserveNonPhysical = canPerformFrontlineDistribution();

    if (newDoc.mode === 'PHYSICAL' && !canReservePhysical) {
      throw { forbidden: 'Role cannot manage loan return reservations in PHYSICAL mode' };
    }
    if (newDoc.mode === 'BULK' && !canReserveBulk) {
      throw { forbidden: 'Role cannot manage loan return reservations in BULK mode' };
    }
    if (newDoc.mode === 'NON_PHYSICAL' && !canReserveNonPhysical) {
      throw { forbidden: 'Role cannot manage loan return reservations in NON_PHYSICAL mode' };
    }

    // Mode-specific durable intent validation
    if (newDoc.mode === 'PHYSICAL') {
      if (typeof newDoc.qty_returned !== 'string' || !/^\\d+(\\.\\d+)?$/.test(newDoc.qty_returned)) {
        throw { forbidden: 'PHYSICAL loan_return_reservation requires valid qty_returned' };
      }
      if (newDoc.return_condition !== 'READY' && newDoc.return_condition !== 'MAINTENANCE' && newDoc.return_condition !== 'BROKEN') {
        throw { forbidden: 'PHYSICAL loan_return_reservation requires valid return_condition' };
      }
    } else if (newDoc.mode === 'BULK') {
      if (typeof newDoc.bulk_pool_id !== 'string' || !/^bulk_return_pool:[0-9A-HJKMNP-TV-Z]{26}$/.test(newDoc.bulk_pool_id)) {
        throw { forbidden: 'BULK loan_return_reservation requires valid bulk_pool_id' };
      }
      if (typeof newDoc.claimed_qty !== 'string' || !/^\\d+(\\.\\d+)?$/.test(newDoc.claimed_qty)) {
        throw { forbidden: 'BULK loan_return_reservation requires valid claimed_qty' };
      }
    } else if (newDoc.mode === 'NON_PHYSICAL') {
      if (newDoc.clear_reason !== 'lost' && newDoc.clear_reason !== 'waived') {
        throw { forbidden: 'NON_PHYSICAL loan_return_reservation requires valid clear_reason' };
      }
    }

    if (oldDoc) {
      var permImmutableRes = [
        '_id', 'type', 'schema_v', 'shelter_code', 'distribution_log_id', 'created_at', 'created_by'
      ];
      for (var ri = 0; ri < permImmutableRes.length; ri++) {
        var riName = permImmutableRes[ri];
        if (newDoc[riName] !== oldDoc[riName]) {
          throw { forbidden: 'loan_return_reservation.' + riName + ' is permanently immutable' };
        }
      }

      var oldResStatus = oldDoc.status;
      var newResStatus = newDoc.status;

      var validResTransitions = {
        RESERVED: ['FENCED', 'ABORTED'],
        FENCED: ['COMMITTED'],
        COMMITTED: ['RESERVED'],
        ABORTED: ['RESERVED']
      };

      if (oldResStatus !== newResStatus) {
        var allowedNextRes = validResTransitions[oldResStatus] || [];
        if (allowedNextRes.indexOf(newResStatus) === -1) {
          throw { forbidden: 'Invalid loan_return_reservation transition from ' + oldResStatus + ' to ' + newResStatus };
        }
      }

      if (oldResStatus === 'RESERVED' && newResStatus === 'ABORTED') {
        var isAbortOwner = oldDoc.operation_by === userCtx.name || oldDoc.created_by === userCtx.name;
        var isAbortAdmin = isRole('shelter_manager') || isRole('system_admin');
        if (!isAbortOwner && !isAbortAdmin) {
          throw { forbidden: 'Only operation owner, shelter_manager, or system_admin can abort a RESERVED reservation' };
        }
      }

      var isResReinitialization =
        (oldResStatus === 'ABORTED' || oldResStatus === 'COMMITTED') &&
        newResStatus === 'RESERVED';

      if (isResReinitialization) {
        if (newDoc.operation_by !== userCtx.name) {
          throw { forbidden: 'loan_return_reservation.operation_by must match the current actor on reinitialization' };
        }
      } else {
        var attemptScopedFields = [
          'operation_id', 'mode', 'operation_by',
          'qty_returned', 'return_condition', 'bulk_pool_id', 'claimed_qty', 'clear_reason'
        ];
        for (var af = 0; af < attemptScopedFields.length; af++) {
          var afName = attemptScopedFields[af];
          if (newDoc[afName] !== oldDoc[afName]) {
            throw { forbidden: 'loan_return_reservation.' + afName + ' cannot be changed while active' };
          }
        }
      }
    } else {
      if (newDoc.status !== 'RESERVED') {
        throw { forbidden: 'Initial loan_return_reservation status must be RESERVED' };
      }
      if (newDoc.created_by !== userCtx.name) {
        throw { forbidden: 'loan_return_reservation.created_by must match the current actor' };
      }
      if (newDoc.operation_by !== userCtx.name) {
        throw { forbidden: 'loan_return_reservation.operation_by must match the current actor' };
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
    // CR-143 §F (FR-F2/F4): 'merged_into' retires a shelter-local item into another one. Only the
    // shelter's warehouse staff / managers (or SA) may set it, always together with deactivated.
    if (newDoc.merged_into && !(oldDoc && oldDoc.merged_into === newDoc.merged_into)) {
      if (!isRole('warehouse_staff') && !isRole('shelter_manager')) {
        throw { forbidden: 'Only warehouse staff, shelter manager, or system admin can merge items' };
      }
      if (typeof newDoc.merged_into !== 'string' || !/^item_master:.+/.test(newDoc.merged_into) || newDoc.merged_into === newDoc._id) {
        throw { forbidden: 'merged_into must be another item_master id' };
      }
    }
    // A merge is permanent (its stock moved by append-only ledger rows): the pointer may not be
    // cleared or redirected, and the item may not be reactivated, by anyone who can edit it.
    if (oldDoc && oldDoc.type === 'item_master' && oldDoc.merged_into) {
      if (newDoc.merged_into !== oldDoc.merged_into) {
        throw { forbidden: 'merged_into cannot be changed or cleared once an item is merged' };
      }
    }
    if (newDoc.merged_into && newDoc.deactivated !== true) {
      throw { forbidden: 'A merged item must be deactivated' };
    }
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
