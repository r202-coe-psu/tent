import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
import { scannerRepository } from '../data/scanner.remote';
import {
	createScannerDevice,
	deleteScannerDevice,
	revealScannerStaffPin,
	setScannerStaffPin
} from '../data/scanner.api';
import type { ScannerDevice, StaffPinUpdateRequest } from '../domain/scanner.schema';

export const scannerKeys = {
	allDevices: ['scanner-devices'] as const,
	devicesList: () => [...scannerKeys.allDevices, 'list'] as const
};

export const useScannerDevices = () =>
	createQuery(() => ({
		queryKey: scannerKeys.devicesList(),
		queryFn: () => scannerRepository.listDevices()
	}));

export const useCreateScannerDevice = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (input: Parameters<typeof createScannerDevice>[0]) => createScannerDevice(input),
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
		mutationFn: (id: string) => deleteScannerDevice(id),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: scannerKeys.allDevices })
	}));
};

/** Set or regenerate a device's staff PIN; refreshes the list so the PIN badges update. */
export const useSetScannerStaffPin = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (input: { id: string; body: StaffPinUpdateRequest }) =>
			setScannerStaffPin(input.id, input.body),
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
		mutationFn: (id: string) => revealScannerStaffPin(id),
		gcTime: 0
	}));
