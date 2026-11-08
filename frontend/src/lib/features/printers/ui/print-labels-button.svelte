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
	import { ReportedRenderError } from '../domain/reported-error';
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
		printing: running = $bindable(false),
		retryHeld = $bindable(false)
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
		/**
		 * True between runs while a job already sent may still print (result unknown, or cancelled
		 * while waiting). Printing again follows that job up under its own id; unmounting forgets it,
		 * so a new run would print the labels twice. Bind it to keep the host open as with `printing`.
		 * It clears by itself when that job's printer leaves the active list (its open jobs were
		 * failed), so a host never stays locked with no button left to press.
		 */
		retryHeld?: boolean;
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

	// Chunks still to send, each with the job id it is created under. Non-null only after a failure
	// or a cancel, so the retry resumes where it stopped without rendering the labels again. The id
	// stays with the chunk across retries while the tablet does not know the job's outcome (create
	// not answered, cancelled, result unknown), so the BFF answers with the job it already wrote
	// instead of queueing a second.
	interface Chunk {
		labels: string[];
		jobId: string;
		/**
		 * Set while a job under this id may exist on this printer and its outcome is unknown: the
		 * create got no answer or a 5xx, the run was cancelled after sending it, or its result was
		 * unknown at the poll timeout. The retry goes there under the same id even if the user picked
		 * another printer meanwhile: a new id on another printer would print the labels twice
		 * (FR-29, FR-47).
		 */
		printerId?: string;
	}
	let unsent = $state.raw<Chunk[] | null>(null);
	function setUnsent(next: Chunk[] | null) {
		unsent = next && next.length > 0 ? next : null;
	}
	const lockedPrinterId = $derived(unsent?.[0]?.printerId);
	const lockedPrinter = $derived(printers.find((p) => p.id === lockedPrinterId));
	// A locked printer that left a list read successfully was deactivated or deleted, which fails its
	// open jobs, so the chunk is free to go to the chosen printer under a new id (FR-47). Without
	// the print UI (role lost) nothing can be printed here again, so nothing holds the host either.
	const lockGone = $derived(
		lockedPrinterId !== undefined && printersQuery.isSuccess && lockedPrinter === undefined
	);
	const held = $derived(lockedPrinterId !== undefined && canPrint && !lockGone);
	// Pushes the lock out through the binding; the printer list can end it with no click, and the
	// button that would clear it may be gone by then (no active printer left).
	$effect(() => {
		if (retryHeld !== held) retryHeld = held;
	});
	const target = $derived(lockedPrinter ?? chosen);
	let printedTotal = $state(0);
	const progressDone = $derived(printedTotal + (statusQuery.data?.printed ?? 0));

	// A locked printer that looks offline is still tried: the BFF answers a follow-up with the job it
	// already holds, or refuses with PRINTER_OFFLINE when it has none, which releases the lock.
	const blocked = $derived(
		running || disconnected || (target !== undefined && !target.online && !lockedPrinter)
	);
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
		if (lockGone && unsent) {
			// The old job was failed with its printer: a new id, so the server does not answer 409.
			setUnsent([{ labels: unsent[0].labels, jobId: ulid() }, ...unsent.slice(1)]);
		}
		const abort = new AbortController();
		runAbort = abort;
		running = true;
		if (!unsent) {
			progressTotal = labelCount;
			printedTotal = 0;
			try {
				// Cancel wins over a slow render (or the screenings fetch behind it): nothing was sent yet.
				const labels = await Promise.race([renderLabels(), whenAborted(abort.signal)]);
				if (abort.signal.aborted || !labels) return finishAborted(abort.signal, false);
				progressTotal = labels.length;
				setUnsent(chunkLabels(labels).map((chunk) => ({ labels: chunk, jobId: ulid() })));
			} catch (error) {
				if (abort.signal.aborted) return finishAborted(abort.signal, false);
				running = false;
				// The callback already toasted its own specific message.
				if (error instanceof ReportedRenderError) return;
				toast.error(t.renderFailed);
				return;
			}
		}
		await sendUnsent(printer, abort.signal);
	}

	function whenAborted(signal: AbortSignal): Promise<null> {
		return new Promise((resolve) => {
			if (signal.aborted) resolve(null);
			else signal.addEventListener('abort', () => resolve(null), { once: true });
		});
	}

	/**
	 * Cancel/unmount: free the button; only a cancel the user asked for is announced. `mayPrint`
	 * says whether a job of this run (or the one it follows up) may still print.
	 */
	function finishAborted(signal: AbortSignal, mayPrint: boolean) {
		if (signal.reason === 'unmount') return;
		job = undefined;
		running = false;
		toast.info(mayPrint ? t.cancelled : t.cancelledBeforeSend);
	}

	function sendErrorMessage(error: unknown, printerName: string): string {
		if (error instanceof PrintApiError) {
			if (error.code === 'PRINTER_OFFLINE') return t.printerOffline(printerName);
			if (error.code === 'FORBIDDEN') return t.forbidden;
			if (error.code === 'UNAUTHENTICATED') return t.sessionExpired;
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

	// Refusals that free a locked chunk: the printer is offline (a job it held would be answered
	// instead), gone (its open jobs were failed), or the request is invalid (the same body was
	// refused before, so it never queued). FORBIDDEN may follow a job queued before the role was
	// lost, but every printer of this shelter refuses the same caller, so no second job can follow;
	// keeping the lock would only leave the host stuck. Other 4xx (a lapsed session, a proxy's 429)
	// say nothing about the earlier attempt, so the lock stays. A chunk never locked had no job yet.
	const NO_JOB_CODES = new Set([
		'PRINTER_OFFLINE',
		'PRINTER_NOT_FOUND',
		'INVALID_LABELS',
		'FORBIDDEN'
	]);
	function isNoJobRefusal(error: unknown, chunk: Chunk): boolean {
		if (!(error instanceof PrintApiError) || error.status >= 500) return false;
		return chunk.printerId === undefined || NO_JOB_CODES.has(error.code ?? '');
	}

	async function sendUnsent(printer: { id: string; name: string }, signal: AbortSignal) {
		sendingTo = printer.name;
		const pending = [...(unsent ?? [])];
		let createdAny = false;
		while (pending.length > 0) {
			if (signal.aborted) {
				setUnsent(pending);
				return finishAborted(signal, createdAny || pending[0].printerId !== undefined);
			}
			let created;
			try {
				created = await postChunk(printer.id, pending[0], signal);
			} catch (error) {
				// Same chunk, same id on retry, unless the server says that id is another job's.
				if (error instanceof PrintApiError && error.code === 'JOB_ID_CONFLICT') {
					pending[0] = { labels: pending[0].labels, jobId: ulid() };
				} else if (isNoJobRefusal(error, pending[0])) {
					// A definite refusal: no job holds this id here, so the chunk may go to any printer.
					pending[0] = { labels: pending[0].labels, jobId: pending[0].jobId };
				} else {
					// No definite refusal: the job may be queued on this printer, so the retry stays here.
					pending[0] = { ...pending[0], printerId: printer.id };
				}
				setUnsent(pending);
				if (signal.aborted) return finishAborted(signal, true);
				running = false;
				toast.error(sendErrorMessage(error, printer.name));
				return;
			}
			createdAny = true;
			if (signal.aborted) {
				// The job just created may still print: the retry follows it under its own id (FR-47).
				setUnsent([{ ...pending[0], printerId: printer.id }, ...pending.slice(1)]);
				return finishAborted(signal, true);
			}
			job = { jobId: created.job_id, shelterCode: created.shelter_code };
			// Earlier chunks must finish first (the next one is only queued then, so it cannot expire
			// waiting behind them). The last chunk counts as sent once the Pi claims it: a failure after
			// that is checked at the printer, not on the tablet.
			const last = pending.length === 1;
			const outcome = await waitForJob(last, signal);
			job = undefined;
			if (!outcome) {
				// Aborted while waiting: the job may still print, so the retry follows it (FR-47).
				setUnsent([{ ...pending[0], printerId: printer.id }, ...pending.slice(1)]);
				return finishAborted(signal, true);
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
				setUnsent(remaining);
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
		setUnsent(null);
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
		{:else if !running && lockGone}
			<p class="text-sm text-muted-foreground" role="status">{t.lockedPrinterGone}</p>
		{/if}
		{#if disconnected}
			<p class="text-sm text-muted-foreground">{t.disconnectedHint}</p>
		{:else if target && !target.online}
			<p class="text-sm text-muted-foreground">{t.printerOffline(target.name)}</p>
		{/if}
		{#if chosen && !pickerOpen}
			<div class="flex flex-wrap items-baseline gap-x-2 self-start text-sm">
				<span class="text-muted-foreground" data-testid="chosen-printer-name">{chosen.name}</span>
				<Button
					type="button"
					variant="link"
					class="h-auto p-0 underline"
					onclick={() => (pickerOpen = true)}
				>
					{t.changePrinter}
				</Button>
			</div>
		{/if}
		{#if pickerOpen}
			<PrinterPicker {printers} selectedId={chosenId} onSelect={handleSelect} />
		{/if}
	</div>
{/if}
