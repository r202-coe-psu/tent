/**
 * Real-CouchDB fixtures for Distribution browser journeys.
 *
 * The suite runs in its own `E2E Distribution …` shelter (README §4.3), created
 * through the system-management UI by the `shelter` worker fixture and removed
 * with its database at the end of the worker. Helpers below read that active
 * shelter. Ticket lifecycle mutations, DistributionLog writes and StockLedger
 * writes are performed by the browser through the normal application path; the
 * seeders stand in for steps a test is not about (a ticket already dispatched,
 * a meal already served today, a bulk pool the warehouse already counted).
 *
 * Everything created outside the shelter DB (users, catalog items) is recorded in
 * the run ledger and deleted by id — never by query (README §4.2).
 */

import { createHash, randomBytes } from 'node:crypto';
import { ulid } from '../../src/lib/db/ulid';
import { deriveDeterministicLedgerId } from '../../src/lib/features/operations/domain/deterministic-ledger-id';
import {
	allDocuments,
	COUCH_BASE,
	couchLogin,
	couchReq,
	createCouchUser,
	deleteCouchUser,
	getDocument,
	putDocument,
	seedSecurityQuestion,
	type CouchDocument,
	type TestUser
} from '../helpers/couch';
import { E2E_SHELTER_PREFIX, forgetCreatedShelter } from '../helpers/public-cleanup';

const CATALOG_DB = 'catalog';
const CENTRAL_DBS = ['registry', CATALOG_DB] as const;
export const SA_ROLES = ['system_admin'];
export const DISTRIBUTION_SHELTER_PREFIX = `${E2E_SHELTER_PREFIX} Distribution`;
const PASSWORD = 'Password1!';

let activeShelter: { code: string; db: string } | null = null;

/** Point every helper at the run's own shelter (set by the `shelter` worker fixture). */
export function useShelter(code: string): void {
	activeShelter = { code, db: `shelter_${code.toLowerCase()}` };
}

function currentShelter(): { code: string; db: string } {
	if (!activeShelter) {
		throw new Error('No E2E distribution shelter — use the `shelter` / `scenarioAs` fixtures');
	}
	return activeShelter;
}

/** Code of the run's E2E shelter (e.g. `SH012`). */
export function shelterCode(): string {
	return currentShelter().code;
}

/** CouchDB database of the run's E2E shelter. */
export function shelterDb(): string {
	return currentShelter().db;
}

/** Ids this worker created outside its shelter DB — deleted by id, checked for leaks. */
const runLedger = { users: new Set<string>(), catalog: new Set<string>() };

/** `flat` = legacy bare capability; `compound` = `{code}:{capability}` (CR-093). */
export type RoleForm = 'flat' | 'compound';

/** Shelter-scoped role set for one capability, in either CR-093 form. */
export function roleSet(capability: string, form: RoleForm, code = shelterCode()): string[] {
	return [`shelter:${code}`, form === 'compound' ? `${code}:${capability}` : capability];
}

export interface DistributionScenario {
	namespace: string;
	user: TestUser;
	session: string;
	/** Catalog documents this scenario seeded — deleted by id at cleanup. */
	catalogIds: Set<string>;
	/** Extra users (RBAC actors) created inside this scenario; deleted with it. */
	actors: TestUser[];
}

export interface SeededItem {
	itemId: string;
	lotId: string;
	name: string;
	returnable: boolean;
	typeClass: 'CONSUMABLE' | 'DURABLE';
}

export interface SeededRecipient {
	recipientId: string;
	firstName: string;
	lastName: string;
}

/** A volunteer recipient plus the credentials a desk can scan for them (#650). */
export interface SeededVolunteer extends SeededRecipient {
	volunteerCode: string;
	/** Plaintext `TKT-VOL-…` pass token — only its hash is stored, as the app does. */
	token: string;
	/** What the pass QR encodes: the digital-pass URL ending in the token. */
	passUrl: string;
}

