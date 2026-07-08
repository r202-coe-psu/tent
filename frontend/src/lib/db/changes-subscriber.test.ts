import { describe, expect, it } from 'vitest';
import { classifyChangesPollStatus } from './changes-subscriber';

describe('classifyChangesPollStatus', () => {
	it('treats 404 as a missing database (fresh install)', () => {
		expect(classifyChangesPollStatus(404)).toBe('missing_db');
	});

	it('treats 2xx as ok', () => {
		expect(classifyChangesPollStatus(200)).toBe('ok');
	});

	it('treats 5xx as a server error', () => {
		expect(classifyChangesPollStatus(500)).toBe('error');
	});

	it('treats auth failures separately', () => {
		expect(classifyChangesPollStatus(401)).toBe('auth_error');
		expect(classifyChangesPollStatus(403)).toBe('auth_error');
	});
});
