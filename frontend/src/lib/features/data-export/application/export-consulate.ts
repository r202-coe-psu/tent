import { canAccessManagerPages } from '$lib/auth/roles';
import type { AuthorContext } from '$lib/db/model';
import { peopleRepository, type Evacuee } from '$lib/features/people';
import { createAuditEntry, type AuditEntry } from '$lib/features/shared';
import {
	buildConsulateRows,
	CONSULATE_AUDIT_REASON,
	CONSULATE_SHEET_NAME,
	CONSULATE_TEXT_COLUMNS,
	consulateFileName,
	normalizeCountry,
	type ConsulateLookups
} from '../domain/consulate-export';
import { putAuditEntry } from '../data/audit.remote';
import { downloadBlob } from '../data/download';
import { writeWorkbook, type WorkbookSheet } from '../data/workbook';

export interface ExportConsulateInput {
	shelterCode: string;
	/** Country as chosen in the dialog (normalised again here). */
	country: string;
	author: AuthorContext;
	/** Roles of the current user — re-checked here (FR-2), not only at the button. */
	roles: readonly string[];
	lookups?: ConsulateLookups;
}

/** Seams for tests; defaults are the real remote implementations. */
export interface ExportConsulateDeps {
	listEvacuees: (shelterCode: string) => Promise<Evacuee[]>;
	writeAudit: (shelterCode: string, entry: AuditEntry) => Promise<void>;
	writeWorkbook: (sheets: readonly WorkbookSheet[]) => Promise<Blob>;
	download: (blob: Blob, fileName: string) => void;
	now: () => Date;
}

const defaultDeps: ExportConsulateDeps = {
	listEvacuees: (code) => peopleRepository(code).listEvacuees(),
	writeAudit: putAuditEntry,
	writeWorkbook,
	download: downloadBlob,
	now: () => new Date()
};

/** Export failure with a user-facing Thai message that names the stage that failed. */
export class ConsulateExportError extends Error {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = 'ConsulateExportError';
	}
}

export class NoConsulateRowsError extends ConsulateExportError {
	constructor() {
		super('ไม่มีรายชื่อที่ export ได้สำหรับประเทศนี้');
		this.name = 'NoConsulateRowsError';
	}
}

export class ConsulateExportForbiddenError extends ConsulateExportError {
	constructor() {
		super('ไม่มีสิทธิ์ export รายชื่อสำหรับกงสุล (เฉพาะผู้ดูแลระบบและผู้จัดการศูนย์)');
		this.name = 'ConsulateExportForbiddenError';
	}
}

async function stage<T>(message: string, fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (cause) {
		throw new ConsulateExportError(message, { cause });
	}
}

export interface ExportConsulateResult {
	fileName: string;
	rowCount: number;
}

/**
 * S5 — read fresh evacuees, build the file, write the audit, then download.
 *
 * Fail-closed (FR-42): the audit write happens BEFORE the download and its failure
 * propagates, so no file reaches the user without an audit trail. The audit holds only
 * country + row count (FR-41) — never a name or any other field of a person in the file.
 */
export async function exportConsulateList(
	input: ExportConsulateInput,
	overrides: Partial<ExportConsulateDeps> = {}
): Promise<ExportConsulateResult> {
	const deps = { ...defaultDeps, ...overrides };
	if (!canAccessManagerPages(input.roles, input.shelterCode)) {
		throw new ConsulateExportForbiddenError();
	}
	const country = normalizeCountry(input.country);
	const evacuees = await stage('อ่านรายชื่อผู้ประสบภัยไม่สำเร็จ', () =>
		deps.listEvacuees(input.shelterCode)
	);
	const table = buildConsulateRows(evacuees, country, input.lookups);
	if (table.rows.length === 0) throw new NoConsulateRowsError();

	const exportedAt = deps.now();
	const blob = await stage('สร้างไฟล์ไม่สำเร็จ', () =>
		deps.writeWorkbook([
			{
				name: CONSULATE_SHEET_NAME,
				rows: [[...table.headers], ...table.rows],
				textColumns: CONSULATE_TEXT_COLUMNS
			}
		])
	);

	const audit = createAuditEntry(
		{
			action: 'export',
			target_type: 'shelter',
			target_id: input.shelterCode,
			reason: CONSULATE_AUDIT_REASON,
			context: { country, row_count: table.rows.length }
		},
		input.author
	);
	await stage('บันทึก audit ไม่สำเร็จ จึงไม่มีการดาวน์โหลดไฟล์', () =>
		deps.writeAudit(input.shelterCode, audit)
	);

	const fileName = consulateFileName(input.shelterCode, country, exportedAt);
	deps.download(blob, fileName);
	return { fileName, rowCount: table.rows.length };
}
