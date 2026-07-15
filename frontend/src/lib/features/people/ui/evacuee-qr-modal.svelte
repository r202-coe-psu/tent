<script lang="ts">
	import QRCode from 'qrcode';
	import X from '@lucide/svelte/icons/x';
	import Printer from '@lucide/svelte/icons/printer';
	import { toast } from 'svelte-sonner';
	import { previewElementAsPdf } from '$lib/utils/pdf';
	import type { Evacuee } from '$lib/features/people';
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

	async function handlePrintPreview() {
		if (!cardEl) return;
		isExportingPdf = true;
		try {
			await previewElementAsPdf(cardEl, `evacuee-id-${fullId}`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'สร้าง PDF ไม่สำเร็จ');
		} finally {
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
					class="mx-auto flex min-h-36 w-full max-w-[560px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-md sm:min-h-44 dark:border-slate-700"
				>
					<div class="w-2.5 shrink-0 bg-red-500"></div>

					<div class="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-3 py-3 sm:px-5">
						<span class="font-mono text-[11px] font-bold tracking-widest text-slate-400 uppercase sm:text-xs">
							ZONE: {zoneName}
						</span>
						<p class="text-base leading-tight font-bold text-slate-900 sm:text-xl">
							{evacuee.first_name}
							{evacuee.last_name}
						</p>
						<div class="mt-1 flex flex-wrap items-center gap-1.5">
							<span
								class="inline-block rounded border border-slate-200 bg-slate-100 px-2 py-1 font-mono text-xs font-bold tracking-wide whitespace-nowrap text-slate-700 sm:text-sm"
							>
								{fullId}
							</span>
							<span
								class="inline-block rounded bg-slate-900 px-2 py-1 text-[11px] font-bold tracking-wide whitespace-nowrap text-white uppercase sm:text-xs"
							>
								{maskNationalId(evacuee.person_id?.number)}
							</span>
						</div>
					</div>

					<div class="flex shrink-0 items-center justify-center px-3 py-3 sm:px-5">
						{#if qrUrl}
							<img
								src={qrUrl}
								alt="QR Code"
								class="size-28 object-contain sm:size-36 md:size-40"
							/>
						{:else}
							<div
								class="flex size-28 items-center justify-center rounded bg-slate-100 text-[10px] text-slate-400 sm:size-36 md:size-40"
							>
								...
							</div>
						{/if}
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
			transform: translate(-50%, -50%) scale(2.5);
			border: 1px solid #ccc !important;
			box-shadow: none !important;
			background-color: #fff !important;
		}
	}
</style>
