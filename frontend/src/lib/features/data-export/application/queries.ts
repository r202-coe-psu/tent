import { createMutation, createQuery } from '@tanstack/svelte-query';
import { toast } from 'svelte-sonner';
import { peopleRepository } from '$lib/features/people';
import { listExportCountries } from '../domain/consulate-export';
import {
	exportConsulateList,
	ConsulateExportError,
	type ExportConsulateInput
} from './export-consulate';

export const dataExportKeys = {
	all: ['data-export'] as const,
	countries: (shelterCode: string) => [...dataExportKeys.all, 'countries', shelterCode] as const
};

/** FR-12 — countries (and head counts) the consulate dialog offers for a shelter. */
export const useExportCountries = (
	shelterCode: () => string,
	enabled: () => boolean = () => true
) =>
	createQuery(() => ({
		queryKey: dataExportKeys.countries(shelterCode()),
		queryFn: async () => listExportCountries(await peopleRepository(shelterCode()).listEvacuees()),
		enabled: !!shelterCode() && enabled(),
		// Never reuse a stale PII list: re-read each time the dialog opens.
		staleTime: 0,
		gcTime: 0
	}));

/** FR-4 / FR-42 — toast-only feedback; no file and an error toast when the audit fails. */
export const useConsulateExport = () =>
	createMutation(() => ({
		mutationFn: (input: ExportConsulateInput) => exportConsulateList(input),
		onSuccess: (r) => toast.success(`Export สำเร็จ ${r.rowCount} รายการ (${r.fileName})`),
		onError: (e: unknown) =>
			toast.error(
				e instanceof ConsulateExportError ? e.message : 'Export ไม่สำเร็จ ไม่มีการดาวน์โหลดไฟล์'
			)
	}));
