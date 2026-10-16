import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
import {
	createScannerDevice,
	deleteScannerDevice,
	listScannerDevices,
	revealScannerStaffPin,
	setScannerStaffPin,
	updateScannerDevice
} from '../data/scanner.api';
import type { ScannerDevicePatch, StaffPinUpdateRequest } from '../domain/scanner.schema';

export const scannerKeys = {
	allDevices: ['scanner-devices'] as const,
	devicesList: (shelterCode?: string) =>
		[...scannerKeys.allDevices, 'list', shelterCode ?? 'all'] as const
};

/** `shelterCode` undefined = all shelters (SA only); the key carries it so a switch refetches. */
export const useScannerDevices = (shelterCode?: () => string | undefined) =>
	createQuery(() => {
		const code = shelterCode?.();
		return {
			queryKey: scannerKeys.devicesList(code),
			queryFn: () => listScannerDevices(code)
		};
	});

export const useCreateScannerDevice = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (input: Parameters<typeof createScannerDevice>[0]) => createScannerDevice(input),
		// The result carries the device secret and default PIN; never keep it in the cache.
		gcTime: 0,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: scannerKeys.allDevices })
	}));
};

export const useUpdateScannerDevice = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (input: { deviceId: string; patch: ScannerDevicePatch }) =>
			updateScannerDevice(input.deviceId, input.patch),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: scannerKeys.allDevices })
	}));
};

export const useDeleteScannerDevice = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (deviceId: string) => deleteScannerDevice(deviceId),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: scannerKeys.allDevices })
	}));
};

/** Set or regenerate a device's staff PIN; refreshes the list so the PIN badges update. */
export const useSetScannerStaffPin = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (input: { deviceId: string; body: StaffPinUpdateRequest }) =>
			setScannerStaffPin(input.deviceId, input.body),
		// Never keep a (regenerated) PIN in the mutation cache once the dialog lets go of it.
		gcTime: 0,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: scannerKeys.allDevices })
	}));
};

/**
 * Reveal a device's PIN on demand. A mutation, not a query: never prefetched, never shared via
 * the query cache, and `gcTime: 0` so the result is dropped as soon as the dialog resets it.
 */
export const useRevealScannerStaffPin = () =>
	createMutation(() => ({
		mutationFn: (deviceId: string) => revealScannerStaffPin(deviceId),
		gcTime: 0
	}));
