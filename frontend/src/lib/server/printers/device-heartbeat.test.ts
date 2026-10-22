import { describe, expect, it, vi } from 'vitest';
import type { PrintDeviceDoc } from './device-credentials';
import { recordHeartbeat } from './device-heartbeat';

const device = (overrides: Partial<PrintDeviceDoc> = {}): PrintDeviceDoc => ({
	_id: 'print_device:printer-sh001-reg1',
	_rev: '3-c',
	type: 'print_device',
	schema_v: 1,
	device_id: 'printer-sh001-reg1',
	name: 'จุดลงทะเบียน 1',
	shelter_code: 'SH001',
	station: null,
	host_kind: 'standalone',
	secret_hash: 'abc',
	secret_prefix: 'sk_print_01234567',
	status: 'active',
	last_seen_at: '2026-10-22T03:00:00.000Z',
	queue_state: 'ready',
	agent_version: '0.1.0',
	created_at: '2026-10-22T00:00:00.000Z',
	updated_at: '2026-10-22T00:00:00.000Z',
	created_by: 'sa-user',
	...overrides
});

const fakeRepo = (
	result: { ok: true; rev: string } | { conflict: true } = { ok: true, rev: '4-d' }
) => ({
	updateDevice: vi.fn(async () => result)
});

describe('recordHeartbeat', () => {
	it('writes last_seen_at and queue_state when the device has never been seen', async () => {
		const repo = fakeRepo();
		await recordHeartbeat(repo, device({ last_seen_at: null }), {
			queue_state: 'ready',
			now: new Date('2026-10-22T03:00:05.000Z')
		});
		expect(repo.updateDevice).toHaveBeenCalledTimes(1);
		expect(repo.updateDevice).toHaveBeenCalledWith(
			expect.objectContaining({
				_id: 'print_device:printer-sh001-reg1',
				_rev: '3-c',
				last_seen_at: '2026-10-22T03:00:05.000Z',
				queue_state: 'ready'
			})
		);
	});

	it('does not write when seen less than 20 s ago and nothing changed', async () => {
		const repo = fakeRepo();
		await recordHeartbeat(repo, device(), {
			queue_state: 'ready',
			now: new Date('2026-10-22T03:00:19.999Z')
		});
		expect(repo.updateDevice).not.toHaveBeenCalled();
	});

	it('writes once 20 s have passed since last_seen_at', async () => {
		const repo = fakeRepo();
		await recordHeartbeat(repo, device(), {
			queue_state: 'ready',
			now: new Date('2026-10-22T03:00:20.000Z')
		});
		expect(repo.updateDevice).toHaveBeenCalledWith(
			expect.objectContaining({ last_seen_at: '2026-10-22T03:00:20.000Z' })
		);
	});

	it('writes immediately when queue_state changed', async () => {
		const repo = fakeRepo();
		await recordHeartbeat(repo, device(), {
			queue_state: 'disabled',
			now: new Date('2026-10-22T03:00:01.000Z')
		});
		expect(repo.updateDevice).toHaveBeenCalledWith(
			expect.objectContaining({ queue_state: 'disabled' })
		);
	});

	it('writes immediately when agent_version changed and stores the new version', async () => {
		const repo = fakeRepo();
		await recordHeartbeat(repo, device(), {
			queue_state: 'ready',
			agent_version: '0.2.0',
			now: new Date('2026-10-22T03:00:01.000Z')
		});
		expect(repo.updateDevice).toHaveBeenCalledWith(
			expect.objectContaining({ agent_version: '0.2.0' })
		);
	});

	it('keeps the stored agent_version when the heartbeat carries none', async () => {
		const repo = fakeRepo();
		await recordHeartbeat(repo, device(), {
			queue_state: 'ready',
			now: new Date('2026-10-22T03:00:30.000Z')
		});
		expect(repo.updateDevice).toHaveBeenCalledWith(
			expect.objectContaining({ agent_version: '0.1.0' })
		);
	});

	it('writes when forced even though nothing changed', async () => {
		const repo = fakeRepo();
		await recordHeartbeat(repo, device(), {
			queue_state: 'ready',
			agent_version: '0.1.0',
			now: new Date('2026-10-22T03:00:01.000Z'),
			force: true
		});
		expect(repo.updateDevice).toHaveBeenCalledTimes(1);
	});

	it('swallows a write conflict so the next poll retries', async () => {
		const repo = fakeRepo({ conflict: true });
		await expect(
			recordHeartbeat(repo, device({ last_seen_at: null }), {
				queue_state: 'ready',
				now: new Date('2026-10-22T03:00:05.000Z')
			})
		).resolves.toBeUndefined();
	});
});
