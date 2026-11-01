import { beforeEach, describe, expect, it, vi } from 'vitest';

const userRaw = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/couch-as-user', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/couch-as-user')>()),
	userRaw
}));

import { CouchUserError } from '$lib/server/couch-as-user';
import { PrintDependencyError, type PrintDeviceDoc } from './device-credentials';
import { createPrintJob } from './print-jobs.server';
import { userJobStore } from './print-job.user-store';
import type { PrintJobDoc } from './print-queue.server';

type Reply = { status: number; data?: unknown };

let calls: { cookie: string | null; path: string; method: string; body: unknown }[];
let replies: Reply[];

function reply(...next: Reply[]) {
	replies.push(...next);
}

const COOKIE = 'AuthSession=abc';

beforeEach(() => {
	calls = [];
	replies = [];
	userRaw.mockReset();
	userRaw.mockImplementation(
		(cookie: string | null, path: string, method: string, body?: unknown) => {
			calls.push({ cookie, path, method, body });
			const next = replies.shift() ?? { status: 500 };
			return Promise.resolve({ status: next.status, data: next.data ?? null });
		}
	);
});

function job(overrides: Partial<PrintJobDoc> = {}): PrintJobDoc {
	return {
		_id: 'print_job:01',
		type: 'print_job',
		schema_v: 1,
		shelter_code: 'SH01',
		printer_id: 'print_device:pi-1',
		status: 'pending',
		label_count: 2,
		source: 'walk_in',
		created_at: '2026-11-01T00:00:00.000Z',
		created_by: 'staff',
		expires_at: '2026-11-01T00:02:00.000Z',
		claimed_at: null,
		lease_until: null,
		finished_at: null,
		printed: 0,
		error_code: null,
		_attachments: {
			'label-000.png': { content_type: 'image/png', data: 'AAAA' },
			'label-001.png': { content_type: 'image/png', data: 'BBBB' }
		},
		...overrides
	};
}

describe('user job store: createJob', () => {
	it('PUTs the doc with inline attachments into the shelter db as the caller', async () => {
		reply({ status: 201, data: { ok: true } });

		await userJobStore(COOKIE, 'SH01').createJob(job());

		expect(calls).toEqual([
			{ cookie: COOKIE, path: '/printing_sh01/print_job%3A01', method: 'PUT', body: job() }
		]);
	});

	it('accepts 202 (write quorum not yet met)', async () => {
		reply({ status: 202 });
		await expect(userJobStore(COOKIE, 'SH01').createJob(job())).resolves.toBeUndefined();
	});

	it('routes to the db of the shelter it was built for', async () => {
		reply({ status: 201 });
		await userJobStore(COOKIE, 'ab2').createJob(job());
		expect(calls[0]?.path).toBe('/printing_ab2/print_job%3A01');
	});

	it('treats an id collision (409) as a dependency failure, like the admin adapter did', async () => {
		reply({ status: 409 });
		await expect(userJobStore(COOKIE, 'SH01').createJob(job())).rejects.toBeInstanceOf(
			PrintDependencyError
		);
	});

	it('lets CouchDB permission errors reach the route (401/403 mapping)', async () => {
		userRaw.mockRejectedValueOnce(new CouchUserError('FORBIDDEN', 'Not permitted'));
		await expect(userJobStore(COOKIE, 'SH01').createJob(job())).rejects.toBeInstanceOf(
			CouchUserError
		);
	});

	it('stores a queued job whose labels are named label-000.png, label-001.png as image/png', async () => {
		reply({ status: 201 });
		const device = {
			_id: 'print_device:pi-1',
			status: 'active',
			shelter_code: 'SH01',
			last_seen_at: '2026-11-01T00:00:00.000Z',
			queue_state: 'ready'
		} as PrintDeviceDoc;

		await createPrintJob(
			{
				store: userJobStore(COOKIE, 'SH01'),
				devices: { getDevice: () => Promise.resolve(device) },
				newId: () => 'JOB1'
			},
			{ name: 'staff', assertShelterAccess: () => Promise.resolve() },
			{ printer_id: 'print_device:pi-1', source: 'walk_in', labels: ['AAAA', 'BBBB'] },
			new Date('2026-11-01T00:00:10.000Z')
		);

		expect((calls[0]?.body as PrintJobDoc)._attachments).toEqual({
			'label-000.png': { content_type: 'image/png', data: 'AAAA' },
			'label-001.png': { content_type: 'image/png', data: 'BBBB' }
		});
		expect(calls[0]?.path).toBe('/printing_sh01/print_job%3AJOB1');
	});
});

describe('user job store: get', () => {
	it('reads the job as the caller', async () => {
		reply({ status: 200, data: job() });

		const found = await userJobStore(COOKIE, 'SH01').get('print_job:01');

		expect(found?._id).toBe('print_job:01');
		expect(calls).toEqual([
			{ cookie: COOKIE, path: '/printing_sh01/print_job%3A01', method: 'GET', body: undefined }
		]);
	});

	it('returns null for a missing job (or missing db)', async () => {
		reply({ status: 404 });
		expect(await userJobStore(COOKIE, 'SH01').get('print_job:nope')).toBeNull();
	});

	it('lets an expired session error reach the route', async () => {
		userRaw.mockRejectedValueOnce(new CouchUserError('UNAUTHENTICATED', 'Authentication required'));
		await expect(userJobStore(null, 'SH01').get('print_job:01')).rejects.toMatchObject({
			code: 'UNAUTHENTICATED'
		});
	});
});