export interface SeededTicket {
	ticketId: string;
	ticketNo: string;
	type: 'food' | 'supplies';
}

export interface CreateDistributionScenarioOptions {
	/** Defaults to shelter_manager (flat) on the run's shelter when omitted. */
	roles?: string[];
}

/** Every test receives a unique namespace; no worker shares fixture ownership. */
export async function createDistributionScenario(
	label: string,
	options: CreateDistributionScenarioOptions = {}
): Promise<DistributionScenario> {
	const namespace = `e2e_${label}_${ulid().toLowerCase()}`;
	const user: TestUser = {
		name: `${namespace}_sm`,
		password: PASSWORD,
		roles: options.roles ?? roleSet('shelter_manager', 'flat'),
		display_name: `Distribution ${label}`
	};
	runLedger.users.add(user.name);
	await createCouchUser(user);
	await seedSecurityQuestion(user.name);
	return {
		namespace,
		user,
		session: await couchLogin(user.name, user.password),
		catalogIds: new Set(),
		actors: []
	};
}

/** A second user in the same scenario (e.g. the role under test while the SM seeds). */
export async function addScenarioActor(
	scenario: DistributionScenario,
	label: string,
	roles: string[]
): Promise<{ user: TestUser; session: string }> {
	const user: TestUser = {
		name: `${scenario.namespace}_${label}`.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
		password: PASSWORD,
		roles,
		display_name: `Distribution ${label}`
	};
	runLedger.users.add(user.name);
	scenario.actors.push(user);
	await createCouchUser(user);
	await seedSecurityQuestion(user.name);
	return { user, session: await couchLogin(user.name, user.password) };
}

/** Distribution point (`destination_location`) owned by one scenario — isolates its tickets. */
export function scenarioPoint(scenario: DistributionScenario): string {
	return `จุดแจก ${scenario.namespace}`;
}

/**
 * Delete what this scenario recorded: its catalog items and its users. Shelter
 * documents go with the shelter database at the end of the worker.
 */
export async function cleanupDistributionScenario(scenario: DistributionScenario): Promise<void> {
	const errors: Error[] = [];
	for (const id of scenario.catalogIds) {
		try {
			const doc = await getDocument(CATALOG_DB, id);
			if (doc?._rev) {
				const res = await couchReq(
					'DELETE',
					`/${CATALOG_DB}/${encodeURIComponent(id)}?rev=${encodeURIComponent(doc._rev)}`
				);
				if (res.status >= 400 && res.status !== 404) {
					throw new Error(`Could not remove E2E catalog document ${id} (HTTP ${res.status})`);
				}
			}
			runLedger.catalog.delete(id);
		} catch (error) {
			errors.push(error instanceof Error ? error : new Error(String(error)));
		}
	}
	for (const user of [scenario.user, ...scenario.actors]) {
		try {
			await deleteCouchUser(user.name);
			runLedger.users.delete(user.name);
		} catch (error) {
			errors.push(error instanceof Error ? error : new Error(String(error)));
		}
	}
	if (errors.length > 0) {
		throw new AggregateError(errors, `Could not fully clean E2E scenario ${scenario.namespace}`);
	}
}

/**
 * Build the new shelter's view indexes before the first test: CouchDB builds a view on its
 * first query, which on a fresh database can outlast a route guard's lookup.
 */
export async function warmShelterIndexes(code: string): Promise<void> {
	const db = `shelter_${code.toLowerCase()}`;
	await couchReq(
		'GET',
		`/registry/_design/app/_view/by_code?key=${encodeURIComponent(JSON.stringify(code))}`
	);
	const designs = await couchReq('GET', `/${db}/_design_docs?include_docs=true`);
	const rows =
		(designs.data as { rows?: { id: string; doc?: { views?: Record<string, unknown> } }[] } | null)
			?.rows ?? [];
	for (const row of rows) {
		const view = Object.keys(row.doc?.views ?? {})[0];
		if (!view) continue;
		await couchReq('GET', `/${db}/${row.id}/_view/${encodeURIComponent(view)}?limit=1`);
	}
}

