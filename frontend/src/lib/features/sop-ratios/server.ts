/**
 * Server-safe SOP ratio contract.
 *
 * Server helpers and Node scripts import this entry point instead of the feature
 * barrel so they do not pull Svelte/TanStack modules into the server bundle.
 */
export {
	createInitialProfile,
	SOP_MASTER_SCHEMA_VERSION,
	sopMasterSchema,
	SOP_RATIO_KEYS,
	SOP_RATIO_KIND,
	type SopRatioKey
} from './domain/sop-ratio';
export { validRatios } from './domain/sop-ratio.fixture';
