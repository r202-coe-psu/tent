<script lang="ts">
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import { Button } from '$lib/components/ui/button/index.js';
	import { authStore } from '$lib/stores/auth.svelte';
	import { endpointStore } from '$lib/stores/endpoint.svelte';
	import { languageStore } from '$lib/stores/language.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { toast } from 'svelte-sonner';
	import { useCreatePrintJob, usePrintJobStatus, useShelterPrinters } from '../application/queries';
	import { PrintApiError } from '../data/printers.api';
	import { stationPrinter } from '../application/station-printer.svelte';
	import { chunkLabels } from '../domain/chunk-labels';
	import { canPrintSource } from '../domain/print-permission';
	import { isTerminalJobStatus, PRINT_JOB_POLL_TIMEOUT_MS } from '../domain/print-job-status';
	import { PRINT_JOB_PICKUP_HINT_MS } from '../domain/print-job-timing';
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

	// FR-29a: without the right role the printer UI is hidden (the caller keeps its PDF preview).
	const canPrint = $derived(canPrintSource(authStore.user?.roles ?? [], shelterCode, source));

	const printersQuery = useShelterPrinters(() => (canPrint ? shelterCode : undefined));
	const printers = $derived(printersQuery.data?.printers ?? []);
	const disconnected = $derived(endpointStore.status === 'disconnected');
	const chosenId = $derived(stationPrinter.get(shelterCode));
	const chosen = $derived(printers.find((p) => p.id === chosenId));

	const createJob = useCreatePrintJob();

	let pickerOpen = $state(false);
	let running = $state(false);
	let progressTotal = $state(0);
	let job = $state<{ jobId: string; shelterCode: string }>();

	const statusQuery = usePrintJobStatus(() => job);

	// Set while the job waits longer than a healthy Pi takes to claim it; cleared when it settles.
	let pickupLate = $state(false);
	let sendingTo = $state('');
	const notPickedUp = $derived(running && pickupLate && statusQuery.data?.status !== 'printing');

	// The send loop awaits one job at a time; this effect hands it every status update and the
	// wait started by `waitForJob` decides which one settles the job.
	let onStatus: ((data: NonNullable<typeof statusQuery.data>) => void) | null = null;
	$effect(() => {
		const data = statusQuery.data;
		if (data) onStatus?.(data);
	});

	/**
	 * Resolves on the job's final status, or on `printing` (Pi claimed it) when `untilClaimed`.
	 * Resolves `null` as soon as `signal` aborts (cancel button / unmount), dropping every timer.
	 */
	function waitForJob(untilClaimed: boolean, signal: AbortSignal): Promise<PrintJobOutcome | null> {
		return new Promise((resolve) => {
			const settle = (outcome: PrintJobOutcome | null) => {
				clearTimeout(timer);
				clearTimeout(hintTimer);
				signal.removeEventListener('abort', onAbort);
				onStatus = null;
				pickupLate = false;
				resolve(outcome);
			};
			const onAbort = () => settle(null);
			// The status query stops polling after the same window; a job still pending then is lost.
			const timer = setTimeout(
				() => settle({ status: 'timeout', printed: 0, error_code: null }),
				PRINT_JOB_POLL_TIMEOUT_MS
			);
			const hintTimer = setTimeout(() => (pickupLate = true), PRINT_JOB_PICKUP_HINT_MS);
			onStatus = (data) => {
				if (isTerminalJobStatus(data.status) || (untilClaimed && data.status === 'printing')) {
					settle({ status: data.status, printed: data.printed, error_code: data.error_code });
				}
			};
			if (signal.aborted) settle(null);
			else signal.addEventListener('abort', onAbort, { once: true });
		});
	}

	// One controller per print run. Aborted by the cancel button (reason 'cancel') or when the
	// component goes away (reason 'unmount'): the send loop then stops creating further jobs.
	let runAbort: AbortController | null = null;
	$effect(() => () => runAbort?.abort('unmount'));

	function handleCancel() {
		runAbort?.abort('cancel');
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
		const abort = new AbortController();
		runAbort = abort;
		running = true;
		if (!unsent) {
			progressTotal = labelCount;
			printedTotal = 0;
			try {
				const labels = await renderLabels();
				if (abort.signal.aborted) return finishAborted(abort.signal);
				progressTotal = labels.length;
				unsent = chunkLabels(labels);
			} catch {
				if (abort.signal.aborted) return finishAborted(abort.signal);
				running = false;
				toast.error(t.renderFailed);
				return;
			}
		}
		await sendUnsent(printer, abort.signal);
	}

	/** Cancel/unmount: free the button; only a cancel the user asked for is announced. */
	function finishAborted(signal: AbortSignal) {
		if (signal.reason === 'unmount') return;
		job = undefined;
		running = false;
		toast.info(t.cancelled);
	}

	function sendErrorMessage(error: unknown, printerName: string): string {
		if (error instanceof PrintApiError) {
			if (error.code === 'PRINTER_OFFLINE') return t.printerOffline(printerName);
			if (error.code === 'FORBIDDEN') return t.forbidden;
		}
		return t.sendFailed(printerName);
	}

	async function sendUnsent(printer: { id: string; name: string }, signal: AbortSignal) {
		sendingTo = printer.name;
		const pending = [...(unsent ?? [])];
		while (pending.length > 0) {
			if (signal.aborted) {
				unsent = pending;
				return finishAborted(signal);
			}
			let created;
			try {
				created = await createJob.mutateAsync({
					printer_id: printer.id,
					source,
					labels: pending[0]
				});
			} catch (error) {
				unsent = pending;
				if (signal.aborted) return finishAborted(signal);
				running = false;
				toast.error(sendErrorMessage(error, printer.name));
				return;
			}
			if (signal.aborted) {
				// The job just created may still print, so it is not queued again on retry.
				unsent = pending.length > 1 ? pending.slice(1) : null;
				return finishAborted(signal);
			}
			job = { jobId: created.job_id, shelterCode: created.shelter_code };
			// Earlier chunks must finish first (the next one is only queued then, so it cannot expire
			// waiting behind them). The last chunk counts as sent once the Pi claims it: a failure after
			// that is checked at the printer, not on the tablet.
			const last = pending.length === 1;
			const outcome = await waitForJob(last, signal);
			job = undefined;
			if (!outcome) {
				// Aborted while waiting: the job in flight may still print, so only later chunks stay.
				unsent = pending.length > 1 ? pending.slice(1) : null;
				return finishAborted(signal);
			}
			printedTotal += outcome.printed;
			const sent = outcome.status === 'printed' || (last && outcome.status === 'printing');
			if (!sent) {
				// The labels a failed job already printed are not sent again on retry.
				const rest = pending[0].slice(outcome.printed);
				const remaining = rest.length > 0 ? [rest, ...pending.slice(1)] : pending.slice(1);
				unsent = remaining.length > 0 ? remaining : null;
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
		toast.success(t.sent(progressTotal, printer.name));
	}

	function handleSelect(printerId: string) {
		stationPrinter.set(shelterCode, printerId);
		pickerOpen = false;
	}
</script>

{#if canPrint && printers.length > 0}
	<div class="flex flex-col gap-1">
		<Button type="button" class={buttonClass} disabled={blocked} onclick={handleClick}>
			{#if running}<LoaderCircle class="mr-1.5 size-4 animate-spin" />{/if}
			{buttonLabel}
		</Button>
		{#if running}
			<Button type="button" variant="outline" class={buttonClass} onclick={handleCancel}>
				{t.cancel}
			</Button>
		{/if}
		{#if notPickedUp}
			<p class="text-sm text-muted-foreground" role="status">{t.notPickedUp(sendingTo)}</p>
		{/if}
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
