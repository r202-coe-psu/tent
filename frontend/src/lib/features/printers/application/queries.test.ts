import { describe, expect, it } from 'vitest';
import { printerKeys } from './queries';

// The hooks are thin createQuery/createMutation wrappers over data/printers.api.ts (tested there)
// and domain/print-job-status.ts (tested there); only the cache keys are worth pinning.
describe('printerKeys', () => {
	it('scopes the printer list by shelter and the job status by job id', () => {
		expect(printerKeys.list('SH001')).toEqual(['printers', 'list', 'SH001']);
		expect(printerKeys.job('print_job:01J')).toEqual(['printers', 'job', 'print_job:01J']);
	});

	it('nests every key under the feature root so one invalidation covers all', () => {
		expect(printerKeys.all).toEqual(['printers']);
	});
});
