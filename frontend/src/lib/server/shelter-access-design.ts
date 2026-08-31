/**
 * CouchDB `_design/access` helpers for per-shelter databases.
 * Shared by provisioning (+server.ts) and admin redeploy (shelters.admin.ts).
 */

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
    if (wasAppendOnly) {
      throw { forbidden: 'Cannot delete append-only ' + oldDoc.type + ' documents' };
    }
    return;
  }
  // Base append-only policy on the persisted document identity as well as the
  // proposed type so an update cannot evade the guard by changing the type field.
  if (wasAppendOnly) {
    throw { forbidden: 'Cannot update append-only ' + oldDoc.type + ' documents' };
  }
  var phase3StableTypes = ['distribution_request', 'distribution_batch', 'stock_lot_reservation'];
  if (oldDoc && phase3StableTypes.indexOf(oldDoc.type) !== -1 && newDoc.type !== oldDoc.type) {
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
    'audit', 'daily_calc', 'purchase', 'referral',
    'meal_plan', 'kitchen_requisition', 'meal_service', 'gas_cylinder_type', 'gas_ledger',
    'distribution_request', 'distribution_batch', 'stock_lot_reservation'
  ];
  if (allowed.indexOf(newDoc.type) === -1) {
    throw { forbidden: 'doc type not allowed yet: ' + newDoc.type };
  }
  // 1. append-only: stock_ledger / audit / movement / screening are never rewritten
  if (appendOnly.indexOf(newDoc.type) !== -1 && oldDoc) {
    throw { forbidden: 'Cannot update append-only ' + newDoc.type + ' documents' };
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
}`;
}
