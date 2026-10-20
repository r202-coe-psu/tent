<script lang="ts">
	import X from '@lucide/svelte/icons/x';
	import Printer from '@lucide/svelte/icons/printer';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { previewImageAsPdf } from '$lib/utils/pdf';
	import { cn } from '$lib/utils/shadcn';
	import type { Evacuee } from '$lib/features/people';
	import {
		formatPersonName,
		intakeStationsPassed,
		labelZoneName,
		useScreeningsByEvacuee
	} from '$lib/features/people';
	import { KIOSK_LABEL_MM, renderKioskQrLabelPng } from '$lib/features/kiosk';
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
		closeLabel
	}: {
		show: boolean;
		evacuee: Evacuee;
		onClose: () => void;
		embedded?: boolean;
		dismissible?: boolean;
		closeLabel?: string;
	} = $props();

	const effectiveCloseLabel = $derived(closeLabel ?? t.closeWindow);

	let isExportingPdf = $state(false);

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

	/**
	 * The kiosk's own 80×60 mm label (base64 PNG): the preview shows exactly what prints, and a
	 * station label printer gets the same page as the kiosk.
	 */
	const labelPng = $derived(
		show
			? renderKioskQrLabelPng(evacuee._id, {
					name,
					zone: labelZoneName(evacuee.current_stay?.zone, shelterQuery.data?.zones),
					checklist: [t.checklistCheckIn, t.checklistScreening, t.checklistLodging],
					checkedCount: intakeStationsPassed(
						evacuee.current_stay,
						(screeningsQuery.data?.length ?? 0) > 0
					)
				})
			: null
	);

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
			const png = await labelPng;
			previewImageAsPdf(`data:image/png;base64,${png}`, `evacuee-id-${fullId}`, {
				widthMm: KIOSK_LABEL_MM.width,
				heightMm: KIOSK_LABEL_MM.height,
				previewWindow
			});
		} catch {
			previewWindow.close();
			toast.error(t.pdfFailedToast);
		} finally {
			isExportingPdf = false;
		}
	}
</script>

{#if show}
	{#if dismissible}
		<ModalEscapeListener open={show} onEscape={onClose} />
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
				</figcaption>
			</figure>

			<div class="mt-5 flex flex-col gap-2">
				<Button
					class="h-12 w-full gap-2 text-base"
					onclick={handlePrintPreview}
					disabled={isExportingPdf || !labelPng}
				>
					<Printer class="size-4" />
					{isExportingPdf ? t.generatingPdf : t.printIdCard}
				</Button>
				{#if dismissible}
					<Button variant="ghost" class="h-11 w-full text-slate-600" onclick={onClose}>
						{effectiveCloseLabel}
					</Button>
				{/if}
			</div>
		</div>
	</div>
{/if}
