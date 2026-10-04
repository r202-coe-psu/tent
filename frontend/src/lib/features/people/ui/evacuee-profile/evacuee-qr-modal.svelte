<script lang="ts">
	import { tick } from 'svelte';
	import { generateQrDataUrl } from '$lib/utils/qrcode';
	import X from '@lucide/svelte/icons/x';
	import Printer from '@lucide/svelte/icons/printer';
	import { toast } from 'svelte-sonner';
	import { previewElementAsPdf } from '$lib/utils/pdf';
	import type { Evacuee } from '$lib/features/people';
	import { formatPersonName } from '$lib/features/people';
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

	let qrUrl = $state<string | null>(null);
	let cardEl = $state<HTMLDivElement | null>(null);
	let isExportingPdf = $state(false);

	async function handlePrintPreview() {
		if (!cardEl) return;
		// Open while the click still has user activation. Opening after html2canvas finishes
		// can be treated as an unsolicited popup, especially outside localhost.
		const previewWindow = window.open('', '_blank');
		if (!previewWindow) {
			toast.error(t.pdfBlockedToast);
			return;
		}

		isExportingPdf = true;
		cardEl.classList.add('print-capture');
		try {
			await tick();
			await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
			await previewElementAsPdf(cardEl, `evacuee-id-${fullId}`, {
				maxWidthMm: 100,
				previewWindow
			});
		} catch (err) {
			previewWindow.close();
			toast.error(err instanceof Error ? err.message : t.pdfFailedToast);
		} finally {
			cardEl.classList.remove('print-capture');
			isExportingPdf = false;
		}
	}

	$effect(() => {
		if (!show) return;
		qrUrl = null;
		generateQrDataUrl(evacuee._id, {
			// Generate a larger source image so the QR remains crisp at every responsive size.
			width: 384,
			margin: 1,
			color: { dark: '#0f172a', light: '#ffffff' }
		}).then((url) => {
			qrUrl = url;
		});
	});

	const fullId = $derived(evacuee._id.split(':')[1] ?? evacuee._id);
	const phone = $derived(evacuee.phone?.trim() || null);
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
			class={embedded
				? 'w-full max-w-2xl rounded-3xl border border-border bg-white px-4 py-6 shadow-sm sm:px-8 sm:py-10 dark:bg-card'
				: 'my-auto w-full max-w-2xl animate-in rounded-3xl border border-border bg-white px-4 py-6 shadow-sm duration-150 zoom-in-95 fade-in sm:px-8 sm:py-10 dark:bg-card'}
		>
			{#if !embedded && dismissible}
				<div class="mb-2 flex justify-end">
					<button
						onclick={onClose}
						class="cursor-pointer rounded-lg p-1 text-muted-foreground transition-colors hover:text-foreground"
					>
						<X class="size-5" />
					</button>
				</div>
			{/if}

			<!-- Header -->
			<div class="mb-6 flex flex-col items-center gap-1 text-center sm:mb-8">
				<h2 class="text-2xl font-bold text-slate-900 dark:text-slate-50">
					{t.cardTitle}
				</h2>
				<p class="text-sm text-muted-foreground">
					{formatPersonName(evacuee)}
				</p>
			</div>

			<!-- ID card preview -->
			<div class="mb-6 rounded-2xl bg-slate-100 p-3 sm:p-6 dark:bg-slate-800">
				<div
					id="qr-identity-card-{fullId}"
					bind:this={cardEl}
					class="qr-identity-card mx-auto flex w-full max-w-[560px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-md sm:min-h-44 sm:flex-row dark:border-slate-700"
				>
					<div
						class="card-qr-panel order-1 flex w-full shrink-0 items-center justify-center border-b border-slate-200 bg-slate-50 px-5 py-5 sm:order-2 sm:w-auto sm:border-b-0 sm:border-l sm:px-5 dark:border-slate-700 dark:bg-slate-900/30"
					>
						{#if qrUrl}
							<img
								src={qrUrl}
								alt={t.qrAlt(formatPersonName(evacuee))}
								class="card-qr-image size-36 object-contain sm:size-36 md:size-40"
							/>
						{:else}
							<div
								class="flex size-36 items-center justify-center rounded bg-slate-100 text-2xs text-slate-400 sm:size-36 md:size-40"
							>
								...
							</div>
						{/if}
					</div>

					<div
						class="card-details order-2 flex min-w-0 flex-1 flex-col justify-start gap-0.5 px-4 py-5 sm:order-1 sm:min-h-44 sm:px-5"
					>
						<p class="card-name text-base leading-tight font-bold text-slate-900 sm:text-xl">
							{formatPersonName(evacuee)}
						</p>
						{#if phone}
							<span
								class="card-phone font-mono text-2xs font-bold tracking-widest text-slate-900 sm:text-xs"
							>
								{phone}
							</span>
						{/if}
						<div
							class="card-checklist mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-4 text-2xs font-medium text-slate-900 sm:text-xs"
						>
							<span class="inline-flex items-center gap-1.5">
								<span
									class="card-check-box size-3.5 shrink-0 border border-slate-900 sm:size-4"
									aria-hidden="true"
								></span>
								{t.checklistCheckIn}
							</span>
							<span class="inline-flex items-center gap-1.5">
								<span
									class="card-check-box size-3.5 shrink-0 border border-slate-900 sm:size-4"
									aria-hidden="true"
								></span>
								{t.checklistScreening}
							</span>
							<span class="inline-flex items-center gap-1.5">
								<span
									class="card-check-box size-3.5 shrink-0 border border-slate-900 sm:size-4"
									aria-hidden="true"
								></span>
								{t.checklistLodging}
							</span>
						</div>
					</div>
				</div>
			</div>

			<!-- Actions -->
			<div class="flex flex-col gap-3">
				<button
					onclick={handlePrintPreview}
					disabled={isExportingPdf}
					class="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#0d2240] py-3.5 text-sm font-semibold text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-60"
				>
					<Printer class="size-4" />
					{isExportingPdf ? t.generatingPdf : t.printIdCard}
				</button>
				{#if dismissible}
					<button
						onclick={onClose}
						class="cursor-pointer py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
					>
						{effectiveCloseLabel}
					</button>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	/* The PDF capture uses this fixed desktop card independently of the app viewport. */
	:global(.qr-identity-card.print-capture) {
		width: 760px !important;
		max-width: none !important;
		min-height: 210px !important;
		flex-direction: row !important;
	}

	:global(.qr-identity-card.print-capture .card-qr-panel) {
		order: 2 !important;
		width: auto !important;
		border-top: 0 !important;
		border-left: 1px solid #e2e8f0 !important;
		padding: 20px 28px !important;
	}

	:global(.qr-identity-card.print-capture .card-details) {
		order: 1 !important;
		justify-content: flex-start !important;
		padding: 24px 28px !important;
	}

	:global(.qr-identity-card.print-capture .card-qr-image) {
		height: 160px !important;
		width: 160px !important;
	}

	:global(.qr-identity-card.print-capture .card-phone) {
		font-size: 1rem !important;
		color: #0f172a !important;
	}

	:global(.qr-identity-card.print-capture .card-name) {
		font-size: 1.875rem !important;
	}

	:global(.qr-identity-card.print-capture .card-checklist) {
		font-size: 0.875rem !important;
		gap: 1rem !important;
		padding-top: 1.25rem !important;
	}

	:global(.qr-identity-card.print-capture .card-check-box) {
		height: 16px !important;
		width: 16px !important;
		border-color: #0f172a !important;
	}

	@media print {
		:global(body *) {
			visibility: hidden;
		}
		:global(.qr-identity-card),
		:global(.qr-identity-card *) {
			visibility: visible;
		}
		:global(.qr-identity-card) {
			position: absolute;
			left: 50%;
			top: 50%;
			width: 760px !important;
			max-width: none !important;
			min-height: 210px !important;
			flex-direction: row !important;
			transform: translate(-50%, -50%);
			border: 1px solid #ccc !important;
			box-shadow: none !important;
			background-color: #fff !important;
		}
		:global(.qr-identity-card .card-qr-panel) {
			order: 2 !important;
			width: auto !important;
			border-top: 0 !important;
			border-left: 1px solid #e2e8f0 !important;
			padding: 20px 28px !important;
		}
		:global(.qr-identity-card .card-details) {
			order: 1 !important;
			justify-content: flex-start !important;
			padding: 24px 28px !important;
		}
		:global(.qr-identity-card .card-qr-image) {
			height: 160px !important;
			width: 160px !important;
		}
		:global(.qr-identity-card .card-phone) {
			font-size: 1rem !important;
			color: #0f172a !important;
		}
		:global(.qr-identity-card .card-name) {
			font-size: 1.875rem !important;
		}
		:global(.qr-identity-card .card-checklist) {
			font-size: 0.875rem !important;
			gap: 1rem !important;
			padding-top: 1.25rem !important;
		}
		:global(.qr-identity-card .card-check-box) {
			height: 16px !important;
			width: 16px !important;
			border-color: #0f172a !important;
		}
	}
</style>
