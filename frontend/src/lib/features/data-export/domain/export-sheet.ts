/**
 * domain/export-sheet.ts — data-export
 *
 * Library-free description of one worksheet. `buildDashboardSheets` (and the consulate builder)
 * produce these; `writeWorkbook` is the only place that turns them into an `.xlsx`.
 */

/** A cell value. `null` is an empty cell. */
export type ExportCell = string | number | null;

export interface ExportSheet {
	/** Worksheet tab name (Excel limit: 31 chars, no `[]:*?/\`). */
	name: string;
	/** Lines above the table (shelter, range, export time), one per row, in column A. */
	heading: readonly string[];
	/** Column headers. */
	columns: readonly string[];
	/** Data rows, each the same length as `columns`. */
	rows: readonly (readonly ExportCell[])[];
}

/** Who/where/when an export belongs to — shared by every sheet's heading. */
export interface ExportMeta {
	shelterCode: string;
	/** Shelter display name; falls back to the code when unknown. */
	shelterName?: string | null;
	/** Instant of the export; rendered in Asia/Bangkok (+07). */
	exportedAt: Date;
}