/**
 * Remove the run's shelter: close it, delete its registry master and database, and
 * take `shelter:{code}` back out of the central DBs' `_security`. Refuses any
 * shelter that is not an `E2E Distribution …` one.
 */
export async function teardownDistributionShelter(code: string): Promise<void> {
	const byCode = await couchReq(
		'GET',
		`/registry/_design/app/_view/by_code?key=${encodeURIComponent(JSON.stringify(code))}&include_docs=true`
	);
	const master = (byCode.data as { rows?: { doc?: CouchDocument }[] } | null)?.rows?.[0]?.doc;
	if (master) {
		if (!String(master.name ?? '').startsWith(DISTRIBUTION_SHELTER_PREFIX)) {
			throw new Error(`Refusing to tear down non-E2E shelter ${code} ("${String(master.name)}")`);
		}
		// Closed first, so a running sync worker projects the shelter out of the public plane.
		const path = `/registry/${encodeURIComponent(master._id)}`;
		const closed = await couchReq('PUT', path, {
			...master,
			operation_status: 'closed',
			updated_at: new Date().toISOString()
		});
		if (closed.status >= 400) throw new Error(`close ${code} failed (HTTP ${closed.status})`);
		const rev = (closed.data as { rev: string }).rev;
		const removed = await couchReq('DELETE', `${path}?rev=${encodeURIComponent(rev)}`);
		if (removed.status >= 400 && removed.status !== 404) {
			throw new Error(`delete registry master of ${code} failed (HTTP ${removed.status})`);
		}
	}
	const dropped = await couchReq('DELETE', `/shelter_${code.toLowerCase()}`);
	if (dropped.status >= 400 && dropped.status !== 404) {
		throw new Error(`delete database of ${code} failed (HTTP ${dropped.status})`);
	}
	for (const db of CENTRAL_DBS) {
		const current = await couchReq('GET', `/${db}/_security`);
		const security = (current.data ?? {}) as {
			admins?: { names?: string[]; roles?: string[] };
			members?: { names?: string[]; roles?: string[] };
		};
		const roles = security.members?.roles ?? [];
		if (!roles.includes(`shelter:${code}`)) continue;
		const res = await couchReq('PUT', `/${db}/_security`, {
			...security,
			members: { ...security.members, roles: roles.filter((r) => r !== `shelter:${code}`) }
		});
		if (res.status >= 400) throw new Error(`${db}/_security cleanup failed (HTTP ${res.status})`);
	}
	forgetCreatedShelter(code);
}

/** Zero-leak check (README §4.6): the shelter, its scope and every recorded id are gone. */
export async function assertRunLeftNothing(code: string): Promise<void> {
	const leaks: string[] = [];
	if ((await couchReq('GET', `/shelter_${code.toLowerCase()}`)).status !== 404) {
		leaks.push(`database shelter_${code.toLowerCase()}`);
	}
	const byCode = await couchReq(
		'GET',
		`/registry/_design/app/_view/by_code?key=${encodeURIComponent(JSON.stringify(code))}`
	);
	if (((byCode.data as { rows?: unknown[] } | null)?.rows ?? []).length > 0) {
		leaks.push(`registry master ${code}`);
	}
	for (const db of CENTRAL_DBS) {
		const sec = await couchReq('GET', `/${db}/_security`);
		const roles = (sec.data as { members?: { roles?: string[] } } | null)?.members?.roles ?? [];
		if (roles.includes(`shelter:${code}`)) leaks.push(`${db}/_security shelter:${code}`);
	}
	for (const name of runLedger.users) {
		if (
			(await couchReq('GET', `/_users/org.couchdb.user:${encodeURIComponent(name)}`)).status !== 404
		) {
			leaks.push(`user ${name}`);
		}
	}
	for (const id of runLedger.catalog) {
		if (await getDocument(CATALOG_DB, id)) leaks.push(`catalog ${id}`);
	}
	if (leaks.length > 0) throw new Error(`E2E distribution run leaked: ${leaks.join(', ')}`);
}

