/**
 * The backfill script against an in-memory CouchDB served over HTTP (CR-243 FR-31..FR-33, AC-8):
 * `--write --confirm` only queues `mode = backfill` jobs, `--dry-run` writes nothing.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { FakeCouchServer } from '../src/lib/server/test-support/fake-couch-multi-db';
import { createShelterCloseJobStore } from '../src/lib/server/shelter-close-job';
import { BACKFILL_CREATED_BY } from '../src/lib/server/closed-shelter-checkout-backfill';

let couch: FakeCouchServer;
let server: Server;
let port: number;

beforeAll(async () => {
	server = createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on('data', (c) => chunks.push(c));
		req.on('end', async () => {
			const raw = Buffer.concat(chunks).toString('utf8');
			const out = await couch.req(
				req.method ?? 'GET',
				req.url ?? '/',
				raw ? JSON.parse(raw) : undefined
			);
			res.statusCode = out.status;
			res.setHeader('content-type', 'application/json');
			res.end(JSON.stringify(out.data));
		});
	});
	await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
	port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

function seedShelter(id: string, code: string, status: string, closed_at?: string) {
	couch.put('registry', {
		_id: `shelter:${id}`,
		type: 'shelter',
		code,
		name: code,
		operation_status: status,
		...(closed_at ? { closed_at } : {})
	});
}
function seedEvacuee(code: string, id: string, status: string) {
	couch.put(`shelter_${code.toLowerCase()}`, {
		_id: id,
		type: 'evacuee',
		schema_v: 5,
		shelter_code: code,
		household_id: null,
		current_stay: { status, zone: 'Z1', since: '2026-10-01T00:00:00.000Z' }
	});
}

beforeEach(() => {
	couch = new FakeCouchServer();
	couch.createDb('registry');
	seedShelter('1', 'SH001', 'closed', '2026-10-01T00:00:00.000Z');
	seedShelter('2', 'SH002', 'closed', '2026-10-02T00:00:00.000Z');
	seedShelter('3', 'SH003', 'active');
	for (const code of ['SH001', 'SH002', 'SH003']) couch.createDb(`shelter_${code.toLowerCase()}`);
	seedEvacuee('SH001', 'evacuee:A1', 'active');
	seedEvacuee('SH001', 'evacuee:A2', 'pre_registered');
	seedEvacuee('SH002', 'evacuee:B1', 'active');
	seedEvacuee('SH003', 'evacuee:C1', 'active');
});

function run(args: string[]): Promise<{ code: number; out: string }> {
	return new Promise((done) => {
		execFile(
			resolve(process.cwd(), 'node_modules/.bin/tsx'),
			[
				'--tsconfig',
				'.svelte-kit/tsconfig.json',
				'scripts/migrate-closed-shelter-checkout.ts',
				...args
			],
			{
				cwd: process.cwd(),
				env: { ...process.env, COUCHDB_ADMIN_URL: `http://admin:pw@127.0.0.1:${port}` },
				timeout: 90_000
			},
			(err, stdout, stderr) => {
				const code = err ? ((err as { code?: number }).code ?? 1) : 0;
				done({ code: typeof code === 'number' ? code : 1, out: `${stdout}${stderr}` });
			}
		);
	});
}

const snapshot = () =>
	JSON.stringify(
		[...couch.dbs.entries()].map(([name, docs]) => [
			name,
			[...docs.values()].map((d) => [d._id, d._rev])
		])
	);
const jobs = () => couch.byType('central_ops', 'shelter_close_job');

describe('migrate-closed-shelter-checkout', { timeout: 120_000 }, () => {
	it('--dry-run counts synchronously and writes nothing, not even central_ops (FR-32)', async () => {
		const before = snapshot();
		const { code, out } = await run(['--dry-run']);
		expect(code).toBe(0);
		expect(out).toContain('would close out 2');
		expect(out).toContain('Total that would be closed out: 3');
		expect(snapshot()).toBe(before);
		expect(couch.dbs.has('central_ops')).toBe(false);
		expect(couch.log.every((l) => l.method === 'GET' || l.path.includes('_all_docs'))).toBe(true);
	});

	it('defaults to the dry run', async () => {
		const before = snapshot();
		expect((await run([])).code).toBe(0);
		expect(snapshot()).toBe(before);
	});

	it('--write --confirm queues one backfill job per closed shelter and does not wait (FR-31, AC-8)', async () => {
		const { code, out } = await run(['--write', '--confirm']);
		expect(code).toBe(0);
		expect(jobs()).toHaveLength(2);
		for (const job of jobs()) {
			expect(job).toMatchObject({
				mode: 'backfill',
				requested_by: BACKFILL_CREATED_BY,
				status: 'queued',
				closed: false
			});
			expect(out).toContain(`job_id=${job.job_ulid}`);
		}
		expect(
			jobs()
				.map((j) => j.shelter_code)
				.sort()
		).toEqual(['SH001', 'SH002']);
		expect(out).toContain('Queued 2 job(s), skipped 0');

		// the script processed nobody and left the registry alone (FR-21, CR-219 FR-29)
		expect(couch.byType('shelter_sh001', 'movement')).toHaveLength(0);
		expect(couch.get('shelter_sh001', 'evacuee:A1')!.current_stay).toMatchObject({
			status: 'active'
		});
		expect(couch.get('registry', 'shelter:1')).toMatchObject({
			operation_status: 'closed',
			closed_at: '2026-10-01T00:00:00.000Z'
		});
		expect(couch.get('registry', 'shelter:3')).toMatchObject({ operation_status: 'active' });
		expect(couch.bulkLog).toHaveLength(0);
		// open shelter got no job
		expect(jobs().some((j) => j.shelter_code === 'SH003')).toBe(false);
	});

	it('skips a shelter that already has an active job and a re-run adds nothing (FR-31, FR-33)', async () => {
		const store = createShelterCloseJobStore({ couchReq: couch.req });
		await store.createJob({
			shelter_code: 'SH002',
			mode: 'close',
			requested_by: 'mgr',
			preview: { by_status: { active: 1 }, total: 1 }
		});
		const first = await run(['--write', '--confirm']);
		expect(first.out).toContain('skipped: job');
		expect(first.out).toContain('Queued 1 job(s), skipped 1');
		expect(jobs()).toHaveLength(2);
		const second = await run(['--write', '--confirm']);
		expect(second.out).toContain('Queued 0 job(s), skipped 2');
		expect(jobs()).toHaveLength(2);
	});

	it('--shelter limits the run to one shelter (FR-33)', async () => {
		const { code } = await run(['--shelter', 'sh002', '--write', '--confirm']);
		expect(code).toBe(0);
		expect(jobs().map((j) => j.shelter_code)).toEqual(['SH002']);
	});

	it('--shelter for a shelter that is not closed exits non-zero and writes nothing', async () => {
		const before = snapshot();
		const { code, out } = await run(['--shelter', 'SH003', '--write', '--confirm']);
		expect(code).not.toBe(0);
		expect(out).toContain('not closed');
		expect(snapshot()).toBe(before);
	});

	it('--write without --confirm is refused (a typo must not write to production)', async () => {
		const before = snapshot();
		const { code, out } = await run(['--write']);
		expect(code).not.toBe(0);
		expect(out).toContain('--confirm');
		expect(snapshot()).toBe(before);
	});
});
