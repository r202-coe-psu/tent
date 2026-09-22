import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
import { scannerRepository } from '../data/scanner.remote';
import { createScannerDevice } from '../data/scanner.api';
import type { ScannerDevice } from '../domain/scanner.schema';

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
		mutationFn: (id: string) => scannerRepository.deleteDevice(id),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: scannerKeys.allDevices })
	}));
};
