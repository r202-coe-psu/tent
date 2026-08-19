import { describe, it, expect } from 'vitest';
import {
	createShelterImportLog,
	isShelterImportLog,
	shelterImportLogBodySchema,
	MAX_LOGGED_MESSAGE,
	MAX_LOGGED_RESULTS,
	type ShelterImportLogBody
} from './import-log';

const body: ShelterImportLogBody = {
	source: 'shelter',
	filename: 'shelters.xlsx',
	imported_by: 'admin',
	total_rows: 2,
	success_count: 1,
	updated_count: 0,
	skipped_count: 0,
	error_count: 1,
	results: [
		{ row: 1, name: 'ศูนย์ A', status: 'created', code: 'SH001' },
		{
			row: 2,
			name: null,
			status: 'validation_error',
			errors: [{ column: 'ชื่อศูนย์พักพิง', message: 'x' }]
		}
	],
	started_at: '2026-07-14T00:00:00.000Z',
	finished_at: '2026-07-14T00:00:01.000Z'
};

describe('shelter_import_log', () => {
	it('accepts a well-formed body', () => {
		expect(shelterImportLogBodySchema.safeParse(body).success).toBe(true);
	});

	it('stamps the registry envelope with a type-prefixed id', () => {
		const doc = createShelterImportLog(body, 'admin');
		expect(doc.type).toBe('shelter_import_log');
		expect(doc.schema_v).toBe(2);
		expect(doc._id.startsWith('shelter_import_log:')).toBe(true);
		expect(doc.created_by).toBe('admin');
		expect(doc.created_at).toBe(doc.updated_at);
		// registry docs carry no shelter_code
		expect('shelter_code' in doc).toBe(false);
		expect(isShelterImportLog(doc)).toBe(true);
	});

	it('guard rejects other doc types', () => {
		expect(isShelterImportLog({ type: 'shelter' })).toBe(false);
		expect(isShelterImportLog(null)).toBe(false);
	});
});

describe('createShelterImportLog — bounded row detail', () => {
	it('caps how many per-row results the doc carries (counters stay exact)', () => {
		const many = Array.from({ length: MAX_LOGGED_RESULTS + 25 }, (_, i) => ({
			row: i + 1,
			name: `ศูนย์ ${i + 1}`,
			status: 'created' as const,
			code: `SH${i + 1}`
		}));
		const doc = createShelterImportLog(
			{
				...body,
				total_rows: many.length,
				success_count: many.length,
				error_count: 0,
				results: many
			},
			'admin'
		);
		expect(doc.results).toHaveLength(MAX_LOGGED_RESULTS);
		expect(doc.total_rows).toBe(many.length);
		expect(doc.success_count).toBe(many.length);
	});

	it('truncates a long error message so cell text does not land in the audit doc whole', () => {
		const doc = createShelterImportLog(
			{
				...body,
				results: [
					{
						row: 1,
						name: 'ศูนย์ A',
						status: 'validation_error',
						errors: [
							{ column: 'ที่อยู่ตามเขตการปกครอง', message: 'ก'.repeat(MAX_LOGGED_MESSAGE + 50) }
						]
					}
				]
			},
			'admin'
		);
		const message = doc.results[0].errors?.[0].message ?? '';
		expect(message.length).toBe(MAX_LOGGED_MESSAGE + 1); // + the ellipsis
		expect(message.endsWith('…')).toBe(true);
	});
});
