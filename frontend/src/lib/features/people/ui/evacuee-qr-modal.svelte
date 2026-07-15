<script lang="ts">
	import { tick } from 'svelte';
	import QRCode from 'qrcode';
	import X from '@lucide/svelte/icons/x';
	import Printer from '@lucide/svelte/icons/printer';
	import { toast } from 'svelte-sonner';
	import { previewElementAsPdf } from '$lib/utils/pdf';
	import type { Evacuee, StayStatus } from '$lib/features/people';
	import { maskNationalId } from '$lib/features/people';

	let {
		show,
		evacuee,
		onClose
	}: {
		show: boolean;
		evacuee: Evacuee;
		onClose: () => void;
	} = $props();

	let qrUrl = $state<string | null>(null);
	let cardEl = $state<HTMLDivElement | null>(null);
	let isExportingPdf = $state(false);

	const statusAccent: Record<StayStatus, string> = {
		active: '#22c55e',
		pre_registered: '#3b82f6',
		temporary_leave: '#f59e0b',
		transferred: '#a855f7',
		checked_out: '#ef4444',
		deceased: '#020617'
	};

	async function handlePrintPreview() {
		if (!cardEl) return;
		isExportingPdf = true;
		cardEl.classList.add('print-capture');
		try {
			await tick();
			await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
			await previewElementAsPdf(cardEl, `evacuee-id-${fullId}`, { maxWidthMm: 100 });
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'สร้าง PDF ไม่สำเร็จ');
		} finally {
			cardEl.classList.remove('print-capture');
			isExportingPdf = false;
		}
	}

	$effect(() => {
		if (!show) return;
		qrUrl = null;
		QRCode.toDataURL(evacuee._id, {
			// Generate a larger source image so the QR remains crisp at every responsive size.
			width: 384,
			margin: 1,
			color: { dark: '#0f172a', light: '#ffffff' }
		}).then((url) => {
			qrUrl = url;
		});
	});

	const fullId = $derived(evacuee._id.split(':')[1] ?? evacuee._id);

	const zoneName = $derived(evacuee.current_stay?.zone?.toUpperCase() ?? 'GENERAL');
	const qrAccentColor = $derived(statusAccent[evacuee.current_stay.status]);
</script>

