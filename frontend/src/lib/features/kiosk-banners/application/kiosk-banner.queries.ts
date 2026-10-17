import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
import { toast } from 'svelte-sonner';
import type { KioskScreenType } from '$lib/features/shared/domain/kiosk-screen';
import type { KioskBannerInput } from '../domain/kiosk-banner';
import type { BannerImagePayload } from '../data/kiosk-banner-file';
import { kioskBannerRemoteRepository } from '../data/kiosk-banner.remote';
import {
	KioskBannerApiError,
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
			screenType: KioskScreenType;
			items: { id: string; rev: string }[];
		}) => repo.reorder(input.shelterCode, input.screenType, input.items),
		'บันทึกลำดับไม่สำเร็จ'
	);