/**
 * Fails fast when the new shelter's scope cannot read the central DBs (CR
 * central-db-shelter-scope-members FR-2) — compound-role users would otherwise hit
 * a navbar error that looks like a desk bug.
 */
export async function assertCentralDbAccessReady(): Promise<void> {
	for (const db of CENTRAL_DBS) {
		const res = await couchReq('GET', `/${db}/_security`);
		const roles = (res.data as { members?: { roles?: string[] } } | null)?.members?.roles ?? [];
		if (!roles.includes(`shelter:${shelterCode()}`)) {
			throw new Error(
				`${db}/_security does not admit shelter:${shelterCode()} — shelter provisioning did not grant the central DBs (CR central-db-shelter-scope-members)`
			);
		}
	}
}

/** Registry display name of a shelter — what the staff navbar shows once it loads. */
export async function shelterName(code: string = shelterCode()): Promise<string> {
	const res = await couchReq('GET', '/registry/_all_docs?include_docs=true');
	const rows = (
		res.data as { rows?: Array<{ doc?: { type?: string; code?: string; name?: string } }> }
	)?.rows;
	const name = rows?.find((row) => row.doc?.type === 'shelter' && row.doc.code === code)?.doc?.name;
	if (!name) throw new Error(`registry has no shelter ${code}`);
	return name;
}

export interface SeedItemOptions {
	name: string;
	stockQty: string;
	returnable: boolean;
	typeClass: 'CONSUMABLE' | 'DURABLE';
	/** Dietary tags on the menu; since #801 none of them restrict who may take it. */
	dietary?: string[];
	/** Age group the menu targets — the desk's menu-match check reads it (FR-MRM-01). */
	ageGroup?: 'INFANT' | 'CHILD' | 'ELDERLY';
	/** ISO expiry on the physical lot — the desk's ready-meal safety clock reads it. */
	lotExpiry?: string;
	/** `allergy` master codes or free text the menu lists (#607). */
	allergens?: string[];
}

/** Seed a canonical item master and a real inbound physical lot. */
export async function seedItemWithStock(
	scenario: DistributionScenario,
	options: SeedItemOptions
): Promise<SeededItem> {
	const itemId = `item_master:${ulid()}`;
	const lotId = `stock_ledger:${ulid()}`;
	const now = new Date().toISOString();
	await putDocument(CATALOG_DB, {
		_id: itemId,
		type: 'item_master',
		schema_v: 4,
		created_at: now,
		updated_at: now,
		created_by: scenario.user.name,
		name: options.name,
		category: 'E2E_SUPPLIES',
		sku: scenario.namespace,
		base_unit: 'piece',
		conversions: [],
		default_inventory_uom: 'piece',
		default_issue_uom: 'piece',
		distribution_type: 'recurring',
		type_class: options.typeClass,
		deactivated: false,
		dietary: options.dietary ?? [],
		...(options.ageGroup ? { age_group: options.ageGroup } : {}),
		...(options.allergens ? { allergens: options.allergens } : {}),
		returnable: options.returnable
	});
	scenario.catalogIds.add(itemId);
	runLedger.catalog.add(itemId);
	await putDocument(shelterDb(), {
		_id: lotId,
		type: 'stock_ledger',
		schema_v: 6,
		shelter_code: shelterCode(),
		created_at: now,
		updated_at: now,
		created_by: scenario.user.name,
		item_id: itemId,
		qty: options.stockQty,
		unit: 'piece',
		reason: 'adjust',
		adjust_reason: 'found',
		ref_id: null,
		lot_ref: lotId,
		...(options.lotExpiry ? { lot: { expiry: options.lotExpiry } } : {}),
		occurred_at: now
	});
	return {
		itemId,
		lotId,
		name: options.name,
		returnable: options.returnable,
		typeClass: options.typeClass
	};
}