{#if show}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/60 p-3 backdrop-blur-xs sm:p-6"
	>
		<div
			class="my-auto w-full max-w-2xl animate-in rounded-3xl border border-border bg-white px-4 py-6 shadow-sm duration-150 zoom-in-95 fade-in sm:px-8 sm:py-10 dark:bg-card"
		>
			<div class="mb-2 flex justify-end">
				<button
					onclick={onClose}
					class="cursor-pointer rounded-lg p-1 text-muted-foreground transition-colors hover:text-foreground"
				>
					<X class="size-5" />
				</button>
			</div>

			<!-- Header -->
			<div class="mb-6 flex flex-col items-center gap-1 text-center sm:mb-8">
				<h2 class="text-2xl font-bold text-slate-900 dark:text-slate-50">
					บัตรประจำตัวผู้ประสบภัย
				</h2>
				<p class="text-sm text-muted-foreground">
					{evacuee.first_name}
					{evacuee.last_name}
				</p>
			</div>

			<!-- ID card preview -->
			<div class="mb-6 rounded-2xl bg-slate-100 p-3 sm:p-6 dark:bg-slate-800">
				<div
					id="qr-identity-card"
					bind:this={cardEl}
					class="mx-auto flex w-full max-w-[560px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-md sm:min-h-44 sm:flex-row dark:border-slate-700"
				>
					<div
						class="card-accent h-2.5 w-full shrink-0 sm:h-auto sm:w-2.5"
						style:background-color={qrAccentColor}
					></div>

					<div
						class="card-qr-panel order-1 flex w-full shrink-0 items-center justify-center border-b border-slate-200 bg-slate-50 px-5 py-5 sm:order-2 sm:w-auto sm:border-b-0 sm:border-l sm:px-5 dark:border-slate-700 dark:bg-slate-900/30"
					>
						{#if qrUrl}
							<img
								src={qrUrl}
								alt="QR Code สำหรับ {evacuee.first_name} {evacuee.last_name}"
								class="card-qr-image size-36 object-contain sm:size-36 md:size-40"
							/>
						{:else}
							<div
								class="flex size-36 items-center justify-center rounded bg-slate-100 text-[10px] text-slate-400 sm:size-36 md:size-40"
							>
								...
							</div>
						{/if}
					</div>

					<div
						class="card-details order-2 flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-4 py-5 sm:order-1 sm:px-5"
					>
						<span
							class="card-zone font-mono text-[11px] font-bold tracking-widest text-slate-400 uppercase sm:text-xs"
						>
							ZONE: {zoneName}
						</span>
						<p class="card-name text-base leading-tight font-bold text-slate-900 sm:text-xl">
							{evacuee.first_name}
							{evacuee.last_name}
						</p>
						<div class="mt-1 flex flex-wrap items-center gap-1.5">
							<span
								class="card-id inline-block rounded border border-slate-200 bg-slate-100 px-2 py-1 font-mono text-xs font-bold tracking-wide whitespace-nowrap text-slate-700 sm:text-sm"
							>
								{fullId}
							</span>
							<span
								class="card-national-id inline-block rounded bg-slate-900 px-2 py-1 text-[11px] font-bold tracking-wide whitespace-nowrap text-white uppercase sm:text-xs"
							>
								{maskNationalId(evacuee.person_id?.number)}
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
					{isExportingPdf ? 'กำลังสร้าง PDF...' : 'พิมพ์บัตรประจำตัว'}
				</button>
				<button
					onclick={onClose}
					class="cursor-pointer py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
				>
					ปิดหน้าต่าง
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	/* The PDF capture uses this fixed desktop card independently of the app viewport. */
	:global(#qr-identity-card.print-capture) {
		width: 760px !important;
		max-width: none !important;
		min-height: 210px !important;
		flex-direction: row !important;
	}

	:global(#qr-identity-card.print-capture .card-accent) {
		height: auto !important;
		width: 10px !important;
	}

	:global(#qr-identity-card.print-capture .card-qr-panel) {
		order: 2 !important;
		width: auto !important;
		border-top: 0 !important;
		border-left: 1px solid #e2e8f0 !important;
		padding: 20px 28px !important;
	}

	:global(#qr-identity-card.print-capture .card-details) {
		order: 1 !important;
		padding: 24px 28px !important;
	}

	:global(#qr-identity-card.print-capture .card-qr-image) {
		height: 160px !important;
		width: 160px !important;
	}

	:global(#qr-identity-card.print-capture .card-zone) {
		font-size: 16px !important;
	}

	:global(#qr-identity-card.print-capture .card-name) {
		font-size: 30px !important;
	}

	:global(#qr-identity-card.print-capture .card-id) {
		font-size: 20px !important;
		padding: 6px 10px !important;
	}

	:global(#qr-identity-card.print-capture .card-national-id) {
		font-size: 16px !important;
		padding: 7px 10px !important;
	}

	@media print {
		:global(body *) {
			visibility: hidden;
		}
		#qr-identity-card,
		#qr-identity-card * {
			visibility: visible;
		}
		#qr-identity-card {
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
		#qr-identity-card .card-accent {
			height: auto !important;
			width: 10px !important;
		}
		#qr-identity-card .card-qr-panel {
			order: 2 !important;
			width: auto !important;
			border-top: 0 !important;
			border-left: 1px solid #e2e8f0 !important;
			padding: 20px 28px !important;
		}
		#qr-identity-card .card-details {
			order: 1 !important;
			padding: 24px 28px !important;
		}
		#qr-identity-card .card-qr-image {
			height: 160px !important;
			width: 160px !important;
		}
		#qr-identity-card .card-zone {
			font-size: 16px !important;
		}
		#qr-identity-card .card-name {
			font-size: 30px !important;
		}
		#qr-identity-card .card-id {
			font-size: 20px !important;
			padding: 6px 10px !important;
		}
		#qr-identity-card .card-national-id {
			font-size: 16px !important;
			padding: 7px 10px !important;
		}
	}
</style>
