export const AUDIT_ACTIONS = ['create', 'update', 'delete', 'status_change', 'other'] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ACTOR_KINDS = ['user', 'system', 'worker', 'unknown'] as const;
export type AuditActorKind = (typeof AUDIT_ACTOR_KINDS)[number];

export const AUDIT_ENTITY_TYPES = [
	'shelter',
	'user',
	'master_data',
	'api_key',
	'thirdparty_client',
	'item_category',
	'item_master',
	'recipe',
	'unit_of_measure',
	'food_sphere_standard',
	'requirement_group',
	'replenishment_policy',
	'evacuee',
	'household',
	'medical'
] as const;
export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

export const AUDIT_EVENTS = {
	shelterCreated: 'shelter.created',
	shelterUpdated: 'shelter.updated',
	shelterClosed: 'shelter.closed',
	shelterZoneClosed: 'shelter.zone_closed',
	shelterZoneReopened: 'shelter.zone_reopened',
	shelterStoragePointChanged: 'shelter.storage_point_changed',
	shelterImported: 'shelter.imported',
	userCreated: 'user.created',
	userUpdated: 'user.updated',
	userRolesChanged: 'user.roles_changed',
	userDeleted: 'user.deleted',
	userPasswordReset: 'user.password_reset',
	userStaffCardRotated: 'user.staff_card_rotated',
	masterDataUpdated: 'master_data.updated',
	apiKeyCreated: 'api_key.created',
	apiKeyUpdated: 'api_key.updated',
	apiKeyRevoked: 'api_key.revoked',
	thirdpartyClientCreated: 'thirdparty_client.created',
	thirdpartyClientUpdated: 'thirdparty_client.updated',
	thirdpartyClientDeleted: 'thirdparty_client.deleted',
	thirdpartyClientSecretViewed: 'thirdparty_client.secret_viewed'
} as const;
export type AuditEventName = (typeof AUDIT_EVENTS)[keyof typeof AUDIT_EVENTS];

export const AUDIT_EVENT_ID_PREFIX = 'audit_event:';

export type AuditActor = { name: string; kind: AuditActorKind };
export type AuditEntity = { type: string; id: string; label: string | null };
export type AuditChange = { field: string; from?: unknown; to?: unknown };

export interface AuditEvent {
	_id: string;
	_rev?: string;
	type: 'audit_event';
	schema_v: 1;
	occurred_at: string;
	created_at: string;
	updated_at: string;
	created_by: string;
	actor: AuditActor;
	action: AuditAction;
	event: string;
	entity: AuditEntity;
	shelter_code: string | null;
	changes?: AuditChange[];
	reason?: string | null;
	source: 'bff' | 'worker_copy' | 'worker_diff';
	source_ref?: string | null;
	changes_unknown?: boolean;
}

export const AUDIT_VALUE_ALLOWLIST: Record<AuditEntityType, readonly string[]> = {
	shelter: [
		'name',
		'operation_status',
		'capacity',
		'site_kind',
		'shelter_type',
		'project_level',
		'area_m2',
		'area_type',
		'floor_count',
		'province',
		'district',
		'subdistrict'
	],
	user: ['roles', 'display_name', 'active'],
	master_data: [],
	api_key: ['name', 'scopes', 'status', 'expires_at'],
	thirdparty_client: ['name', 'status', 'allowed_scopes'],
	item_category: ['name', 'default_class', 'is_default', 'deactivated'],
	item_master: [
		'name',
		'sku',
		'category',
		'base_unit',
		'distribution_type',
		'type_class',
		'qty_per_person',
		'returnable',
		'shelf_life_days',
		'storage_type',
		'deactivated',
		'merged_into'
	],
	recipe: ['label', 'standard_portions', 'standard_duration_hours', 'deactivated'],
	unit_of_measure: ['code', 'label_th', 'label_en', 'dimension', 'sort_order', 'deactivated'],
	food_sphere_standard: [],
	requirement_group: [],
	replenishment_policy: [],
	evacuee: ['household_id', 'preferred_zone', 'registered_via', 'anonymized'],
	household: ['status', 'head_evacuee_id', 'housing_type'],
	medical: []
};

const IGNORED_FIELDS = new Set([
	'_id',
	'_rev',
	'type',
	'schema_v',
	'created_at',
	'updated_at',
	'created_by',
	'updated_by',
	'password',
	'password_scheme',
	'derived_key',
	'salt',
	'iterations',
	'pbkdf2_prf'
]);

function canonical(value: unknown): string {
	if (value === undefined || value === null) return 'null';
	if (typeof value !== 'object') return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	const entries = Object.keys(value as Record<string, unknown>)
		.sort()
		.map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`);
	return `{${entries.join(',')}}`;
}

function isLoggableValue(value: unknown): boolean {
	if (value === null || value === undefined) return true;
	if (['string', 'number', 'boolean'].includes(typeof value)) return true;
	return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

export function computeAuditChanges(
	entityType: AuditEntityType,
	before: Record<string, unknown> | null | undefined,
	after: Record<string, unknown> | null | undefined
): AuditChange[] {
	const prev = before ?? {};
	const next = after ?? {};
	const allowlist = new Set(AUDIT_VALUE_ALLOWLIST[entityType]);
	const fields = [...new Set([...Object.keys(prev), ...Object.keys(next)])]
		.filter((f) => !IGNORED_FIELDS.has(f))
		.sort();
	const changes: AuditChange[] = [];
	for (const field of fields) {
		const from = prev[field];
		const to = next[field];
		if (canonical(from) === canonical(to)) continue;
		if (allowlist.has(field) && isLoggableValue(from) && isLoggableValue(to)) {
			changes.push({ field, from: from ?? null, to: to ?? null });
		} else {
			changes.push({ field });
		}
	}
	return changes;
}

export type AuditEventInput = {
	actor: string;
	actorKind?: AuditActorKind;
	action: AuditAction;
	event: string;
	entity: AuditEntity;
	shelterCode: string | null;
	changes?: AuditChange[];
	reason?: string | null;
	occurredAt?: string;
};

export function buildAuditEvent(input: AuditEventInput, id: string, now: string): AuditEvent {
	const hasChanges = input.action !== 'create' && input.action !== 'delete';
	return {
		_id: `${AUDIT_EVENT_ID_PREFIX}${id}`,
		type: 'audit_event',
		schema_v: 1,
		occurred_at: input.occurredAt ?? now,
		created_at: now,
		updated_at: now,
		created_by: input.actor,
		actor: { name: input.actor, kind: input.actorKind ?? 'user' },
		action: input.action,
		event: input.event,
		entity: input.entity,
		shelter_code: input.shelterCode,
		...(hasChanges && input.changes ? { changes: input.changes } : {}),
		reason: input.reason ?? null,
		source: 'bff',
		source_ref: null
	};
}

export function auditShelterCodesFromRoles(
	...roleLists: ReadonlyArray<readonly string[] | null | undefined>
): Array<string | null> {
	const codes = new Set<string>();
	for (const roles of roleLists) {
		for (const role of roles ?? []) {
			if (role.startsWith('shelter:')) codes.add(role.slice('shelter:'.length));
		}
	}
	return codes.size > 0 ? [...codes].sort() : [null];
}
