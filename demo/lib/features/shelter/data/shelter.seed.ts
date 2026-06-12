import { SHELTER_IDS, shelterRole, type ShelterId, type ShelterRole } from '../domain/shelter';

/**
 * Pure setup metadata shared by the client admin feature and the server-side
 * admin endpoint. No browser- or server-only imports — safe in either context.
 */

export interface ShelterSeedUser {
	name: string;
	password: string;
	shelter: ShelterId;
	role: ShelterRole;
}

/** One manager + one volunteer per shelter. */
export const SHELTER_SEED_USERS: ShelterSeedUser[] = SHELTER_IDS.flatMap((id) => {
	const lc = id.toLowerCase();
	return [
		{ name: `manager_${lc}`, password: `manager_${lc}1234`, shelter: id, role: 'manager' as const },
		{ name: `vol_${lc}`, password: `vol_${lc}1234`, shelter: id, role: 'volunteer' as const }
	];
});

export interface ShelterSeedConfig {
	name: string;
	capacity: number;
}

export const SHELTER_SEED_CONFIG: Record<ShelterId, ShelterSeedConfig> = {
	A: { name: 'Shelter A — Riverside Hall', capacity: 50 },
	B: { name: 'Shelter B — Central School', capacity: 30 },
	C: { name: 'Shelter C — Community Gym', capacity: 20 }
};

export interface ShelterSeedItem {
	name: string;
	unit: string;
	initial: number;
}

export const SHELTER_SEED_ITEMS: ShelterSeedItem[] = [
	{ name: 'Water bottle', unit: 'pcs', initial: 200 },
	{ name: 'Blanket', unit: 'pcs', initial: 80 },
	{ name: 'Food pack', unit: 'pcs', initial: 150 },
	{ name: 'First-aid kit', unit: 'pcs', initial: 25 }
];

/**
 * Build the `validate_doc_update` body for one shelter's database. Volunteers
 * may run intake (occupant) and dispense (stock_txn delta < 0); only managers
 * may edit config, add inventory items, restock (delta > 0), or delete.
 */
export interface SetupStep {
	label: string;
	status: 'ok' | 'skip' | 'error';
	detail?: string;
}

export interface ShelterVerifyResult {
	databases: { db: string; exists: boolean; members: unknown; error?: string }[];
	users: { name: string; roles: string[] | null; error?: string }[];
}

/**
 * Build the `validate_doc_update` body for one shelter's database. Volunteers
 * may run intake (occupant) and dispense (stock_txn delta < 0); only managers
 * may edit config, add inventory items, restock (delta > 0), or delete.
 */
export function validateDocUpdateFn(id: ShelterId): string {
	const managerRole = shelterRole(id, 'manager');
	return `function(newDoc, oldDoc, userCtx) {
  if (userCtx.roles.indexOf('_admin') !== -1) return;
  var isManager = userCtx.roles.indexOf('${managerRole}') !== -1;
  if (newDoc._deleted) {
    if (!isManager) throw({ forbidden: 'only a manager can delete' });
    return;
  }
  var t = newDoc.type;
  if (t === 'shelter_config' || t === 'inventory_item') {
    if (!isManager) throw({ forbidden: 'manager role required' });
    return;
  }
  if (t === 'stock_txn') {
    if (typeof newDoc.delta !== 'number') throw({ forbidden: 'delta must be a number' });
    if (newDoc.delta > 0 && !isManager) throw({ forbidden: 'only a manager can restock' });
    return;
  }
  if (t === 'occupant') return;
  throw({ forbidden: 'unknown document type: ' + t });
}`;
}
