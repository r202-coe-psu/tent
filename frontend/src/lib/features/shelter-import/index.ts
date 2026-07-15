/**
 * Public API of the `shelter-import` feature (CR-039). Cross-feature and route
 * code imports ONLY from here. Inner layers (domain/data/application/ui) are
 * private — reaching into them from outside is an ESLint error.
 */

// Domain — column contract, row validation, log doc
export {
	COLUMNS,
	COLUMN_HEADERS,
	H,
	OPERATION_STATUS_CHOICES,
	PROJECT_LEVEL_CHOICES,
	AREA_TYPE_CHOICES,
	type ColumnDef,
	type ColumnKind,
	type EnumChoice,
	type MasterColumn
} from './domain/columns';
export {
	buildMasterLookup,
	emptyLookups,
	validateRow,
	validateRows,
	type Lookups,
	type MasterLookup,
	type RawRow,
	type RowFieldError,
	type RowStatus,
	type RowValidation,
	type ShelterInput
} from './domain/import-row';
export {
	createShelterImportLog,
	isShelterImportLog,
	shelterImportLogBodySchema,
	SHELTER_IMPORT_LOG_TYPE,
	SHELTER_IMPORT_LOG_SCHEMA_V,
	type ImportRowResult,
	type ShelterImportLog,
	type ShelterImportLogBody
} from './domain/import-log';

// Data — template generation, parsing, persistence
export { buildShelterTemplateBlob, type TemplateMasters } from './data/template';
export { parseShelterWorkbook } from './data/parse';
export { listImportLogs, writeImportLog, IMPORT_LOG_REGISTRY_DB } from './data/import-log.remote';

// Application — TanStack Query hooks + live-sync
export {
	shelterImportKeys,
	useImportLogs,
	useImportShelters,
	startShelterImportLiveQuery,
	type ImportSheltersInput
} from './application/queries';

// UI
export { default as ShelterImportPage } from './ui/shelter-import-page.svelte';
