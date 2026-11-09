/**
 * Public API of the `data-export` feature (CR-232, epic #1050). Cross-feature and route
 * code imports ONLY from here.
 */

// Domain
export {
	CONSULATE_EXPORT_STATUSES,
	CONSULATE_HEADERS,
	CONSULATE_SHEET_NAME,
	buildConsulateRows,
	consulateFileName,
	listExportCountries,
	type ConsulateLookups,
	type ExportCountry
} from './domain/consulate-export';

// Data — shared exceljs writer (reused by the dashboard numbers file, #1207)
export { writeWorkbook, XLSX_MIME_TYPE, type WorkbookSheet } from './data/workbook';

// Application
export {
	exportConsulateList,
	NoConsulateRowsError,
	type ExportConsulateDeps,
	type ExportConsulateInput,
	type ExportConsulateResult
} from './application/export-consulate';
export { dataExportKeys, useExportCountries, useConsulateExport } from './application/queries';

// UI
export { default as ConsulateExportButton } from './ui/consulate-export-button.svelte';
export { default as ConsulateExportDialog } from './ui/consulate-export-dialog.svelte';
