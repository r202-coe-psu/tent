import { beforeEach, describe, expect, it, vi } from 'vitest';

import { adminFetch, adminRaw } from '$lib/server/couch-admin';
import {
	ScannerConflictError,
	ScannerDependencyError,
	ScannerDeviceNotFoundError
} from './device-credentials';
import { ScannerDeviceRepository } from './device-repository';
import {
	StaffPinNotSetError,
	StaffPinUnavailableError,
	type StaffPinSecret,
	type StaffPinSecretInput,
	type StaffPinSecretStore
} from './staff-pin-store';

vi.mock('$lib/server/couch-admin', () => ({
	adminFetch: vi.fn(),
	adminRaw: vi.fn()
}));

/** In-memory stand-in for the admin-only `scanner_secrets` DB. */
class FakeSecretStore {
	docs = new Map<string, StaffPinSecret>();
	private revs = 0;
	get = vi.fn(async (deviceId: string) => this.docs.get(deviceId) ?? null);
	put = vi.fn(async (input: StaffPinSecretInput, rev: string | null) => {
		const current = this.docs.get(input.device_id);
		if ((current?._rev ?? null) !== rev) throw new ScannerConflictError('stale');
		this.revs += 1;
		const doc: StaffPinSecret = {
			_id: `staff_pin:${input.device_id}`,
			_rev: `${this.revs}-s`,
			type: 'scanner_staff_pin',
			schema_v: 1,
			...input
		};
		this.docs.set(input.device_id, doc);
		return doc;
	});
	remove = vi.fn(async (deviceId: string, rev?: string) => {
		const current = this.docs.get(deviceId);
		if (!current) return;
		if (rev && current._rev !== rev) throw new ScannerConflictError('stale');
		this.docs.delete(deviceId);
	});
}

const input = {
	device_id: 'kiosk-sh001-01',
	name: 'จุดคัดกรอง 1',
	shelter_code: 'SH001',
	station_name: 'โต๊ะ 1',
	status: 'active' as const,
	screen_type: 'compact' as const
};

const v1Doc = {
	_id: 'scanner_device:kiosk-sh001-01',
	_rev: '3-abc',
	type: 'scanner_device',
	schema_v: 1,
	created_at: '2026-09-22T00:00:00Z',
	updated_at: '2026-09-22T00:00:00Z',
	created_by: 'sa-user',
	...input,
	secret_hash: 'a'.repeat(64),
	secret_prefix: 'sk_scan_aaaaaaaa...',
	last_seen_at: null
};

const v2Doc = {
	...v1Doc,
	schema_v: 2,
	staff_pin_set: true,
	staff_pin_is_default: true,
	staff_pin_updated_at: '2026-10-08T00:00:00Z',
	staff_pin_updated_by: 'sa-user'
};

function storedSecret(pin: string, overrides: Partial<StaffPinSecret> = {}): StaffPinSecret {
	return {
		_id: 'staff_pin:kiosk-sh001-01',
		_rev: '7-s',
		type: 'scanner_staff_pin',
		schema_v: 1,
		device_id: 'kiosk-sh001-01',
		pin,
		is_default: true,
		updated_at: '2026-10-08T00:00:00Z',
		updated_by: 'sa-user',
		...overrides
	};
}