export interface SeedRecipientOptions {
	/** Free text on the evacuee; since #801 it no longer affects menu matching. */
	religion?: string;
	/** Thai Buddhist birth year — sets the recipient's CR-130 age bucket for menu matching. */
	birthYear?: number;
	phone?: string;
	/** Seeds a `medical` doc with these allergies (`allergy` codes or free text, #607). */
	allergies?: string[];
}

/** Seed a valid, active evacuee for the recipient picker. */
export async function seedRecipient(
	scenario: DistributionScenario,
	firstName: string,
	lastName: string,
	options: SeedRecipientOptions = {}
): Promise<SeededRecipient> {
	const recipientId = `evacuee:${ulid()}`;
	const now = new Date().toISOString();
	await putDocument(shelterDb(), {
		_id: recipientId,
		type: 'evacuee',
		schema_v: 10,
		shelter_code: shelterCode(),
		created_at: now,
		updated_at: now,
		created_by: scenario.user.name,
		first_name: firstName,
		last_name: lastName,
		gender: 'other',
		phone: options.phone ?? null,
		person_id: { cardType: 'anonymous', number: `ANON-${ulid()}` },
		country: 'THAILAND',
		religion: options.religion ?? 'buddhist',
		...(options.birthYear ? { birth_year: options.birthYear } : {}),
		vulnerable_groups: [],
		special_needs: [],
		household_id: null,
		current_stay: { status: 'active', zone: 'A', since: now },
		privacy: { search_excluded: false },
		registered_via: 'staff'
	});
	if (options.allergies) {
		await putDocument(shelterDb(), {
			_id: `medical:${ulid()}`,
			type: 'medical',
			schema_v: 1,
			shelter_code: shelterCode(),
			created_at: now,
			updated_at: now,
			created_by: scenario.user.name,
			evacuee_id: recipientId,
			allergies: options.allergies,
			track: 'normal'
		});
	}
	return { recipientId, firstName, lastName };
}

/**
 * Seed a volunteer with a role-card token, stored only as its SHA-256 the way
 * `volunteer.remote.ts#create` mints it. `inactive` is the volunteer soft-delete.
 */
export async function seedVolunteer(
	scenario: DistributionScenario,
	firstName: string,
	lastName: string,
	options: { status?: 'active' | 'inactive'; phone?: string } = {}
): Promise<SeededVolunteer> {
	const recipientId = `volunteer:${ulid()}`;
	const token = `TKT-VOL-${randomBytes(16).toString('hex').toUpperCase()}`;
	// Unique within the shared run shelter; `V-{NNN}` is not unique-indexed (volunteer-code.ts F14).
	const volunteerCode = `V-${Date.now()}${Math.floor(Math.random() * 1000)}`;
	const now = new Date().toISOString();
	await putDocument(shelterDb(), {
		_id: recipientId,
		type: 'volunteer',
		schema_v: 4,
		shelter_code: shelterCode(),
		created_at: now,
		updated_at: now,
		created_by: scenario.user.name,
		first_name: firstName,
		last_name: lastName,
		phone: options.phone ?? null,
		skills: [],
		tracking_token_hash: createHash('sha256').update(token).digest('hex'),
		status: options.status ?? 'active',
		checked_in: false,
		volunteer_code: volunteerCode,
		identity_verified: false,
		source: 'staff_entry',
		personnel_type: 'volunteer'
	});
	return {
		recipientId,
		firstName,
		lastName,
		volunteerCode,
		token,
		passUrl: `https://shelter.example/volunteer/ticket/${token}`
	};
}

export type SeedTicketStatus =
	'READY_FOR_DISPATCH' | 'IN_TRANSIT' | 'DISTRIBUTING' | 'SHIFT_CLOSED';
