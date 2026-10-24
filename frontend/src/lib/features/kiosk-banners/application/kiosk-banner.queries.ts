import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
import { toast } from 'svelte-sonner';
import { scannerKeys } from '$lib/features/kiosk-devices';
import type { KioskScreenType } from '$lib/features/shared/domain/kiosk-screen';
import type { KioskBannerInput } from '../domain/kiosk-banner';
import type { KioskBannerGroupInput } from '../domain/kiosk-banner-group';
import type { BannerImagePayload } from '../data/kiosk-banner-file';
import {
	kioskBannerGroupRemoteRepository,
	kioskBannerRemoteRepository
} from '../data/kiosk-banner.remote';
import {
	KioskBannerApiError,
	type KioskBannerGroupRepository,
	type KioskBannerRepository,
	type KioskBannerStatus,
	type KioskBannerView
} from '../data/kiosk-banner.repository';

export const kioskBannerKeys = {
	all: ['kiosk-banners'] as const,
	list: (shelterCode: string, view: KioskBannerView) =>
		[...kioskBannerKeys.all, 'list', shelterCode, view] as const,
	detail: (id: string) => [...kioskBannerKeys.all, 'detail', id] as const
};

export const kioskBannerGroupKeys = {
	all: ['kiosk-banner-groups'] as const,
	list: (shelterCode: string) => [...kioskBannerGroupKeys.all, 'list', shelterCode] as const,
	detail: (id: string) => [...kioskBannerGroupKeys.all, 'detail', id] as const
};

export const KIOSK_BANNER_CONFLICT_MESSAGE = 'มีผู้อื่นแก้ไขแบนเนอร์นี้ โปรดโหลดใหม่';

/** Thai toast text for a failed banner call; 409 means someone else saved first (FR-KBR-26). */
export function kioskBannerErrorMessage(error: unknown, fallback = 'เกิดข้อผิดพลาด'): string {
	if (error instanceof KioskBannerApiError && error.status === 409) {
		return KIOSK_BANNER_CONFLICT_MESSAGE;
	}
	return error instanceof Error && error.message ? error.message : fallback;
}

/** `shelterCode` undefined (no shelter picked yet) keeps the query disabled. */
export const useKioskBanners = (
	shelterCode: () => string | undefined,
	view: () => KioskBannerView,
	repo: KioskBannerRepository = kioskBannerRemoteRepository
) =>
	createQuery(() => {
		const code = shelterCode();
		const currentView = view();
		return {
			queryKey: kioskBannerKeys.list(code ?? '', currentView),
			queryFn: () => repo.list(code as string, currentView),
			enabled: !!code
		};
	});

export const useKioskBanner = (
	id: () => string | undefined,
	repo: KioskBannerRepository = kioskBannerRemoteRepository
) =>
	createQuery(() => {
		const bannerId = id();
		return {
			queryKey: kioskBannerKeys.detail(bannerId ?? ''),
			queryFn: () => repo.get(bannerId as string),
			enabled: !!bannerId
		};
	});

function useBannerMutation<TInput>(
	mutationFn: (input: TInput) => Promise<unknown>,
	failureText: string
) {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: kioskBannerKeys.all }),
		onError: (error: unknown) => toast.error(kioskBannerErrorMessage(error, failureText))
	}));
}

export const useCreateKioskBanner = (repo: KioskBannerRepository = kioskBannerRemoteRepository) =>
	useBannerMutation(
		(input: { shelterCode: string; input: KioskBannerInput; image: BannerImagePayload }) =>
			repo.create(input.shelterCode, input.input, input.image),
		'สร้างแบนเนอร์ไม่สำเร็จ'
	);

export const useUpdateKioskBanner = (repo: KioskBannerRepository = kioskBannerRemoteRepository) =>
	useBannerMutation(
		(input: { id: string; rev: string; input: KioskBannerInput; image?: BannerImagePayload }) =>
			repo.update(input.id, input.rev, input.input, input.image),
		'แก้ไขแบนเนอร์ไม่สำเร็จ'
	);

