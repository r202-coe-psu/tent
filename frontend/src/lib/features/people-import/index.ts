/**
 * Public API of the `people-import` feature (CR-071 slice A / T-72).
 * Cross-feature and route code imports ONLY from here. Inner layers
 * (domain/data/application/ui) are private — reaching into them from outside is
 * an ESLint error.
 */

// Domain — column contract, row validation, duplicate rules, log doc
export {
	APP_ONLY_FIELDS,
	CARD_TYPE_CHOICES,
	COLUMNS,
	COLUMN_HEADERS,
	CSV_COLUMNS,
	CSV_SHEET,
	GENDER_CHOICES,
	H,
	HOUSEHOLD_SHEETS,
	MAIN_SHEET_NAME,
	ADDRESS_SHEET_NAME,
	MEMBER_SHEET_NAME,
	MEMBER_COLUMNS,
	MASTER_COLUMNS,
	MULTI_SEPARATOR,
	FIELD_SEPARATOR,
	PET_SPECIES_CHOICES,
	RELIGION_CHOICES,
	ROLE_CHOICES,
	SHEETS,
	SPECIAL_NEED_CHOICES,
	VEHICLE_TYPE_CHOICES,
	isTextColumn,
	normalizeHeader,
	type ColumnDef,
	type ColumnKind,
	type EnumChoice,
	type MasterColumn,
	type SheetDef
} from './domain/columns';
export {
	buildMasterLookup,
	emptyLookups,
	orphanMemberRows,
	validateRow,
	validateWorkbook,
	type HouseholdImportPayload,
	type Lookups,
	type MasterLookup,
	type MemberPayload,
	type ParsedWorkbook,
	type RawRow,
	type RawSheetRow,
	type RowFieldError,
	type RowStatus,
	type RowValidation
} from './domain/import-row';
export {
	existingPersonKey,
	findExistingDuplicates,
	findInFileDuplicates,
	normalizeIdNumber,
	normalizeName,
	personDuplicateKey,
	type DuplicateMatch,
	type DuplicatePerson,
	type ExistingPerson,
	type InFileClash
} from './domain/duplicates';
export {
	createPeopleImportLog,
	isPeopleImportLog,
	peopleImportLogBodySchema,
	PEOPLE_IMPORT_LOG_TYPE,
	PEOPLE_IMPORT_LOG_SCHEMA_V,
	type ImportRowResult,
	type PeopleImportLog,
	type PeopleImportLogBody
} from './domain/import-log';

// Data — template generation, parsing, persistence
export {
	buildPeopleTemplateBlob,
	buildPeopleCsvTemplateBlob,
	type TemplateMasters,
	type TemplateOptions
} from './data/template';
export { isCsvFile, parseCsvText, parsePeopleWorkbook } from './data/parse';
export { importLogDb, listImportLogs, writeImportLog } from './data/import-log.remote';

// Application — TanStack Query hooks + live-sync
export {
	peopleImportKeys,
	useImportLogs,
	useImportPeople,
	startPeopleImportLiveQuery,
	type ImportPeopleInput
} from './application/queries';

// UI
export { default as PeopleImportPage } from './ui/people-import-page.svelte';