export type MealPeriod = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface SeedTicketOptions {
	type: 'food' | 'supplies';
	status: SeedTicketStatus;
	lines: Array<{ item: SeededItem; allocatedQty: string }>;
	/** Food tickets only — drives the meal badge and the duplicate-meal check. */
	meal?: MealPeriod;
	/** Defaults to the scenario's own point, so desk filters can isolate the ticket. */
	destination?: string;
	/** Service day is derived from `created_at` (FR-MQW-03 A). Defaults to now. */
	createdAt?: string;
	/**
	 * Write the dispatch `distribute` row dispatchTicket would have written (deterministic id,
	 * `lot_ref` → the seeded lot), so the desk can read the lot expiry. Defaults to true once
	 * the ticket is past dispatch.
	 */
	withDispatchLedger?: boolean;
}

let ticketSeq = 0;

/** A ticket at `status`, carrying the actor fields earlier steps would have set. */
export async function seedTicket(
	scenario: DistributionScenario,
	options: SeedTicketOptions
): Promise<SeededTicket> {
	const ticketId = `requisition_ticket:${ulid()}`;
	ticketSeq = (ticketSeq + 1) % 1000;
	const ticketNo = `TKT-${options.type.toUpperCase()}-${Date.now()}${String(ticketSeq).padStart(3, '0')}`;
	const createdAt = options.createdAt ?? new Date().toISOString();
	const actor = scenario.user.name;
	const dispatched = options.status !== 'READY_FOR_DISPATCH';
	const received = dispatched && options.status !== 'IN_TRANSIT';
	await putDocument(shelterDb(), {
		_id: ticketId,
		type: 'requisition_ticket',
		schema_v: 1,
		shelter_code: shelterCode(),
		created_at: createdAt,
		updated_at: createdAt,
		created_by: actor,
		ticket_no: ticketNo,
		requisition_type: options.type,
		status: options.status,
		...(options.meal ? { meal: options.meal } : {}),
		source_location: 'คลังสินค้า',
		destination_location: options.destination ?? scenarioPoint(scenario),
		requested_by: actor,
		approved_by: actor,
		...(dispatched
			? { driver_name: 'คนขับ E2E', license_plate: 'E2E-0001', dispatched_by: actor }
			: {}),
		...(received ? { received_by: actor } : {}),
		items: options.lines.map(({ item, allocatedQty }) => ({
			item_id: item.itemId,
			item_name: item.name,
			category: 'E2E_SUPPLIES',
			type_class: item.typeClass,
			...(item.returnable ? { returnable: true } : {}),
			requested_qty: allocatedQty,
			allocated_qty: allocatedQty
		}))
	});

	if (options.withDispatchLedger ?? dispatched) {
		for (const { item, allocatedQty } of options.lines) {
			const dispatchId = await deriveDeterministicLedgerId('dispatch', ticketId, item.itemId);
			await putDocument(shelterDb(), {
				_id: dispatchId,
				type: 'stock_ledger',
				schema_v: 6,
				shelter_code: shelterCode(),
				created_at: createdAt,
				updated_at: createdAt,
				created_by: actor,
				item_id: item.itemId,
				qty: `-${allocatedQty}`,
				unit: 'piece',
				reason: 'distribute',
				ref_id: ticketId,
				lot_ref: item.lotId,
				occurred_at: createdAt
			});
		}
	}
	return { ticketId, ticketNo, type: options.type };
}

/**
 * Journey C seeds its prerequisite supplies ticket; its loan operations stay browser-driven.
 * `status` defaults to `'DISTRIBUTING'`; pass `'IN_TRANSIT'` for a ticket awaiting receipt.
 */
export async function seedDistributingTicket(
	scenario: DistributionScenario,
	item: SeededItem,
	allocatedQty: string,
	status: 'DISTRIBUTING' | 'IN_TRANSIT' = 'DISTRIBUTING'
): Promise<SeededTicket> {
	return seedTicket(scenario, {
		type: 'supplies',
		status,
		lines: [{ item, allocatedQty }]
	});
}

