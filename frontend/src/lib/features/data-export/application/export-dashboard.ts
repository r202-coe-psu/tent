/**
 * application/export-dashboard.ts — data-export (CR-232 §C)
 *
 * Build → write → download. No audit: the file has no per-person data (FR-54).
 */
import { buildDashboardSheets, type DashboardExportData } from '../domain/dashboard-sheets';
import { fileStamp } from '../domain/export-time';
import type { ExportSheet } from '../domain/export-sheet';
import { downloadBlob } from '../data/download';
import { writeWorkbook, type WorkbookSheet } from '../data/workbook';

/**
 * Map a sheet onto the shared writer (FR-7): heading lines, a blank row, then the column titles
 * and data. Everything above the data rows is the "header" (bold + frozen).
 */
export function toWorkbookSheet(sheet: ExportSheet): WorkbookSheet {
	const top = sheet.heading.length > 0 ? [...sheet.heading.map((h) => [h]), []] : [];
	return {
		name: sheet.name,
		rows: [...top, [...sheet.columns], ...sheet.rows],
		headerRows: top.length + 1
	};
}

export function dashboardFileName(shelterCode: string, at: Date): string {
	return `dashboard-${shelterCode}-${fileStamp(at)}.xlsx`;
}

export async function exportDashboard(
	data: DashboardExportData,
	shelter: { code: string; name?: string | null },
	now: Date = new Date()
): Promise<string> {
	const sheets = buildDashboardSheets(data, {
		shelterCode: shelter.code,
		shelterName: shelter.name,
		exportedAt: now
	});
	const blob = await writeWorkbook(sheets.map(toWorkbookSheet));
	const filename = dashboardFileName(shelter.code, now);
	downloadBlob(blob, filename);
	return filename;
}
