// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invalidateQueries = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());

vi.mock('svelte-sonner', () => ({ toast: { error: toastError } }));

// createQuery hands back its options; createMutation returns a real `.mutate` that runs
// mutationFn, then onSuccess / onError (same shape as volunteers/application/queries.test.ts).
vi.mock('@tanstack/svelte-query', () => ({
	useQueryClient: () => ({ invalidateQueries }),
	createQuery: (fn: () => unknown) => fn(),
	createMutation: (fn: () => Record<string, unknown>) => {
		const options = fn();
		return {
			mutate: async (variables: unknown) => {
				const mutationFn = options.mutationFn as (v: unknown) => Promise<unknown>;
				const onSuccess = options.onSuccess as ((d: unknown, v: unknown) => void) | undefined;
				const onError = options.onError as ((e: unknown) => void) | undefined;
				try {
					const data = await mutationFn(variables);
					onSuccess?.(data, variables);
					return data;
				} catch (error) {
					onError?.(error);
				}
			}
		};
	}
}));

import { scannerKeys } from '$lib/features/kiosk-devices';
import {
	KioskBannerApiError,
	type KioskBannerGroupRepository
} from '../data/kiosk-banner.repository';
import {
	kioskBannerErrorMessage,
	kioskBannerGroupKeys,
	kioskBannerKeys,
	useCreateKioskBannerGroup,
	useDeleteKioskBannerGroup,
	useKioskBannerGroup,
	useKioskBannerGroups,
	useSetKioskBannerGroupDevices,
	useUpdateKioskBannerGroup
} from './kiosk-banner.queries';

const groupRepo = {
	list: vi.fn(),
	get: vi.fn(),
	create: vi.fn(),
	update: vi.fn(),
	remove: vi.fn(),
	setDevices: vi.fn()
} satisfies KioskBannerGroupRepository;

beforeEach(() => {
	vi.clearAllMocks();
	for (const fn of Object.values(groupRepo)) fn.mockResolvedValue(undefined);
});

const invalidatedKeys = () => invalidateQueries.mock.calls.map(([arg]) => arg.queryKey);

describe('kioskBannerKeys', () => {
	it('nests list and detail keys under all so one invalidation covers both', () => {
		const all = kioskBannerKeys.all;
		expect(kioskBannerKeys.list('SH-01', 'current').slice(0, all.length)).toEqual(all);
		expect(kioskBannerKeys.detail('kiosk_banner:1').slice(0, all.length)).toEqual(all);
	});

	it('separates shelters and views', () => {
		expect(kioskBannerKeys.list('SH-01', 'current')).not.toEqual(
			kioskBannerKeys.list('SH-01', 'expired')
		);
		expect(kioskBannerKeys.list('SH-01', 'current')).not.toEqual(
			kioskBannerKeys.list('SH-02', 'current')
		);
		expect(kioskBannerKeys.detail('a')).not.toEqual(kioskBannerKeys.detail('b'));
	});
});

describe('kioskBannerErrorMessage', () => {
	it('uses the dedicated reload message for 409', () => {
		const error = new KioskBannerApiError(409, 'CONFLICT', 'Document update conflict');
		expect(kioskBannerErrorMessage(error)).toBe('มีผู้อื่นแก้ไขแบนเนอร์นี้ โปรดโหลดใหม่');
	});

	it('passes through the server message for other API errors', () => {
		const error = new KioskBannerApiError(422, 'VALIDATION', 'รูปภาพต้องมีขนาดไม่เกิน 2 MB');
		expect(kioskBannerErrorMessage(error)).toBe('รูปภาพต้องมีขนาดไม่เกิน 2 MB');
	});

	it('falls back for unknown errors', () => {
		expect(kioskBannerErrorMessage(new Error('boom'), 'บันทึกไม่สำเร็จ')).toBe('boom');
		expect(kioskBannerErrorMessage('x', 'บันทึกไม่สำเร็จ')).toBe('บันทึกไม่สำเร็จ');
	});
});

describe('kioskBannerGroupKeys', () => {
	it('nests list and detail keys under all so one invalidation covers both', () => {
		const all = kioskBannerGroupKeys.all;
		expect(kioskBannerGroupKeys.list('SH-01').slice(0, all.length)).toEqual(all);
		expect(kioskBannerGroupKeys.detail('kiosk_banner_group:1').slice(0, all.length)).toEqual(all);
	});

	it('separates shelters and groups, and stays apart from the banner keys', () => {
		expect(kioskBannerGroupKeys.list('SH-01')).not.toEqual(kioskBannerGroupKeys.list('SH-02'));
		expect(kioskBannerGroupKeys.detail('a')).not.toEqual(kioskBannerGroupKeys.detail('b'));
		expect(kioskBannerGroupKeys.all).not.toEqual(kioskBannerKeys.all);
	});
});