export const useSetKioskBannerStatus = (
	repo: KioskBannerRepository = kioskBannerRemoteRepository
) =>
	useBannerMutation(
		(input: { id: string; rev: string; status: KioskBannerStatus }) =>
			repo.setStatus(input.id, input.rev, input.status),
		'เปลี่ยนสถานะแบนเนอร์ไม่สำเร็จ'
	);

export const useDeleteKioskBanner = (repo: KioskBannerRepository = kioskBannerRemoteRepository) =>
	useBannerMutation(
		(input: { id: string; rev: string }) => repo.remove(input.id, input.rev),
		'ลบแบนเนอร์ไม่สำเร็จ'
	);

export const useReorderKioskBanners = (repo: KioskBannerRepository = kioskBannerRemoteRepository) =>
	useBannerMutation(
		(input: {
			shelterCode: string;
			groupId: string;
			screenType: KioskScreenType;
			items: { id: string; rev: string }[];
		}) =>
			repo.reorder(
				input.shelterCode,
				{ groupId: input.groupId, screenType: input.screenType },
				input.items
			),
		'บันทึกลำดับไม่สำเร็จ'
	);

/** `shelterCode` undefined (no shelter picked yet) keeps the query disabled. */
export const useKioskBannerGroups = (
	shelterCode: () => string | undefined,
	repo: KioskBannerGroupRepository = kioskBannerGroupRemoteRepository
) =>
	createQuery(() => {
		const code = shelterCode();
		return {
			queryKey: kioskBannerGroupKeys.list(code ?? ''),
			queryFn: () => repo.list(code as string),
			enabled: !!code
		};
	});

export const useKioskBannerGroup = (
	id: () => string | undefined,
	repo: KioskBannerGroupRepository = kioskBannerGroupRemoteRepository
) =>
	createQuery(() => {
		const groupId = id();
		return {
			queryKey: kioskBannerGroupKeys.detail(groupId ?? ''),
			queryFn: () => repo.get(groupId as string),
			enabled: !!groupId
		};
	});

/** Refreshes the groups, plus `alsoInvalidate` for data the call changes elsewhere. */
function useGroupMutation<TInput, TResult>(
	mutationFn: (input: TInput) => Promise<TResult>,
	failureText: string,
	alsoInvalidate: readonly (readonly unknown[])[] = []
) {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn,
		onSuccess: () =>
			Promise.all(
				[kioskBannerGroupKeys.all, ...alsoInvalidate].map((queryKey) =>
					queryClient.invalidateQueries({ queryKey })
				)
			),
		// Group 409s (duplicate name, group still has banners) carry their own Thai reason.
		onError: (error: unknown) =>
			toast.error(error instanceof Error && error.message ? error.message : failureText)
	}));
}

export const useCreateKioskBannerGroup = (
	repo: KioskBannerGroupRepository = kioskBannerGroupRemoteRepository
) =>
	useGroupMutation(
		(input: { shelterCode: string; input: KioskBannerGroupInput; deviceIds: string[] }) =>
			repo.create(input.shelterCode, input.input, input.deviceIds),
		'สร้างกลุ่มไม่สำเร็จ',
		[scannerKeys.allDevices]
	);

export const useUpdateKioskBannerGroup = (
	repo: KioskBannerGroupRepository = kioskBannerGroupRemoteRepository
) =>
	useGroupMutation(
		(input: { id: string; rev: string; input: KioskBannerGroupInput }) =>
			repo.update(input.id, input.rev, input.input),
		'แก้ไขกลุ่มไม่สำเร็จ'
	);

export const useDeleteKioskBannerGroup = (
	repo: KioskBannerGroupRepository = kioskBannerGroupRemoteRepository
) =>
	useGroupMutation(
		(input: { id: string; rev: string }) => repo.remove(input.id, input.rev),
		'ลบกลุ่มไม่สำเร็จ',
		[scannerKeys.allDevices, kioskBannerKeys.all]
	);

export const useSetKioskBannerGroupDevices = (
	repo: KioskBannerGroupRepository = kioskBannerGroupRemoteRepository
) =>
	useGroupMutation(
		(input: { id: string; deviceIds: string[] }) => repo.setDevices(input.id, input.deviceIds),
		'บันทึกอุปกรณ์ของกลุ่มไม่สำเร็จ',
		[scannerKeys.allDevices]
	);
