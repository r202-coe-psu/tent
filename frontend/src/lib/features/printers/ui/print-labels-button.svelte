<script lang="ts">
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import { Button } from '$lib/components/ui/button/index.js';
	import { ulid } from '$lib/db/ulid';
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
	import {
		PRINT_JOB_CREATE_TIMEOUT_MS,
		PRINT_JOB_FINAL_CHECK_MS,
		PRINT_JOB_PICKUP_HINT_MS
	} from '../domain/print-job-timing';
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
		buttonClass,
		printing: running = $bindable(false)
	}: {
		shelterCode: string;
		labelCount: number;
		source: 'walk_in' | 'evacuee_qr';
		renderLabels: () => Promise<string[]>;
		label?: string;
		/** Extra classes for the main button (e.g. full width in a modal). */
		buttonClass?: string;
		/**
		 * True while a print run is in progress. Bind it to keep the host open meanwhile: unmounting
		 * stops polling but not the queued job, so printing again after reopening duplicates labels.
		 */
		printing?: boolean;
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
	let progressTotal = $state(0);
	let job = $state<{ jobId: string; shelterCode: string }>();

	const statusQuery = usePrintJobStatus(() => job);

	// Set while the job waits longer than a healthy Pi takes to claim it; cleared when it settles.
	let pickupLate = $state(false);
	// Set while the latest status fetch failed: the result is unknown, so no retry is offered (the
	// job may still print) until the poll timeout settles it (FR-45).
	let statusUnreachable = $state(false);
	let sendingTo = $state('');
	const notPickedUp = $derived(
		running && pickupLate && !statusUnreachable && statusQuery.data?.status !== 'printing'
	);

	// The send loop awaits one job at a time; this effect hands it every status update and the
	// wait started by `waitForJob` decides which one settles the job. Settling writes state
	// (`pickupLate`) from inside the effect on purpose: it bridges the query into the awaited
	// Promise, and `$derived` cannot resolve a Promise.
	interface StatusUpdate {
		data: typeof statusQuery.data;
		/** Bumped by every successful / failed fetch (a refetch after an error resets `isError`). */
		dataUpdatedAt: number;
		errorUpdatedAt: number;
	}
	let onStatus: ((update: StatusUpdate) => void) | null = null;
	$effect(() => {
		// Read first: `onStatus?.(...)` skips its arguments while null, which would track nothing.
		const update: StatusUpdate = {
			data: statusQuery.data,
			dataUpdatedAt: statusQuery.dataUpdatedAt,
			errorUpdatedAt: statusQuery.errorUpdatedAt
		};
		onStatus?.(update);
	});

	/**
	 * Resolves on the job's final status, or on `printing` (Pi claimed it) when `untilClaimed`.
	 * Failed status fetches never end the wait: polling goes on until the job settles or the poll
	 * timeout passes, because the job may still print and a retry before then would duplicate labels.
	 * Resolves `null` as soon as `signal` aborts (cancel button / unmount), dropping every timer.
	 */
	function waitForJob(untilClaimed: boolean, signal: AbortSignal): Promise<PrintJobOutcome | null> {
		return new Promise((resolve) => {
			let done = false;
			const settle = (outcome: PrintJobOutcome | null) => {
				if (done) return;
				done = true;
				clearTimeout(timer);
				clearTimeout(hintTimer);
				clearTimeout(finalCheckTimer);
				signal.removeEventListener('abort', onAbort);
				onStatus = null;
				pickupLate = false;
				statusUnreachable = false;
				resolve(outcome);
			};
			const onAbort = () => settle(null);
			/** Settles on a final status (or the claim, for the last chunk); false otherwise. */
			const settleOnStatus = (data: typeof statusQuery.data): boolean => {
				if (!data) return false;
				if (!isTerminalJobStatus(data.status) && !(untilClaimed && data.status === 'printing')) {
					return false;
				}
				settle({ status: data.status, printed: data.printed, error_code: data.error_code });
				return true;
			};
			// The status query stops polling after the same window. By then the server has settled the
			// job, so one more status fetch tells the real outcome if the network is back. A job still
			// open then timed out; a fetch that fails or hangs leaves the result unknown. Either way the
			// retry follows up the same job instead of sending a new one (CR-222 FR-47).
			let finalCheckTimer: ReturnType<typeof setTimeout> | undefined;
			const finalCheck = async () => {
				const giveUp = new Promise<undefined>((r) => {
					finalCheckTimer = setTimeout(() => r(undefined), PRINT_JOB_FINAL_CHECK_MS);
				});
				const latest = await Promise.race([
					statusQuery.refetch().then((r) => (r.isSuccess ? r.data : undefined)),
					giveUp
				]);
				if (done || settleOnStatus(latest)) return;
				const status = latest ? 'timeout' : 'unknown';
				settle({ status, printed: 0, error_code: null });
			};
			const timer = setTimeout(() => void finalCheck(), PRINT_JOB_POLL_TIMEOUT_MS);
			const hintTimer = setTimeout(() => (pickupLate = true), PRINT_JOB_PICKUP_HINT_MS);
			let seenDataAt = 0;
			let seenErrorAt = 0;
			onStatus = ({ data, dataUpdatedAt, errorUpdatedAt }) => {
				if (settleOnStatus(data)) return;
				// Each fetch result counts once, however often the effect re-runs.
				if (dataUpdatedAt !== seenDataAt) {
					seenDataAt = dataUpdatedAt;
					statusUnreachable = false;
				}
				if (errorUpdatedAt !== seenErrorAt) {
					seenErrorAt = errorUpdatedAt;
					statusUnreachable = true;
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

	// Chunks still to send, each with the job id it is created under. Non-null only after a failure,
	// so the retry resumes where it stopped without rendering the labels again. The id stays with
	// the chunk across retries of a create whose outcome the tablet never saw (cancel, timeout,
	// network), so the BFF can answer with the job it already wrote instead of queueing a second.
	interface Chunk {
		labels: string[];
		jobId: string;
		/**
		 * Set while the create may already be written on this printer (no answer, cancel, 5xx). The
		 * retry goes there under the same id even if the user picked another printer meanwhile:
		 * a new id on another printer would print the labels twice (FR-29).
		 */
		printerId?: string;
	}
	let unsent = $state.raw<Chunk[] | null>(null);
	// A locked printer that left the list (deactivated / deleted) has had its open jobs failed, so
	// the chunk is free to go to the chosen printer.
	const lockedPrinter = $derived(printers.find((p) => p.id === unsent?.[0]?.printerId));
	const target = $derived(lockedPrinter ?? chosen);
	let printedTotal = $state(0);
	const progressDone = $derived(printedTotal + (statusQuery.data?.printed ?? 0));

	const blocked = $derived(running || disconnected || (target !== undefined && !target.online));
	const buttonLabel = $derived(
		running
			? t.printingProgress(progressDone, progressTotal)
			: unsent
				? t.retry
				: (label ?? (chosen ? t.printAt(labelCount, chosen.name) : t.choosePrinter))
	);

	async function handleClick() {
		if (running) return;
		if (!target) {
			pickerOpen = true;
			return;
		}
		const printer = target;
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
				unsent = chunkLabels(labels).map((chunk) => ({ labels: chunk, jobId: ulid() }));
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

	/**
	 * One create POST, aborted by the run's `signal` (cancel / unmount) or after
	 * `PRINT_JOB_CREATE_TIMEOUT_MS`, so the button never hangs at "printing 0/N" on a stalled request.
	 */
	async function postChunk(printerId: string, chunk: Chunk, signal: AbortSignal) {
		const attempt = new AbortController();
		const forward = () => attempt.abort(signal.reason);
		signal.addEventListener('abort', forward, { once: true });
		const timer = setTimeout(
			() => attempt.abort(new Error('create timed out')),
			PRINT_JOB_CREATE_TIMEOUT_MS
		);
		try {
			return await createJob.mutateAsync({
				input: { job_id: chunk.jobId, printer_id: printerId, source, labels: chunk.labels },
				signal: attempt.signal
			});
		} finally {
			clearTimeout(timer);
			signal.removeEventListener('abort', forward);
		}
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
				created = await postChunk(printer.id, pending[0], signal);
			} catch (error) {
				// Same chunk, same id on retry, unless the server says that id is another job's.
				if (error instanceof PrintApiError && error.code === 'JOB_ID_CONFLICT') {
					pending[0] = { labels: pending[0].labels, jobId: ulid() };
				} else if (!(error instanceof PrintApiError && error.status < 500)) {
					// No definite refusal: the job may be queued on this printer, so the retry stays here.
					pending[0] = { ...pending[0], printerId: printer.id };
				}
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
			const unsure = outcome.status === 'unknown' || outcome.status === 'timeout';
			if (!unsure) printedTotal += outcome.printed;
			const sent = outcome.status === 'printed' || (last && outcome.status === 'printing');
			if (!sent) {
				let remaining: Chunk[];
				if (unsure) {
					// The job may still be queued or printing, and its printed count is only known once it
					// ends. The retry re-sends the same id to the same printer: the BFF answers with that
					// job, and polling it gives the real outcome without printing anything twice.
					remaining = [{ ...pending[0], printerId: printer.id }, ...pending.slice(1)];
				} else {
					// The job is over: the labels it printed are not sent again, and the rest goes out
					// as a new job under a new id.
					const rest = pending[0].labels.slice(outcome.printed);
					remaining =
						rest.length > 0
							? [{ labels: rest, jobId: ulid() }, ...pending.slice(1)]
							: pending.slice(1);
				}
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
		{#if running && statusUnreachable}
			<p class="text-sm text-muted-foreground" role="status">{t.statusUnknown(sendingTo)}</p>
		{:else if notPickedUp}
			<p class="text-sm text-muted-foreground" role="status">{t.notPickedUp(sendingTo)}</p>
		{:else if !running && lockedPrinter && lockedPrinter.id !== chosen?.id}
			<p class="text-sm text-muted-foreground" role="status">
				{t.retryLockedTo(lockedPrinter.name)}
			</p>
		{/if}
		{#if disconnected}
			<p class="text-sm text-muted-foreground">{t.disconnectedHint}</p>
		{:else if target && !target.online}
			<p class="text-sm text-muted-foreground">{t.printerOffline(target.name)}</p>
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
