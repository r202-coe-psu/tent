import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KioskDeviceInfoResult } from '../data/kiosk-device-info.api';
import type { KioskDeviceInfo, KioskHostInfo } from '../domain/device-info';
import { DEVICE_INFO_IDLE_MS, DeviceInfoSession } from './device-info.svelte';
import { KIOSK_BANNER_IDLE_MS } from '../ui/kiosk-banner-attract.svelte.js';
import { StaffPinEntry } from './staff-pin-entry.svelte';

afterEach(() => {
	vi.useRealTimers();
});

const INFO: KioskDeviceInfo = {
	deviceId: 'kiosk-01',
	name: 'Kiosk หน้าประตู',
	stationName: 'จุดลงทะเบียน 1',
	screenType: 'compact',
	shelterCode: 'SH-001',
	shelterName: 'ศูนย์พักพิงทดสอบ',
	staffPin: { set: true, isDefault: false, updatedAt: '2026-10-01T00:00:00Z', updatedBy: 'staff' },
	bannerGroup: { id: 'bg-1', name: 'กลุ่มแบนเนอร์ A' }
};
const HOST: KioskHostInfo = { hostname: 'kiosk3', ips: ['192.168.1.50'] };

function setup(deviceInfo: KioskDeviceInfoResult = { kind: 'ok', info: INFO }) {
	const fetchDeviceInfo = vi.fn<(pin: string) => Promise<KioskDeviceInfoResult>>(
		async () => deviceInfo
	);
	const fetchHostInfo = vi.fn<() => Promise<KioskHostInfo>>(async () => HOST);
	const session = new DeviceInfoSession({ fetchDeviceInfo, fetchHostInfo });
	const entry = new StaffPinEntry({
		verify: (pin) => session.verify(pin),
		onverified: () => session.pinVerified(),
		oncancel: () => session.pinCancelled()
	});
	return { session, entry, fetchDeviceInfo, fetchHostInfo };
}

describe('DeviceInfoSession', () => {
	it('asks for the PIN, then shows this kiosk info and its hostname and IPs once the server accepts it', async () => {
		const { session, entry, fetchDeviceInfo } = setup();
		session.open();
		expect(session.pinOpen).toBe(true);
		expect(session.shown).toBe(false);

		entry.pin = '123456';
		await entry.confirm();

		expect(fetchDeviceInfo).toHaveBeenCalledExactlyOnceWith('123456');
		expect(session.shown).toBe(true);
		expect(session.pinOpen).toBe(false);
		expect(session.info).toEqual(INFO);
		expect(session.host).toEqual(HOST);
	});

	it('a wrong PIN keeps the PIN panel open and shows nothing', async () => {
		const { session, entry } = setup({ kind: 'wrong' });
		session.open();

		entry.pin = '000000';
		await entry.confirm();

		expect(entry.status.kind).toBe('wrong');
		expect(session.pinOpen).toBe(true);
		expect(session.shown).toBe(false);
		expect(session.info).toBeNull();
	});

	it.each([{ kind: 'not_set' }, { kind: 'error' }] as const)(
		'passes the server answer $kind through so the PIN panel shows its own message',
		async (answer) => {
			const { session } = setup(answer);
			session.open();
			await expect(session.verify('123456')).resolves.toEqual(answer);
			expect(session.info).toBeNull();
		}
	);

	it('looks up the hostname with the PIN check, not after it, and drops it when the PIN was wrong', async () => {
		const { session, fetchDeviceInfo, fetchHostInfo } = setup({ kind: 'wrong' });
		let release: (r: KioskDeviceInfoResult) => void = () => {};
		fetchDeviceInfo.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
		session.open();

		const pending = session.verify('000000');
		expect(fetchHostInfo).toHaveBeenCalledOnce();

		release({ kind: 'wrong' });
		await pending;
		expect(session.host).toBeNull();
	});

	it('closing the panel forgets everything', async () => {
		const { session, entry } = setup();
		session.open();
		entry.pin = '123456';
		await entry.confirm();

		session.close();

		expect(session.shown).toBe(false);
		expect(session.phase).toBe('idle');
		expect(session.info).toBeNull();
		expect(session.host).toBeNull();
	});

	it('keeps the PIN staff typed while the panel is shown, and forgets it on close', async () => {
		const { session, entry } = setup();
		session.open();
		expect(session.pin).toBeNull();

		entry.pin = '123456';
		await entry.confirm();
		expect(session.pin).toBe('123456');

		session.close();
		expect(session.pin).toBeNull();
	});

	it('never keeps a wrong PIN', async () => {
		const { session, entry } = setup({ kind: 'wrong' });
		session.open();

		entry.pin = '000000';
		await entry.confirm();

		expect(session.pin).toBeNull();
	});

	it('forgets the PIN when the idle time runs out', async () => {
		vi.useFakeTimers();
		const { session, entry } = setup();
		session.open();
		entry.pin = '123456';
		await entry.confirm();

		vi.advanceTimersByTime(DEVICE_INFO_IDLE_MS);

		expect(session.pin).toBeNull();
	});

	it('cancelling the PIN goes back to idle without fetching anything', () => {
		const { session, entry, fetchDeviceInfo, fetchHostInfo } = setup();
		session.open();

		entry.cancel();

		expect(session.phase).toBe('idle');
		expect(session.pinOpen).toBe(false);
		expect(fetchDeviceInfo).not.toHaveBeenCalled();
		expect(fetchHostInfo).not.toHaveBeenCalled();
	});

	it('closes by itself after being left untouched', async () => {
		vi.useFakeTimers();
		const { session, entry } = setup();
		session.open();
		entry.pin = '123456';
		await entry.confirm();

		vi.advanceTimersByTime(DEVICE_INFO_IDLE_MS - 1);
		expect(session.shown).toBe(true);
		vi.advanceTimersByTime(1);
		expect(session.shown).toBe(false);
		expect(session.info).toBeNull();
	});

	it('closes before the banner attract would cover it, so no one finds it open behind a banner', async () => {
		vi.useFakeTimers();
		const { session, entry } = setup();
		session.open();
		entry.pin = '123456';
		await entry.confirm();

		vi.advanceTimersByTime(KIOSK_BANNER_IDLE_MS - 1);
		expect(session.shown).toBe(false);
		expect(session.pin).toBeNull();
	});

	it('a tap in the panel restarts the idle clock', async () => {
		vi.useFakeTimers();
		const { session, entry } = setup();
		session.open();
		entry.pin = '123456';
		await entry.confirm();

		vi.advanceTimersByTime(DEVICE_INFO_IDLE_MS - 1);
		session.touch();
		vi.advanceTimersByTime(DEVICE_INFO_IDLE_MS - 1);
		expect(session.shown).toBe(true);
		vi.advanceTimersByTime(1);
		expect(session.shown).toBe(false);
	});

	it('destroy stops the idle clock', async () => {
		vi.useFakeTimers();
		const { session, entry } = setup();
		session.open();
		entry.pin = '123456';
		await entry.confirm();

		session.destroy();

		expect(vi.getTimerCount()).toBe(0);
	});
});
