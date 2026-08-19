/**
 * Public API of the `shelter-import` feature (CR-039). Cross-feature and route
 * code imports ONLY from here. Inner layers (domain/data/application/ui) are
 * private — reaching into them from outside is an ESLint error.
 */

// Domain — column contract, row validation, log doc
export {
	APP_ONLY_FIELDS,
	COLUMNS,
	COLUMN_HEADERS,
	ZONE_COLUMNS,
	SHEETS,
	SHELTER_SHEETS,
	MAIN_SHEET_NAME,
	ZONE_SHEET_NAME,
	MASTER_COLUMNS,
	MULTI_SEPARATOR,
	FIELD_SEPARATOR,
	H,
	OPERATION_STATUS_CHOICES,
	PROJECT_LEVEL_CHOICES,
	AREA_TYPE_CHOICES,
	POWER_SOURCE_CHOICES,
	WATER_SOURCE_CHOICES,
	COMMUNICATION_CHOICES,
	COMMUNICATION_COLUMNS,
	isTextColumn,
	SUB_STORAGE_TYPE_CHOICES,
	ZONE_TYPE_CHOICES,
	ZONE_STATUS_CHOICES,
	BOOLEAN_CHOICES,
	PET_CONDITION_COLUMNS,
	PET_POLICY_CHOICES,
	LUGGAGE_LIMITATION_CHOICES,
	LUGGAGE_RULE_CHOICES,
	PARKING_AVAILABILITY_CHOICES,
	PARKING_RULE_CHOICES,
	VEHICLE_TYPE_CHOICES,
	type ColumnDef,
	type ColumnKind,
	type SheetDef,
	type EnumChoice,
	type MasterColumn
} from './domain/columns';
export {
	buildMasterLookup,
	emptyLookups,
	orphanZoneRows,
	validateRow,
	validateRows,
	validateWorkbook,
	type Lookups,
	type MasterLookup,
	type ParsedWorkbook,
	type RawRow,
	type RawSheetRow,
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
