import { describe, it, expect } from 'vitest';
import {
	createShelterImportLog,
	isShelterImportLog,
	shelterImportLogBodySchema,
	type ShelterImportLogBody
} from './import-log';

const body: ShelterImportLogBody = {
	source: 'shelter',
	filename: 'shelters.xlsx',
	imported_by: 'admin',
	total_rows: 2,
	success_count: 1,
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
		expect(doc.schema_v).toBe(1);
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
