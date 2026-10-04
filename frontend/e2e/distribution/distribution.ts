/**
 * Real-CouchDB fixtures for Distribution browser journeys.
 *
 * These helpers seed prerequisites only. Ticket lifecycle mutations,
 * DistributionLog writes, and StockLedger writes are deliberately performed
 * by the browser through the normal application path.
 */

import { ulid } from '../../src/lib/db/ulid';
import {
	allDocuments,
	couchLogin,
	couchReq,
	createCouchUser,
	deleteCouchUser,
	deleteDocument,
	putDocument,
	seedSecurityQuestion,
	type CouchDocument,
	type TestUser
} from '../helpers/couch';

export const SHELTER_DB = 'shelter_sh001';
const CATALOG_DB = 'catalog';
export const SM_DIST_ROLES = ['shelter:SH001', 'shelter_manager'];

export interface DistributionScenario {
	namespace: string;
	user: TestUser;
	session: string;
	ownedDocumentIds: Set<string>;
}

export interface SeededItem {
	itemId: string;
	lotId: string;
	name: string;
}

export interface SeededRecipient {
	recipientId: string;
	firstName: string;
	lastName: string;
}

export interface CreateDistributionScenarioOptions {
	/** Defaults to `SM_DIST_ROLES` (shelter_manager on SH001) when omitted. */
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
		password: 'Password1!',
		roles: options.roles ?? SM_DIST_ROLES,
		display_name: `Distribution ${label}`
	};
	await createCouchUser(user);
	await seedSecurityQuestion(user.name);
	return {
		namespace,
		user,
		session: await couchLogin(user.name, user.password),
		ownedDocumentIds: new Set()
	};
}

function registerOwnedDocument(scenario: DistributionScenario, id: string): void {
	scenario.ownedDocumentIds.add(id);
}

function isOwnedDocument(scenario: DistributionScenario, doc: CouchDocument): boolean {
	return scenario.ownedDocumentIds.has(doc._id) || doc.created_by === scenario.user.name;
}

/**
 * Deletes documents created by this test user or explicitly registered fixture
 * IDs. Application-created ticket, log, ledger, and reservation documents retain
 * the actor as created_by, so ownership stays exact across parallel workers.
 */
export async function cleanupDistributionScenario(scenario: DistributionScenario): Promise<void> {
	const errors: Error[] = [];
	for (const db of [SHELTER_DB, CATALOG_DB]) {
		for (let pass = 0; pass < 3; pass += 1) {
			let documents: CouchDocument[];
			try {
				documents = await allDocuments(db);
			} catch (error) {
				errors.push(error instanceof Error ? error : new Error(String(error)));
				break;
			}
			const owned = documents.filter((doc) => isOwnedDocument(scenario, doc));
			if (owned.length === 0) break;
			const results = await Promise.allSettled(owned.map((doc) => deleteDocument(db, doc)));
			for (const result of results) {
				if (result.status === 'rejected') {
					errors.push(
						result.reason instanceof Error ? result.reason : new Error(String(result.reason))
					);
				}
			}
		}
	}
	try {
		await deleteCouchUser(scenario.user.name);
	} catch (error) {
		errors.push(error instanceof Error ? error : new Error(String(error)));
	}
	if (errors.length > 0) {
		throw new AggregateError(errors, `Could not fully clean E2E scenario ${scenario.namespace}`);
	}
}

/** Seed a canonical item master and a real inbound physical lot. */
export async function seedItemWithStock(
	scenario: DistributionScenario,
	options: {
		name: string;
		stockQty: string;
		returnable: boolean;
		typeClass: 'CONSUMABLE' | 'DURABLE';
	}
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
		dietary: [],
		returnable: options.returnable
	});
	registerOwnedDocument(scenario, itemId);
	await putDocument(SHELTER_DB, {
		_id: lotId,
		type: 'stock_ledger',
		schema_v: 4,
		shelter_code: 'SH001',
		created_at: now,
		updated_at: now,
		created_by: scenario.user.name,
		item_id: itemId,
		qty: options.stockQty,
		unit: 'piece',
		reason: 'adjust',
		ref_id: null,
		lot_ref: lotId,
		occurred_at: now
	});
	registerOwnedDocument(scenario, lotId);
	return { itemId, lotId, name: options.name };
}

