<script lang="ts">
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import { Button } from '$lib/components/ui/button/index.js';
	import { endpointStore } from '$lib/stores/endpoint.svelte';
	import { languageStore } from '$lib/stores/language.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { toast } from 'svelte-sonner';
	import { useCreatePrintJob, usePrintJobStatus, useShelterPrinters } from '../application/queries';
	import { PrintApiError } from '../data/printers.api';
	import { stationPrinter } from '../application/station-printer.svelte';
	import { chunkLabels } from '../domain/chunk-labels';
	import { isTerminalJobStatus, PRINT_JOB_POLL_TIMEOUT_MS } from '../domain/print-job-status';
	import {
		PRINTERS_I18N,
		printJobOutcomeMessage,
		type PrintJobOutcome
	} from '../domain/printers.i18n';
	import PrinterPicker from './printer-picker.svelte';

	let {
		shelterCode,
		labelCount,
		source,
		renderLabels,
		label,
		buttonClass
	}: {
		shelterCode: string;
		labelCount: number;
		source: 'walk_in' | 'evacuee_qr';
		renderLabels: () => Promise<string[]>;
		label?: string;
		/** Extra classes for the main button (e.g. full width in a modal). */
		buttonClass?: string;
	} = $props();

	const t = $derived(getTranslation(PRINTERS_I18N, languageStore.current));

	const printersQuery = useShelterPrinters(() => shelterCode);
	const printers = $derived(printersQuery.data?.printers ?? []);
	const disconnected = $derived(endpointStore.status === 'disconnected');
	const chosenId = $derived(stationPrinter.get(shelterCode));
	const chosen = $derived(printers.find((p) => p.id === chosenId));

	const createJob = useCreatePrintJob();

	let pickerOpen = $state(false);
	let running = $state(false);
	let progressTotal = $state(0);
	let jobId = $state<string>();

	const statusQuery = usePrintJobStatus(() => jobId);

	// The send loop awaits one job at a time; this effect hands it the job's final status.
	let settleJob: ((outcome: PrintJobOutcome) => void) | null = null;
	$effect(() => {
		const data = statusQuery.data;
		if (data && isTerminalJobStatus(data.status)) {
			settleJob?.({ status: data.status, printed: data.printed, error_code: data.error_code });
		}
	});

	function waitForJob(): Promise<PrintJobOutcome> {
		return new Promise((resolve) => {
			const settle = (outcome: PrintJobOutcome) => {
				clearTimeout(timer);
				settleJob = null;
				resolve(outcome);
			};
			// The status query stops polling after the same window; a job still pending then is lost.
			const timer = setTimeout(
				() => settle({ status: 'timeout', printed: 0, error_code: null }),
				PRINT_JOB_POLL_TIMEOUT_MS
			);
			settleJob = settle;
		});
	}

	// Chunks still to send. Non-null only after a failure, so the retry resumes where it stopped
	// without rendering the labels again.
	let unsent = $state.raw<string[][] | null>(null);
	let printedTotal = $state(0);
	const progressDone = $derived(printedTotal + (statusQuery.data?.printed ?? 0));

	const blocked = $derived(running || disconnected || (chosen !== undefined && !chosen.online));
	const buttonLabel = $derived(
		running
			? t.printingProgress(progressDone, progressTotal)
			: unsent
				? t.retry
				: (label ?? (chosen ? t.printAt(labelCount, chosen.name) : t.choosePrinter))
	);

	async function handleClick() {
		if (running) return;
		if (!chosen) {
			pickerOpen = true;
			return;
		}
		const printer = chosen;
		running = true;
		if (!unsent) {
			progressTotal = labelCount;
			printedTotal = 0;
			try {
				const labels = await renderLabels();
				progressTotal = labels.length;
				unsent = chunkLabels(labels);
			} catch {
				running = false;
				toast.error(t.renderFailed);
				return;
			}
		}
		await sendUnsent(printer);
	}

	async function sendUnsent(printer: { id: string; name: string }) {
		const pending = [...(unsent ?? [])];
		while (pending.length > 0) {
			let created;
			try {
				created = await createJob.mutateAsync({
					printer_id: printer.id,
					source,
					labels: pending[0]
				});
			} catch (error) {
				unsent = pending;
				running = false;
				toast.error(
					error instanceof PrintApiError && error.code === 'PRINTER_OFFLINE'
						? t.printerOffline(printer.name)
						: t.sendFailed(printer.name)
				);
				return;
			}
			jobId = created.job_id;
			const outcome = await waitForJob();
			jobId = undefined;
			printedTotal += outcome.printed;
			if (outcome.status !== 'printed') {
				unsent = pending;
				running = false;
				toast.error(
					printJobOutcomeMessage(
						{ ...outcome, printed: printedTotal },
						printer.name,
						languageStore.current
					)
				);
				return;
			}
			pending.shift();
		}
		unsent = null;
		running = false;
		toast.success(
			printJobOutcomeMessage(
				{ status: 'printed', printed: printedTotal, error_code: null },
				printer.name,
				languageStore.current
			)
		);
	}

	function handleSelect(printerId: string) {
		stationPrinter.set(shelterCode, printerId);
		pickerOpen = false;
	}
</script>

{#if printers.length > 0}
	<div class="flex flex-col gap-1">
		<Button type="button" class={buttonClass} disabled={blocked} onclick={handleClick}>
			{#if running}<LoaderCircle class="mr-1.5 size-4 animate-spin" />{/if}
			{buttonLabel}
		</Button>
		{#if disconnected}
			<p class="text-sm text-muted-foreground">{t.disconnectedHint}</p>
		{:else if chosen && !chosen.online}
			<p class="text-sm text-muted-foreground">{t.printerOffline(chosen.name)}</p>
		{/if}
		{#if chosen && !pickerOpen}
			<Button
				type="button"
				variant="link"
				class="h-auto self-start p-0"
				onclick={() => (pickerOpen = true)}
			>
				{t.changePrinter}
			</Button>
		{/if}
		{#if pickerOpen}
			<PrinterPicker {printers} selectedId={chosenId} onSelect={handleSelect} />
		{/if}
	</div>
{/if}
