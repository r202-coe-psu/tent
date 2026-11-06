/**
 * application/export-dashboard.ts — data-export (CR-232 §C)
 *
 * Build → write → download. No audit: the file has no per-person data (FR-54).
 */
import { buildDashboardSheets, type DashboardExportData } from '../domain/dashboard-sheets';
import { fileStamp } from '../domain/export-time';
import { downloadBlob } from '../data/download-blob';
import { writeWorkbook } from '../data/write-workbook';

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
	const blob = await writeWorkbook(sheets);
	const filename = dashboardFileName(shelter.code, now);
	downloadBlob(filename, blob);
	return filename;
}
