// CR-231 FR-15b — append-only access to `audit_events`.
//
//   mongosh "mongodb://<admin>@host/admin" --file scripts/mongo-init/audit-events-roles.js
//
// Idempotent. Creates two custom roles on the app database (default `tentdb`):
//   auditEventsAppend  insert + find (+ createIndex)       → grant to the FastAPI user (on top of its other roles)
//   auditEventsSync    find + update        → grant to the sync-worker user
// Nobody gets `remove` on audit_events. MongoDB RBAC cannot limit `update` to one field, so the
// "worker only touches synced_to_couch" rule is enforced in code (worker/inbound/audit.py).
//
// NOT wired into docker-compose: every compose profile currently runs Mongo without auth, so
// these roles take effect only once auth is enabled and users are created with them.
const dbName = (typeof APP_DB === 'string' && APP_DB) || 'tentdb';
const app = db.getSiblingDB(dbName);
const resource = { db: dbName, collection: 'audit_events' };

function upsertRole(role, actions) {
	const privileges = [{ resource, actions }];
	if (app.getRole(role)) app.updateRole(role, { privileges, roles: [] });
	else app.createRole({ role, privileges, roles: [] });
}

// `createIndex`: init_beanie (FastAPI + worker startup) ensures the audit_events indexes; it
// changes no data, so it does not break append-only.
upsertRole('auditEventsAppend', ['insert', 'find', 'createIndex']);
upsertRole('auditEventsSync', ['find', 'update', 'createIndex']);
print(`audit_events roles ready in ${dbName}`);
