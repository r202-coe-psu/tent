<script lang="ts">
	import X from '@lucide/svelte/icons/x';
	import Printer from '@lucide/svelte/icons/printer';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { previewImageAsPdf } from '$lib/utils/pdf';
	import { cn } from '$lib/utils/shadcn';
	import type { Evacuee } from '$lib/features/people';
	import {
		buildEvacueeQrLabel,
		formatPersonName,
		issueQrPayloads,
		useScreeningsByEvacuee
	} from '$lib/features/people';
	import { KIOSK_LABEL_MM, renderKioskQrLabelPng } from '$lib/features/kiosk';
	import { PrintLabelsButton, ReportedRenderError } from '$lib/features/printers';
	import { useShelter } from '$lib/features/shelters';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { getTranslation } from '$lib/utils/i18n';
	import { languageStore } from '$lib/stores/language.svelte';
	import { EVACUEE_QR_MODAL_I18N } from '../_constants/evacuee-qr-modal.i18n';
	import ModalEscapeListener from '../shared/modal-escape-listener.svelte';

	const t = $derived(getTranslation(EVACUEE_QR_MODAL_I18N, languageStore.current));

	let {
		show,
		evacuee,
		onClose,
		embedded = false,
		dismissible = true,
		printable = true,
		closeLabel,
		qrSource = 'profile',
		printSource = 'evacuee_qr',
		stationOnly = false,
		onLockedChange,
		issuedPayload = $bindable()
	}: {
		show: boolean;
		evacuee: Evacuee;
		onClose: () => void;
		embedded?: boolean;
		dismissible?: boolean;
		/** Shows the station-printer button. Off where the host prints these labels itself. */
		printable?: boolean;
		closeLabel?: string;
		/** Log source of the entry written when printing (CR-233): batch page uses `family_batch`. */
		qrSource?: 'profile' | 'family_batch';
		/** Print-job source for the station printer (permission check). */
		printSource?: 'walk_in' | 'evacuee_qr';
		/**
		 * Prints this one person through the station printer only (like the family button), labelled
		 * "print ID card", with no PDF button. Needs `printable`.
		 */
		stationOnly?: boolean;
		/** Reports while a print run, or a sent job that may still print, is pending. */
		onLockedChange?: (locked: boolean) => void;
		/**
		 * The latest QR issued for this person. Bind it when a host issues QRs outside this modal
		 * (family print), so the preview never shows a QR that has since been rotated out.
		 */
		issuedPayload?: string;
	} = $props();

	const effectiveCloseLabel = $derived(closeLabel ?? t.closeWindow);

	let isExportingPdf = $state(false);
	// Closing mid-print, or while a job already sent may still print, would drop the button's
	// follow-up state while the job stays queued, so printing again after reopening would print the
	// labels twice: the modal stays open until the run ends and the follow-up is resolved.
	let printing = $state(false);
	let retryHeld = $state(false);
	const locked = $derived(printing || retryHeld);

	$effect(() => {
		onLockedChange?.(locked);
	});

	const shelterCode = $derived(shelterStore.selectedShelterCode ?? getShelterCode());

	const fullId = $derived(evacuee._id.split(':')[1] ?? evacuee._id);
	const name = $derived(formatPersonName(evacuee));
	const titleId = $derived(`evacuee-qr-title-${fullId}`);

	// Blank until Station 3 assigns a zone, so staff can write it on the printed label.
	const shelterQuery = useShelter(() => shelterStore.selectedShelterCode ?? getShelterCode());
	// A screening record ticks คัดกรอง on the label.
	const screeningsQuery = useScreeningsByEvacuee(
		() => evacuee._id,
		() => show
	);

	// The QR issued by the latest print click. It is the only valid one (older ones are rotated
	// out), so the preview shows it instead of the placeholder once a print has issued one.
	function labelContent(qrPayload?: string) {
		return buildEvacueeQrLabel(evacuee, {
			zones: shelterQuery.data?.zones,
			hasScreening: (screeningsQuery.data?.length ?? 0) > 0,
			qrPayload
		});
	}

	/**
	 * The kiosk's own 80×60 mm label (base64 PNG) with a QR PLACEHOLDER: opening the modal must not
	 * issue a QR (CR-233 FR-EQR-21a), so the preview shows the layout but no usable payload.
	 */
	const labelPng = $derived.by(() => {
		if (!show) return null;
		const { qrPayload, label } = labelContent(issuedPayload);
		return renderKioskQrLabelPng(qrPayload, label);
	});

	/**
	 * Print click only (FR-EQR-21b): issue a fresh QR (writes the log entry), then render the label
	 * with the real payload. Nothing is cached, so every print click rotates the QR. Throws, after a
	 * toast, when the item was not issued so nothing is printed.
	 */
	async function renderIssuedLabelPng(): Promise<string> {
		let payload: string | undefined;
		try {
			const issued = await issueQrPayloads({
				shelterCode,
				source: qrSource,
				evacueeIds: [evacuee._id]
			});
			payload = issued.payloads.get(evacuee._id);
		} catch {
			payload = undefined;
		}
		if (!payload) {
			toast.error(t.issueFailedToast);
			throw new ReportedRenderError('QR was not issued');
		}
		issuedPayload = payload;
		const { qrPayload, label } = labelContent(payload);
		return renderKioskQrLabelPng(qrPayload, label);
	}

	async function renderStationLabels(): Promise<string[]> {
		return [await renderIssuedLabelPng()];
	}

	async function handlePrintPreview() {
		if (!labelPng) return;
		// Open while the click still has user activation; opening after the render finishes can be
		// treated as an unsolicited popup, especially outside localhost.
		const previewWindow = window.open('', '_blank');
		if (!previewWindow) {
			toast.error(t.pdfBlockedToast);
			return;
		}

		isExportingPdf = true;
		try {
			const png = await renderIssuedLabelPng();
			previewImageAsPdf(`data:image/png;base64,${png}`, `evacuee-id-${fullId}`, {
				widthMm: KIOSK_LABEL_MM.width,
				heightMm: KIOSK_LABEL_MM.height,
				previewWindow
			});
		} catch (err) {
			previewWindow.close();
			// An issue failure already toasted its own message.
			if (!(err instanceof ReportedRenderError)) {
				toast.error(t.pdfFailedToast);
			}
		} finally {
			isExportingPdf = false;
		}
	}
