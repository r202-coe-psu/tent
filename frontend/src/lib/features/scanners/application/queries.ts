import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
import { scannerRepository } from '../data/scanner.remote';
import type { ScannerDeviceInput, ScannerDevice } from '../domain/scanner.schema';
import { getShelterCode } from '$lib/db/shelter';

export const scannerKeys = {
	allDevices: ['scanner-devices'] as const,
	devicesList: () => [...scannerKeys.allDevices, 'list'] as const,
	allDrafts: ['scanner-drafts'] as const,
	draftsList: (shelterCode?: string) =>
		[...scannerKeys.allDrafts, 'list', shelterCode ?? 'current'] as const
};

export const useScannerDevices = () =>
	createQuery(() => ({
		queryKey: scannerKeys.devicesList(),
		queryFn: () => scannerRepository.listDevices()
	}));

export const useCreateScannerDevice = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (input: { input: ScannerDeviceInput; createdBy?: string }) =>
			scannerRepository.createDevice(input.input, input.createdBy ?? 'admin'),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: scannerKeys.allDevices })
	}));
};

export const useUpdateScannerDevice = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (input: {
			id: string;
			patch: Partial<
				Pick<ScannerDevice, 'name' | 'shelter_code' | 'station_name' | 'status' | 'last_seen_at'>
			>;
		}) => scannerRepository.updateDevice(input.id, input.patch),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: scannerKeys.allDevices })
	}));
};

export const useDeleteScannerDevice = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (id: string) => scannerRepository.deleteDevice(id),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: scannerKeys.allDevices })
	}));
};

export const usePendingScannerDrafts = (
	shelterCodeOrGetter?: string | (() => string),
	enabled?: boolean | (() => boolean)
) => {
	const resolveCode = () => {
		if (typeof shelterCodeOrGetter === 'function') return shelterCodeOrGetter();
		return shelterCodeOrGetter ?? getShelterCode();
	};

	const resolveEnabled = () => {
		if (typeof enabled === 'function') return enabled();
		if (typeof enabled === 'boolean') return enabled;
		return true;
	};

	return createQuery(() => {
		const code = resolveCode();
		const isQueryEnabled = resolveEnabled();
		return {
			queryKey: scannerKeys.draftsList(code),
			queryFn: () => scannerRepository.listPendingDrafts(code),
			enabled: isQueryEnabled,
			refetchInterval: isQueryEnabled ? 3000 : false
		};
	});
};

export const useClaimScannerDraft = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (input: { id: string; claimedBy: string; shelterCode?: string }) =>
			scannerRepository.claimDraft(input.id, input.claimedBy, input.shelterCode),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: scannerKeys.allDrafts })
	}));
};