/**
 * A handover that already happened: a meal served today (`meal` set — the next meal is a
 * duplicate), a fulfilled consumable, or an outstanding loan (`returnable`).
 */
export async function seedDistributionLog(
	scenario: DistributionScenario,
	options: {
		ticket: SeededTicket;
		item: SeededItem;
		recipient: SeededRecipient;
		qty?: string;
		meal?: MealPeriod;
		returnable?: boolean;
	}
): Promise<string> {
	const logId = `distribution_log:${ulid()}`;
	const now = new Date().toISOString();
	const returnable = options.returnable ?? false;
	await putDocument(shelterDb(), {
		_id: logId,
		type: 'distribution_log',
		schema_v: 1,
		shelter_code: shelterCode(),
		created_at: now,
		updated_at: now,
		created_by: scenario.user.name,
		ticket_id: options.ticket.ticketId,
		item_id: options.item.itemId,
		qty: options.qty ?? '1',
		recipient_type: options.recipient.recipientId.startsWith('volunteer:')
			? 'volunteer'
			: 'evacuee',
		recipient_id: options.recipient.recipientId,
		...(options.meal ? { meal: options.meal } : {}),
		is_returnable: returnable,
		status: returnable ? 'active' : 'fulfilled',
		is_override: false,
		distributed_at: now,
		distributed_by: scenario.user.name
	});
	return logId;
}

/** A counted bulk drop-off (back-office only in the app) waiting to be matched to loans. */
export async function seedBulkReturnPool(
	scenario: DistributionScenario,
	item: SeededItem,
	qty: string
): Promise<string> {
	const poolId = `bulk_return_pool:${ulid()}`;
	const receiptId = `stock_ledger:${ulid()}`;
	const now = new Date().toISOString();
	await putDocument(shelterDb(), {
		_id: receiptId,
		type: 'stock_ledger',
		schema_v: 6,
		shelter_code: shelterCode(),
		created_at: now,
		updated_at: now,
		created_by: scenario.user.name,
		item_id: item.itemId,
		qty,
		unit: 'piece',
		reason: 'receive',
		ref_id: poolId,
		lot_ref: receiptId,
		occurred_at: now
	});
	await putDocument(shelterDb(), {
		_id: poolId,
		type: 'bulk_return_pool',
		schema_v: 2,
		shelter_code: shelterCode(),
		created_at: now,
		updated_at: now,
		created_by: scenario.user.name,
		item_id: item.itemId,
		stock_ledger_id: receiptId,
		total_received_qty: qty,
		claimed_qty: '0',
		unclaimed_quota: qty,
		claim_ids: [],
		status: 'ACTIVE'
	});
	return poolId;
}

/** CouchDB request made as an application user (cookie session) — the VDU applies. */
export async function couchAsUser(
	session: string,
	method: 'GET' | 'PUT' | 'POST',
	path: string,
	body?: unknown
): Promise<{ status: number; data: unknown }> {
	const res = await fetch(`${COUCH_BASE}${path}`, {
		method,
		headers: {
			Cookie: `AuthSession=${session}`,
			'Content-Type': 'application/json',
			Accept: 'application/json'
		},
		...(body !== undefined ? { body: JSON.stringify(body) } : {})
	});
	const data = await res.json().catch(() => null);
	return { status: res.status, data };
}

export async function getShelterDocument(id: string): Promise<CouchDocument | null> {
	const res = await couchReq('GET', `/${shelterDb()}/${encodeURIComponent(id)}`);
	if (res.status === 404) return null;
	if (res.status >= 400 || !res.data || typeof res.data !== 'object') {
		throw new Error(`Could not read ${id} from test CouchDB`);
	}
	return res.data as CouchDocument;
}

export async function findShelterDocuments(
	predicate: (doc: CouchDocument) => boolean
): Promise<CouchDocument[]> {
	return (await allDocuments(shelterDb())).filter(predicate);
}