/** Seed a valid, active evacuee for the loan-issuance UI. */
export async function seedRecipient(
	scenario: DistributionScenario,
	firstName: string,
	lastName: string
): Promise<SeededRecipient> {
	const recipientId = `evacuee:${ulid()}`;
	const now = new Date().toISOString();
	await putDocument(SHELTER_DB, {
		_id: recipientId,
		type: 'evacuee',
		schema_v: 10,
		shelter_code: 'SH001',
		created_at: now,
		updated_at: now,
		created_by: scenario.user.name,
		first_name: firstName,
		last_name: lastName,
		gender: 'other',
		phone: null,
		person_id: { cardType: 'anonymous', number: `ANON-${ulid()}` },
		country: 'THAILAND',
		religion: 'buddhist',
		vulnerable_groups: [],
		special_needs: [],
		household_id: null,
		current_stay: { status: 'active', zone: 'A', since: now },
		privacy: { search_excluded: false },
		registered_via: 'staff'
	});
	registerOwnedDocument(scenario, recipientId);
	return { recipientId, firstName, lastName };
}

/**
 * Journey C alone seeds its prerequisite ticket; its loan operations stay browser-driven.
 * `status` defaults to `'DISTRIBUTING'` (Journey C's requirement); pass `'IN_TRANSIT'` for
 * fixtures that need a ticket still awaiting frontline receipt (e.g. RBAC guard checks).
 */
export async function seedDistributingTicket(
	scenario: DistributionScenario,
	item: SeededItem,
	allocatedQty: string,
	status: 'DISTRIBUTING' | 'IN_TRANSIT' = 'DISTRIBUTING'
): Promise<{ ticketId: string; ticketNo: string }> {
	const ticketId = `requisition_ticket:${ulid()}`;
	const ticketNo = `TKT-SUPPLIES-${Date.now()}`;
	const now = new Date().toISOString();
	await putDocument(SHELTER_DB, {
		_id: ticketId,
		type: 'requisition_ticket',
		schema_v: 1,
		shelter_code: 'SH001',
		created_at: now,
		updated_at: now,
		created_by: scenario.user.name,
		ticket_no: ticketNo,
		requisition_type: 'supplies',
		status,
		source_location: 'คลังสินค้า',
		destination_location: 'จุดแจก E2E',
		requested_by: scenario.user.name,
		approved_by: scenario.user.name,
		dispatched_by: scenario.user.name,
		...(status === 'DISTRIBUTING' ? { received_by: scenario.user.name } : {}),
		items: [
			{
				item_id: item.itemId,
				item_name: item.name,
				category: 'E2E_SUPPLIES',
				type_class: 'DURABLE',
				returnable: true,
				requested_qty: allocatedQty,
				allocated_qty: allocatedQty
			}
		]
	});
	registerOwnedDocument(scenario, ticketId);
	return { ticketId, ticketNo };
}

export async function getShelterDocument(id: string): Promise<CouchDocument | null> {
	const res = await couchReq('GET', `/${SHELTER_DB}/${encodeURIComponent(id)}`);
	if (res.status === 404) return null;
	if (res.status >= 400 || !res.data || typeof res.data !== 'object') {
		throw new Error(`Could not read ${id} from test CouchDB`);
	}
	return res.data as CouchDocument;
}

export async function findShelterDocuments(
	predicate: (doc: CouchDocument) => boolean
): Promise<CouchDocument[]> {
	return (await allDocuments(SHELTER_DB)).filter(predicate);
}