</script>

{#if show}
	{#if dismissible}
		<ModalEscapeListener open={show} disabled={locked} onEscape={onClose} />
	{/if}
	<div
		class={embedded
			? 'w-full py-2'
			: 'fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/60 p-3 backdrop-blur-xs sm:p-6'}
	>
		<div
			role={embedded ? undefined : 'dialog'}
			aria-modal={embedded ? undefined : 'true'}
			aria-labelledby={titleId}
			class={cn(
				'w-full max-w-lg rounded-2xl border border-slate-200/80 bg-white p-4 sm:p-6',
				embedded ? 'shadow-2xs' : 'my-auto animate-in shadow-md duration-150 zoom-in-95 fade-in'
			)}
		>
			<div class="mb-4 flex items-start justify-between gap-3">
				<div class="min-w-0">
					<h2 id={titleId} class="text-lg font-bold text-slate-900 sm:text-xl">
						{t.cardTitle}
					</h2>
					<p class="truncate text-sm text-slate-500">{name}</p>
				</div>
				{#if !embedded && dismissible}
					<Button
						variant="ghost"
						size="icon"
						class="size-11 shrink-0 text-slate-500 hover:text-slate-900"
						disabled={locked}
						onclick={onClose}
					>
						<X class="size-5" />
						<span class="sr-only">{effectiveCloseLabel}</span>
					</Button>
				{/if}
			</div>

			<!-- Label preview: the same image that prints -->
			<figure class="rounded-xl border border-slate-200/80 bg-slate-50 p-3 sm:p-4">
				<div
					class="mx-auto aspect-4/3 w-full max-w-sm overflow-hidden rounded-md border border-slate-300 bg-white shadow-2xs"
				>
					{#if labelPng}
						{#await labelPng}
							<div class="size-full animate-pulse bg-slate-100"></div>
						{:then png}
							<img
								src="data:image/png;base64,{png}"
								alt={t.qrAlt(name)}
								class="size-full object-contain"
							/>
						{:catch}
							<div
								class="flex size-full items-center justify-center p-4 text-center text-sm text-slate-500"
							>
								{t.labelRenderFailed}
							</div>
						{/await}
					{/if}
				</div>
				<figcaption class="mt-3 text-center text-sm text-slate-500">
					<span class="font-semibold text-slate-700">{t.labelSize}</span>
					· {t.printHint}
					<span class="mt-1 block text-slate-600"
						>{issuedPayload ? t.printedNote : t.previewNote}</span
					>
				</figcaption>
			</figure>

			<div class="mt-5 flex flex-col gap-2">
				{#if printable && labelPng}
					<PrintLabelsButton
						bind:printing
						bind:retryHeld
						{shelterCode}
						labelCount={1}
						source={printSource}
						renderLabels={renderStationLabels}
						label={stationOnly ? t.printIdCard : undefined}
						buttonClass="h-12 w-full gap-2 text-base"
					/>
				{/if}
				{#if !stationOnly}
					<Button
						class="h-12 w-full gap-2 text-base"
						onclick={handlePrintPreview}
						disabled={isExportingPdf || !labelPng}
					>
						<Printer class="size-4" />
						{isExportingPdf ? t.generatingPdf : t.printIdCard}
					</Button>
				{/if}
				{#if dismissible}
					<Button
						variant="ghost"
						class="h-11 w-full text-slate-600"
						disabled={locked}
						onclick={onClose}
					>
						{effectiveCloseLabel}
					</Button>
				{/if}
			</div>
		</div>
	</div>
{/if}