describe('group queries', () => {
	it('useKioskBannerGroups lists the shelter groups and stays disabled until a shelter is picked', async () => {
		groupRepo.list.mockResolvedValue([]);
		const query = useKioskBannerGroups(() => 'SH-01', groupRepo) as unknown as {
			queryKey: unknown;
			enabled: boolean;
			queryFn: () => Promise<unknown>;
		};
		await query.queryFn();
		expect(groupRepo.list).toHaveBeenCalledWith('SH-01');
		expect(query.queryKey).toEqual(kioskBannerGroupKeys.list('SH-01'));
		expect(query.enabled).toBe(true);

		const idle = useKioskBannerGroups(() => undefined, groupRepo) as unknown as {
			enabled: boolean;
		};
		expect(idle.enabled).toBe(false);
	});

	it('useKioskBannerGroup fetches one group and stays disabled without an id', async () => {
		const query = useKioskBannerGroup(() => 'kiosk_banner_group:1', groupRepo) as unknown as {
			queryKey: unknown;
			enabled: boolean;
			queryFn: () => Promise<unknown>;
		};
		await query.queryFn();
		expect(groupRepo.get).toHaveBeenCalledWith('kiosk_banner_group:1');
		expect(query.queryKey).toEqual(kioskBannerGroupKeys.detail('kiosk_banner_group:1'));

		const idle = useKioskBannerGroup(() => undefined, groupRepo) as unknown as {
			enabled: boolean;
		};
		expect(idle.enabled).toBe(false);
	});
});

describe('group mutations', () => {
	it('create saves the group and refreshes groups and the kiosk device list', async () => {
		await useCreateKioskBannerGroup(groupRepo).mutate({
			shelterCode: 'SH-01',
			input: { name: 'ล็อบบี้' },
			deviceIds: ['scanner_device:1']
		});
		expect(groupRepo.create).toHaveBeenCalledWith('SH-01', { name: 'ล็อบบี้' }, [
			'scanner_device:1'
		]);
		expect(invalidatedKeys()).toEqual([kioskBannerGroupKeys.all, scannerKeys.allDevices]);
	});

	it('update refreshes groups only, not the kiosk device list', async () => {
		await useUpdateKioskBannerGroup(groupRepo).mutate({
			id: 'kiosk_banner_group:1',
			rev: '1-a',
			input: { name: 'ใหม่' }
		});
		expect(groupRepo.update).toHaveBeenCalledWith('kiosk_banner_group:1', '1-a', { name: 'ใหม่' });
		expect(invalidatedKeys()).toEqual([kioskBannerGroupKeys.all]);
	});

	it('delete refreshes groups, banners and the kiosk device list', async () => {
		await useDeleteKioskBannerGroup(groupRepo).mutate({ id: 'kiosk_banner_group:1', rev: '1-a' });
		expect(groupRepo.remove).toHaveBeenCalledWith('kiosk_banner_group:1', '1-a');
		expect(invalidatedKeys()).toEqual([
			kioskBannerGroupKeys.all,
			scannerKeys.allDevices,
			kioskBannerKeys.all
		]);
	});

	it('setDevices refreshes groups and the kiosk device list', async () => {
		await useSetKioskBannerGroupDevices(groupRepo).mutate({
			id: 'kiosk_banner_group:1',
			deviceIds: ['scanner_device:2']
		});
		expect(groupRepo.setDevices).toHaveBeenCalledWith('kiosk_banner_group:1', ['scanner_device:2']);
		expect(invalidatedKeys()).toEqual([kioskBannerGroupKeys.all, scannerKeys.allDevices]);
	});

	it('a delete refused because the group still has banners toasts that reason', async () => {
		const message = 'ลบกลุ่มไม่ได้ ยังมีแบนเนอร์ในกลุ่ม';
		groupRepo.remove.mockRejectedValue(new KioskBannerApiError(409, 'CONFLICT', message));
		await useDeleteKioskBannerGroup(groupRepo).mutate({ id: 'kiosk_banner_group:1', rev: '1-a' });
		expect(toastError).toHaveBeenCalledWith(message);
		expect(invalidateQueries).not.toHaveBeenCalled();
	});
});
