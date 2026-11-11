import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './+server';
import type { RequestEvent } from './$types';
import {
	compactDevicesDb,
	listRegisteredShelters,
	readHousekeepingState,
	writeHousekeepingState
} from '$lib/server/printers/print-device.repo';
import { printJobStoreFor } from '$lib/server/printers/print-job.service-store';

const env = vi.hoisted(() => ({
	PRINT_HOUSEKEEPING_TOKEN: 'housekeeping-secret' as string | undefined
}));

vi.mock('$env/dynamic/private', () => ({ env }));
vi.mock('$lib/server/printers/print-device.repo', () => ({
	listRegisteredShelters: vi.fn(),
	compactDevicesDb: vi.fn(),
	readHousekeepingState: vi.fn(),
	writeHousekeepingState: vi.fn()
}));
vi.mock('$lib/server/printers/print-job.service-store', () => ({ printJobStoreFor: vi.fn() }));

describe('POST /api/internal/printers/housekeeping', () => {
	const jobStore = {
		findJobs: vi.fn(),
		put: vi.fn(),
		findFinishedBefore: vi.fn(),
		purge: vi.fn(),
		compact: vi.fn()
	};

	beforeEach(() => {
		vi.resetAllMocks();
		env.PRINT_HOUSEKEEPING_TOKEN = 'housekeeping-secret';
		vi.mocked(printJobStoreFor).mockReturnValue(
			jobStore as unknown as ReturnType<typeof printJobStoreFor>
		);
		vi.mocked(listRegisteredShelters).mockResolvedValue(['SH001']);
		vi.mocked(readHousekeepingState).mockResolvedValue(null);
		vi.mocked(writeHousekeepingState).mockResolvedValue();
		vi.mocked(compactDevicesDb).mockResolvedValue();
		jobStore.findJobs.mockResolvedValue([]);
		jobStore.findFinishedBefore.mockResolvedValue([]);
		jobStore.compact.mockResolvedValue(undefined);
	});

	function request(authorization?: string): RequestEvent {
		return {
			request: new Request('http://localhost/api/internal/printers/housekeeping', {
				method: 'POST',
				headers: authorization === undefined ? {} : { authorization }
			})
		} as unknown as RequestEvent;
	}

	const touchedNothing = () => {
		expect(listRegisteredShelters).not.toHaveBeenCalled();
		expect(readHousekeepingState).not.toHaveBeenCalled();
		expect(writeHousekeepingState).not.toHaveBeenCalled();
		expect(printJobStoreFor).not.toHaveBeenCalled();
	};

	it('runs housekeeping for the registered shelters and answers the counts, uncached', async () => {
		const response = await POST(request('Bearer housekeeping-secret'));

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(await response.json()).toEqual({ swept: 0, purged: 0, compacted: 2, errors: 0 });
		expect(printJobStoreFor).toHaveBeenCalledWith('SH001');
		expect(writeHousekeepingState).toHaveBeenCalledTimes(1);
	});

	it.each([
		['no Authorization header', undefined],
		['a wrong token', 'Bearer nope'],
		['a token of the right length but different', 'Bearer housekeeping-secreT'],
		['the token without the Bearer scheme', 'housekeeping-secret'],
		['an empty bearer token', 'Bearer ']
	])('answers 401 and does nothing with %s', async (_l, authorization) => {
		const response = await POST(request(authorization));

		expect(response.status).toBe(401);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect((await response.json()).error.code).toBe('UNAUTHORIZED');
		touchedNothing();
	});

	it.each([
		['unset', undefined],
		['empty', '']
	])(
		'answers 503 and does nothing when PRINT_HOUSEKEEPING_TOKEN is %s, even for a matching header',
		async (_l, token) => {
			env.PRINT_HOUSEKEEPING_TOKEN = token;

			const response = await POST(request('Bearer '));

			expect(response.status).toBe(503);
			expect(response.headers.get('cache-control')).toBe('no-store');
			expect((await response.json()).error.code).toBe('DEPENDENCY_UNAVAILABLE');
			touchedNothing();
		}
	);

	it('still answers 200 with the error count when a shelter fails', async () => {
		jobStore.findJobs.mockRejectedValue(new Error('couch down'));

		const response = await POST(request('Bearer housekeeping-secret'));

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ errors: 1 });
	});
});
