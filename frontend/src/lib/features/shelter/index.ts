/**
 * Public API of the `shelter` demo feature.
 * Routes import ONLY from here — never reach into domain/data/application/ui.
 */

// Domain
export {
	SHELTER_IDS,
	shelterDbName,
	shelterRole,
	parseAccessibleShelters,
	type ShelterId,
	type ShelterRole,
	type ShelterAccess
} from './domain/shelter';

// Application — sync + query hooks
export { startShelterSync } from './application/shelter-sync';
export {
	useShelterConfig,
	useOccupants,
	useInventory,
	useSaveConfig,
	useCheckIn,
	useCheckOut,
	useAddItem,
	useDispense,
	useRestock,
	ShelterFullError,
	shelterKeys,
	type InventoryRow
} from './application/queries';

// UI
export { default as CapacityCard } from './ui/capacity-card.svelte';
export { default as IntakeForm } from './ui/intake-form.svelte';
export { default as OccupantList } from './ui/occupant-list.svelte';
export { default as InventoryPanel } from './ui/inventory-panel.svelte';

// Admin setup (client wrappers + seed metadata for display)
export { setupShelters, teardownShelters, verifyShelters } from './data/shelter.admin';
export {
	SHELTER_SEED_USERS,
	SHELTER_SEED_CONFIG,
	type SetupStep,
	type ShelterVerifyResult,
	type ShelterSeedUser
} from './data/shelter.seed';

// Data contract (for DI/testing; concrete Pouch impl stays internal)
export type { ShelterRepository } from './data/shelter.repository';