describe('ScannerDeviceRepository', () => {
	const mockFetch = vi.mocked(adminFetch);
	const mockRaw = vi.mocked(adminRaw);
	let secrets: FakeSecretStore;
	let repository: ScannerDeviceRepository;

	beforeEach(() => {
		vi.clearAllMocks();
		secrets = new FakeSecretStore();
		repository = new ScannerDeviceRepository(secrets as unknown as StaffPinSecretStore);
		mockFetch.mockResolvedValue({ docs: [{ type: 'shelter', code: 'SH001' }] });
	});

	describe('createDevice', () => {
		beforeEach(() => {
			mockRaw
				.mockResolvedValueOnce({ status: 404, data: { error: 'not_found' } }) // existence check
				.mockResolvedValueOnce({ status: 201, data: { ok: true } }); // registry PUT
		});

		it('persists only a hash/prefix and PIN metadata under the deterministic id', async () => {
			const result = await repository.createDevice(input, 'sa-user');

			const [path, method, putBody] = mockRaw.mock.calls[1] as [
				string,
				string,
				Record<string, unknown>
			];
			expect(path).toBe('/registry/scanner_device%3Akiosk-sh001-01');
			expect(method).toBe('PUT');
			expect(putBody._id).toBe('scanner_device:kiosk-sh001-01');
			expect(putBody.secret_hash).toMatch(/^[0-9a-f]{64}$/);
			expect(putBody.secret_prefix).toBe(`${result.plaintext_secret.slice(0, 16)}...`);
			expect(putBody).not.toHaveProperty('plaintext_secret');
			expect(result.device.secret_hash).toBe(putBody.secret_hash);
			expect(result.plaintext_secret.startsWith('sk_scan_')).toBe(true);
			expect(putBody).toMatchObject({
				schema_v: 2,
				staff_pin_set: true,
				staff_pin_is_default: true,
				staff_pin_updated_by: 'sa-user'
			});
		});

		it('writes the chosen screen_type on the registry doc', async () => {
			await repository.createDevice({ ...input, screen_type: 'portrait' }, 'sa-user');

			expect(mockRaw.mock.calls[1]?.[2]).toMatchObject({ screen_type: 'portrait' });
		});

		it('writes no banner fields on a new device, so it starts without a banner group', async () => {
			await repository.createDevice(input, 'sa-user');

			const body = mockRaw.mock.calls[1]?.[2] as Record<string, unknown>;
			expect(body).not.toHaveProperty('banner_enabled');
			expect(body).not.toHaveProperty('banner_group_id');
		});

		it('writes a random default PIN to scanner_secrets first and returns it once', async () => {
			const result = await repository.createDevice(input, 'sa-user');

			expect(result.plaintext_staff_pin).toMatch(/^\d{6}$/);
			expect(secrets.docs.get('kiosk-sh001-01')).toMatchObject({
				pin: result.plaintext_staff_pin,
				is_default: true,
				updated_by: 'sa-user'
			});
			const registryBody = mockRaw.mock.calls[1]?.[2];
			expect(JSON.stringify(registryBody)).not.toContain(result.plaintext_staff_pin);
			expect(secrets.put.mock.invocationCallOrder[0]).toBeLessThan(
				mockRaw.mock.invocationCallOrder[1]
			);
		});

		it('replaces a leftover PIN doc from a deleted device', async () => {
			secrets.docs.set('kiosk-sh001-01', storedSecret('111222'));

			const result = await repository.createDevice(input, 'sa-user');

			expect(secrets.put).toHaveBeenCalledWith(expect.anything(), '7-s');
			expect(secrets.docs.get('kiosk-sh001-01')?.pin).toBe(result.plaintext_staff_pin);
		});
	});

	it('refuses an existing device id before touching its PIN', async () => {
		mockRaw.mockResolvedValueOnce({ status: 200, data: v2Doc });
		secrets.docs.set('kiosk-sh001-01', storedSecret('482913'));

		await expect(repository.createDevice(input, 'sa-user')).rejects.toBeInstanceOf(
			ScannerConflictError
		);
		expect(secrets.put).not.toHaveBeenCalled();
		expect(secrets.docs.get('kiosk-sh001-01')?.pin).toBe('482913');
	});

	it('rolls the PIN doc back when the registry write loses a race or fails', async () => {
		mockRaw
			.mockResolvedValueOnce({ status: 404, data: null })
			.mockResolvedValueOnce({ status: 409, data: { error: 'conflict' } });
		await expect(repository.createDevice(input, 'sa-user')).rejects.toBeInstanceOf(
			ScannerConflictError
		);
		expect(secrets.docs.has('kiosk-sh001-01')).toBe(false);

		mockRaw
			.mockResolvedValueOnce({ status: 404, data: null })
			.mockResolvedValueOnce({ status: 500, data: null });
		await expect(repository.createDevice(input, 'sa-user')).rejects.toBeInstanceOf(
			ScannerDependencyError
		);
		expect(secrets.docs.has('kiosk-sh001-01')).toBe(false);
	});

	it('restores the PIN of a concurrent create of the same id that won the registry race', async () => {
		// The other request already wrote its PIN, then its registry PUT wins ours.
		secrets.docs.set('kiosk-sh001-01', storedSecret('482913', { updated_by: 'other-sa' }));
		mockRaw
			.mockResolvedValueOnce({ status: 404, data: null })
			.mockResolvedValueOnce({ status: 409, data: { error: 'conflict' } });

		await expect(repository.createDevice(input, 'sa-user')).rejects.toBeInstanceOf(
			ScannerConflictError
		);
		expect(secrets.remove).not.toHaveBeenCalled();
		expect(secrets.docs.get('kiosk-sh001-01')).toMatchObject({
			pin: '482913',
			updated_by: 'other-sa'
		});
	});

	it('fails the create with 503-class error when the secrets store is down', async () => {
		mockRaw.mockResolvedValueOnce({ status: 404, data: null });
		secrets.get.mockRejectedValueOnce(new StaffPinUnavailableError());

		await expect(repository.createDevice(input, 'sa-user')).rejects.toBeInstanceOf(
			ScannerDependencyError
		);
		expect(mockRaw).toHaveBeenCalledTimes(1);
	});

	describe('setStaffPin', () => {
		it('upgrades a v1 doc to v2 metadata under the current _rev, PIN only in secrets', async () => {
			mockRaw
				.mockResolvedValueOnce({ status: 200, data: v1Doc })
				.mockResolvedValueOnce({ status: 201, data: { ok: true } });

			await repository.setStaffPin(v1Doc._id, '582047', 'sa-user');

			const [path, method, body] = mockRaw.mock.calls[1] as [
				string,
				string,
				Record<string, unknown>
			];
			expect(path).toBe('/registry/scanner_device%3Akiosk-sh001-01');
			expect(method).toBe('PUT');
			expect(body).toMatchObject({
				_rev: '3-abc',
				schema_v: 2,
				staff_pin_set: true,
				staff_pin_is_default: false,
				staff_pin_updated_by: 'sa-user',
				secret_hash: v1Doc.secret_hash
			});
			expect(JSON.stringify(body)).not.toContain('582047');
			expect(secrets.docs.get('kiosk-sh001-01')).toMatchObject({
				pin: '582047',
				is_default: false
			});
		});

		it('updates an existing PIN doc with its _rev', async () => {
			secrets.docs.set('kiosk-sh001-01', storedSecret('482913'));
			mockRaw
				.mockResolvedValueOnce({ status: 200, data: v2Doc })
				.mockResolvedValueOnce({ status: 201, data: { ok: true } });

			await repository.setStaffPin(v2Doc._id, '582047', 'sa-user');

			expect(secrets.put).toHaveBeenCalledWith(expect.objectContaining({ pin: '582047' }), '7-s');
		});

		it('retries the metadata write on a registry _rev race (e.g. heartbeat)', async () => {
			mockRaw
				.mockResolvedValueOnce({ status: 200, data: v1Doc })
				.mockResolvedValueOnce({ status: 409, data: { error: 'conflict' } })
				.mockResolvedValueOnce({
					status: 200,
					data: { ...v1Doc, _rev: '4-def', last_seen_at: '2026-10-08T02:00:00Z' }
				})
				.mockResolvedValueOnce({ status: 201, data: { ok: true } });

			await repository.setStaffPin(v1Doc._id, '582047', 'sa-user');

			const body = mockRaw.mock.calls[3]?.[2] as Record<string, unknown>;
			expect(body._rev).toBe('4-def');
			expect(body.last_seen_at).toBe('2026-10-08T02:00:00Z');
			expect(body.staff_pin_set).toBe(true);
		});

		it('rolls the PIN back to the previous one when the metadata write fails', async () => {
			secrets.docs.set('kiosk-sh001-01', storedSecret('482913', { updated_by: 'old-sa' }));
			const error = vi.spyOn(console, 'error').mockImplementation(() => {});
			mockRaw
				.mockResolvedValueOnce({ status: 200, data: v2Doc })
				.mockResolvedValueOnce({ status: 500, data: null });

			await expect(repository.setStaffPin(v2Doc._id, '582047', 'sa')).rejects.toBeInstanceOf(
				ScannerDependencyError
			);
			expect(secrets.docs.get('kiosk-sh001-01')).toMatchObject({
				pin: '482913',
				updated_by: 'old-sa'
			});
			expect(error).not.toHaveBeenCalled();
			error.mockRestore();
		});

		it('logs an error and fails with 503 when the rollback itself fails', async () => {
			secrets.docs.set('kiosk-sh001-01', storedSecret('482913'));
			const error = vi.spyOn(console, 'error').mockImplementation(() => {});
			mockRaw
				.mockResolvedValueOnce({ status: 200, data: v2Doc })
				.mockResolvedValueOnce({ status: 500, data: null });
			// First put = the new PIN; the restore put fails.
			secrets.put.mockImplementationOnce(async (pinInput) => {
				const doc = storedSecret(pinInput.pin, { _rev: '8-s' });
				secrets.docs.set(pinInput.device_id, doc);
				return doc;
			});
			secrets.put.mockRejectedValueOnce(new StaffPinUnavailableError());

			await expect(repository.setStaffPin(v2Doc._id, '582047', 'sa')).rejects.toBeInstanceOf(
				StaffPinUnavailableError
			);
			const logged = error.mock.calls.flat().join(' ');
			expect(logged).toContain('rollback PIN change failed device=kiosk-sh001-01');
			expect(logged).not.toContain('582047');
			expect(logged).not.toContain('482913');
			error.mockRestore();
		});

		it('removes a newly created PIN doc when the metadata write keeps conflicting', async () => {
			mockRaw.mockResolvedValue({ status: 409, data: { error: 'conflict' } });
			mockRaw.mockResolvedValueOnce({ status: 200, data: v1Doc });
			for (let i = 0; i < 2; i += 1) {
				mockRaw
					.mockResolvedValueOnce({ status: 409, data: { error: 'conflict' } })
					.mockResolvedValueOnce({ status: 200, data: v1Doc });
			}

			await expect(repository.setStaffPin(v1Doc._id, '582047', 'sa')).rejects.toBeInstanceOf(
				ScannerConflictError
			);
			expect(secrets.docs.has('kiosk-sh001-01')).toBe(false);
		});

		it('maps a missing device to not-found and a stale PIN rev to a conflict', async () => {
			mockRaw.mockResolvedValueOnce({ status: 404, data: { error: 'not_found' } });
			await expect(
				repository.setStaffPin('scanner_device:nope', '582047', 'sa')
			).rejects.toBeInstanceOf(ScannerDeviceNotFoundError);

			mockRaw.mockResolvedValueOnce({ status: 200, data: v1Doc });
			secrets.put.mockRejectedValueOnce(new ScannerConflictError('stale'));
			await expect(repository.setStaffPin(v1Doc._id, '582047', 'sa')).rejects.toBeInstanceOf(
				ScannerConflictError
			);
			expect(mockRaw).toHaveBeenCalledTimes(2);
		});

		it('fails with a dependency error (503) when the secrets store is down and never touches the registry', async () => {
			mockRaw.mockResolvedValueOnce({ status: 200, data: v1Doc });
			secrets.put.mockRejectedValueOnce(new StaffPinUnavailableError());

			await expect(repository.setStaffPin(v1Doc._id, '582047', 'sa')).rejects.toBeInstanceOf(
				StaffPinUnavailableError
			);
			expect(mockRaw).toHaveBeenCalledTimes(1);
		});
	});

	it('regenerates a random PIN and returns it', async () => {
		mockRaw
			.mockResolvedValueOnce({ status: 200, data: v1Doc })
			.mockResolvedValueOnce({ status: 201, data: { ok: true } });

		const pin = await repository.regenerateStaffPin(v1Doc._id, 'sa-user');
		expect(pin).toMatch(/^\d{6}$/);
		expect(secrets.docs.get('kiosk-sh001-01')?.pin).toBe(pin);
	});

	it('reveals a stored PIN with its metadata, and reports a missing PIN doc as not set', async () => {
		secrets.docs.set(
			'kiosk-sh001-01',
			storedSecret('582047', { is_default: false, updated_at: '2026-10-08T03:00:00Z' })
		);
		mockRaw.mockResolvedValueOnce({ status: 200, data: v2Doc });
		expect(await repository.revealStaffPin(v2Doc._id)).toEqual({
			pin: '582047',
			is_default: false,
			updated_at: '2026-10-08T03:00:00Z',
			updated_by: 'sa-user'
		});

		secrets.docs.clear();
		mockRaw.mockResolvedValueOnce({ status: 200, data: v1Doc });
		await expect(repository.revealStaffPin(v1Doc._id)).rejects.toBeInstanceOf(StaffPinNotSetError);

		mockRaw.mockResolvedValueOnce({ status: 200, data: { _id: 'shelter:SH001', type: 'shelter' } });
		await expect(repository.revealStaffPin('shelter:SH001')).rejects.toBeInstanceOf(
			ScannerDeviceNotFoundError
		);
	});

	describe('getDevice', () => {
		it('returns the registry doc for an id and maps a missing one to not-found', async () => {
			mockRaw.mockResolvedValueOnce({ status: 200, data: v2Doc });
			const device = await repository.getDevice(v2Doc._id);
			expect(device.shelter_code).toBe('SH001');
			expect(mockRaw.mock.calls[0]?.slice(0, 2)).toEqual([
				'/registry/scanner_device%3Akiosk-sh001-01',
				'GET'
			]);

			mockRaw.mockResolvedValueOnce({ status: 404, data: null });
			await expect(repository.getDevice('scanner_device:nope')).rejects.toBeInstanceOf(
				ScannerDeviceNotFoundError
			);
		});
	});

	describe('listDevices', () => {
		const docB = {
			...v2Doc,
			_id: 'scanner_device:kiosk-sh002-01',
			device_id: 'kiosk-sh002-01',
			shelter_code: 'SH002'
		};

		it('returns every shelter for a system admin (null scope), selecting only scanner devices', async () => {
			mockFetch.mockResolvedValueOnce({ docs: [v2Doc, docB] });
			const devices = await repository.listDevices(null);
			expect(devices.map((d) => d.device_id)).toEqual(['kiosk-sh001-01', 'kiosk-sh002-01']);
			const [path, init] = mockFetch.mock.calls[0] as [string, { body: string }];
			expect(path).toBe('/registry/_find');
			expect(JSON.parse(init.body).selector).toEqual({ type: 'scanner_device' });
		});

		it('keeps only the shelters in scope', async () => {
			mockFetch.mockResolvedValueOnce({ docs: [v2Doc, docB] });
			const devices = await repository.listDevices(['SH002']);
			expect(devices.map((d) => d.device_id)).toEqual(['kiosk-sh002-01']);
		});

		it('returns nothing for an empty scope', async () => {
			mockFetch.mockResolvedValueOnce({ docs: [v2Doc, docB] });
			expect(await repository.listDevices([])).toEqual([]);
		});

		it('skips a broken doc with a warning instead of failing the list', async () => {
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
			mockFetch.mockResolvedValueOnce({
				docs: [{ ...v2Doc, _id: 'scanner_device:broken', secret_hash: 'nope' }, docB]
			});
			const devices = await repository.listDevices(null);
			expect(devices.map((d) => d.device_id)).toEqual(['kiosk-sh002-01']);
			expect(warn).toHaveBeenCalledTimes(1);
			expect(String(warn.mock.calls[0]?.[0])).toContain('scanner_device:broken');
			warn.mockRestore();
		});

		it('maps a registry outage to a dependency error', async () => {
			mockFetch.mockRejectedValueOnce(new Error('down'));
			await expect(repository.listDevices(null)).rejects.toBeInstanceOf(ScannerDependencyError);
		});
	});

	describe('updateDevice', () => {
		const putBodyAt = (call: number) => mockRaw.mock.calls[call]?.[2] as Record<string, unknown>;

		it('applies the patch under the current _rev and leaves server-owned fields alone', async () => {
			mockRaw
				.mockResolvedValueOnce({ status: 200, data: v2Doc })
				.mockResolvedValueOnce({ status: 201, data: { ok: true, rev: '4-def' } });

			const updated = await repository.updateDevice(
				v2Doc._id,
				{ name: 'จุดคัดกรอง 9', status: 'inactive' },
				'sm-a'
			);

			expect(mockRaw.mock.calls[1]?.slice(0, 2)).toEqual([
				'/registry/scanner_device%3Akiosk-sh001-01',
				'PUT'
			]);
			expect(putBodyAt(1)).toEqual({
				...v2Doc,
				name: 'จุดคัดกรอง 9',
				status: 'inactive',
				updated_at: expect.any(String)
			});
			expect(putBodyAt(1).updated_at).not.toBe(v2Doc.updated_at);
			expect(updated.name).toBe('จุดคัดกรอง 9');
			expect(updated.status).toBe('inactive');
		});

		it('writes screen_type through a patch', async () => {
			mockRaw
				.mockResolvedValueOnce({ status: 200, data: v2Doc })
				.mockResolvedValueOnce({ status: 201, data: { ok: true, rev: '4-def' } });

			const updated = await repository.updateDevice(v2Doc._id, { screen_type: 'portrait' }, 'sm-a');
			expect(putBodyAt(1)).toMatchObject({ screen_type: 'portrait' });
			expect(updated.screen_type).toBe('portrait');
		});

		it('keeps a v1 doc at v1 (no PIN metadata invented)', async () => {
			mockRaw
				.mockResolvedValueOnce({ status: 200, data: v1Doc })
				.mockResolvedValueOnce({ status: 201, data: { ok: true } });
			await repository.updateDevice(v1Doc._id, { status: 'inactive' }, 'sm-a');
			expect(putBodyAt(1).schema_v).toBe(1);
			expect(putBodyAt(1)).not.toHaveProperty('staff_pin_set');
		});

		it('retries a _rev race on a fresh read and keeps the newer last_seen_at', async () => {
			const heartbeat = { ...v2Doc, _rev: '4-hb', last_seen_at: '2026-10-12T01:00:00Z' };
			mockRaw
				.mockResolvedValueOnce({ status: 200, data: v2Doc })
				.mockResolvedValueOnce({ status: 409, data: { error: 'conflict' } })
				.mockResolvedValueOnce({ status: 200, data: heartbeat })
				.mockResolvedValueOnce({ status: 201, data: { ok: true } });

			await repository.updateDevice(v2Doc._id, { status: 'inactive' }, 'sm-a');

			expect(putBodyAt(3)).toMatchObject({
				_rev: '4-hb',
				last_seen_at: '2026-10-12T01:00:00Z',
				status: 'inactive'
			});
		});

		it('gives up with a conflict after three _rev races', async () => {
			mockRaw.mockImplementation(async (_path, method) =>
				method === 'PUT'
					? { status: 409, data: { error: 'conflict' } }
					: { status: 200, data: v2Doc }
			);
			await expect(
				repository.updateDevice(v2Doc._id, { status: 'inactive' }, 'sm-a')
			).rejects.toBeInstanceOf(ScannerConflictError);
			expect(mockRaw.mock.calls.filter(([, method]) => method === 'PUT')).toHaveLength(3);
			mockRaw.mockReset();
		});

		it('maps a missing device to not-found without writing', async () => {
			mockRaw.mockResolvedValueOnce({ status: 404, data: null });
			await expect(
				repository.updateDevice('scanner_device:nope', { status: 'inactive' }, 'sm-a')
			).rejects.toBeInstanceOf(ScannerDeviceNotFoundError);
			expect(mockRaw).toHaveBeenCalledTimes(1);
		});

		it('maps a failed write to a dependency error', async () => {
			mockRaw
				.mockResolvedValueOnce({ status: 200, data: v2Doc })
				.mockResolvedValueOnce({ status: 500, data: { error: 'x' } });
			await expect(
				repository.updateDevice(v2Doc._id, { status: 'inactive' }, 'sm-a')
			).rejects.toBeInstanceOf(ScannerDependencyError);
		});

		it('logs which fields changed, by whom, without any secret', async () => {
			const info = vi.spyOn(console, 'info').mockImplementation(() => {});
			mockRaw
				.mockResolvedValueOnce({ status: 200, data: v2Doc })
				.mockResolvedValueOnce({ status: 201, data: { ok: true } });
			await repository.updateDevice(v2Doc._id, { name: 'x', status: 'inactive' }, 'sm-a');
			const logged = info.mock.calls.flat().join(' ');
			expect(logged).toContain(
				'[scanner-device] updated device=kiosk-sh001-01 shelter=SH001 fields=name,status by=sm-a'
			);
			expect(logged).not.toContain(v2Doc.secret_hash);
			info.mockRestore();
		});
	});

	describe('setBannerGroup', () => {
		const otherDoc = {
			...v2Doc,
			_id: 'scanner_device:kiosk-sh001-02',
			_rev: '5-xyz',
			device_id: 'kiosk-sh001-02'
		};
		const putBodyAt = (call: number) => mockRaw.mock.calls[call]?.[2] as Record<string, unknown>;

		it('sets banner_group_id on each device and leaves every other field untouched', async () => {
			mockRaw
				.mockResolvedValueOnce({ status: 200, data: v2Doc })
				.mockResolvedValueOnce({ status: 201, data: { ok: true, rev: '4-def' } })
				.mockResolvedValueOnce({ status: 200, data: otherDoc })
				.mockResolvedValueOnce({ status: 201, data: { ok: true, rev: '6-uvw' } });

			const updated = await repository.setBannerGroup(
				[v2Doc._id, otherDoc._id],
				'kiosk_banner_group:g1',
				'sm-a'
			);

			expect(putBodyAt(1)).toEqual({
				...v2Doc,
				banner_group_id: 'kiosk_banner_group:g1',
				updated_at: expect.any(String)
			});
			expect(putBodyAt(3)).toEqual({
				...otherDoc,
				banner_group_id: 'kiosk_banner_group:g1',
				updated_at: expect.any(String)
			});
			expect(updated.map((d) => [d.device_id, d.banner_group_id])).toEqual([
				['kiosk-sh001-01', 'kiosk_banner_group:g1'],
				['kiosk-sh001-02', 'kiosk_banner_group:g1']
			]);
		});

		it('clears the group with null (stored as explicit null, not removed)', async () => {
			const grouped = { ...v2Doc, banner_group_id: 'kiosk_banner_group:g1' };
			mockRaw
				.mockResolvedValueOnce({ status: 200, data: grouped })
				.mockResolvedValueOnce({ status: 201, data: { ok: true, rev: '4-def' } });

			await repository.setBannerGroup([v2Doc._id], null, 'sm-a');

			expect(putBodyAt(1)).toMatchObject({ banner_group_id: null });
		});
	});

	describe('deleteDevice', () => {
		it('deletes the registry doc by _rev, then its PIN doc', async () => {
			secrets.docs.set('kiosk-sh001-01', storedSecret('482913'));
			mockRaw
				.mockResolvedValueOnce({ status: 200, data: v2Doc })
				.mockResolvedValueOnce({ status: 200, data: { ok: true } });

			await repository.deleteDevice(v2Doc._id);

			expect(mockRaw.mock.calls[1]?.slice(0, 2)).toEqual([
				'/registry/scanner_device%3Akiosk-sh001-01?rev=3-abc',
				'DELETE'
			]);
			expect(secrets.remove).toHaveBeenCalledWith('kiosk-sh001-01');
			expect(secrets.docs.has('kiosk-sh001-01')).toBe(false);
		});

		it('keeps the PIN when the registry delete fails, and maps errors', async () => {
			secrets.docs.set('kiosk-sh001-01', storedSecret('482913'));
			mockRaw
				.mockResolvedValueOnce({ status: 200, data: v2Doc })
				.mockResolvedValueOnce({ status: 409, data: { error: 'conflict' } });
			await expect(repository.deleteDevice(v2Doc._id)).rejects.toBeInstanceOf(ScannerConflictError);
			expect(secrets.remove).not.toHaveBeenCalled();

			mockRaw.mockResolvedValueOnce({ status: 404, data: null });
			await expect(repository.deleteDevice('scanner_device:nope')).rejects.toBeInstanceOf(
				ScannerDeviceNotFoundError
			);
		});

		it('still succeeds when only the PIN cleanup fails (an orphan PIN is inert)', async () => {
			const error = vi.spyOn(console, 'error').mockImplementation(() => {});
			secrets.remove.mockRejectedValueOnce(new StaffPinUnavailableError());
			mockRaw
				.mockResolvedValueOnce({ status: 200, data: v2Doc })
				.mockResolvedValueOnce({ status: 200, data: { ok: true } });

			await expect(repository.deleteDevice(v2Doc._id)).resolves.toBeUndefined();
			expect(error).toHaveBeenCalledTimes(1);
			error.mockRestore();
		});
	});
});
