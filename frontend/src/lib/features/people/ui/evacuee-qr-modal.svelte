<script lang="ts">
	import QRCode from 'qrcode';
	import X from '@lucide/svelte/icons/x';
	import Printer from '@lucide/svelte/icons/printer';
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

	$effect(() => {
		if (!show) return;
		qrUrl = null;
		QRCode.toDataURL(evacuee._id, {
			width: 128,
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
		class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
	>
		<div
			class="w-full max-w-lg animate-in rounded-3xl border border-border bg-white px-8 py-10 shadow-sm duration-150 zoom-in-95 fade-in dark:bg-card"
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
			<div class="mb-8 flex flex-col items-center gap-1 text-center">
				<h2 class="text-2xl font-bold text-slate-900 dark:text-slate-50">
					บัตรประจำตัวผู้ประสบภัย
				</h2>
				<p class="text-sm text-muted-foreground">
					{evacuee.first_name}
					{evacuee.last_name}
				</p>
			</div>

			<!-- ID card preview -->
			<div class="mb-6 rounded-2xl bg-slate-100 p-6 dark:bg-slate-800">
				<div
					id="qr-identity-card"
					class="mx-auto flex min-h-[90px] max-w-[420px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-md dark:border-slate-700"
				>
					<div class="w-2.5 shrink-0 bg-red-500"></div>

					<div class="flex flex-1 flex-col justify-center gap-0.5 px-3 py-2.5">
						<span class="font-mono text-[9px] font-bold tracking-widest text-slate-400 uppercase">
							ZONE: {zoneName}
						</span>
						<p class="text-sm leading-tight font-bold text-slate-900">
							{evacuee.first_name}
							{evacuee.last_name}
						</p>
						<div class="mt-1 flex flex-wrap items-center gap-1.5">
							<span
								class="inline-block rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wide whitespace-nowrap text-slate-700"
							>
								{fullId}
							</span>
							<span
								class="inline-block rounded bg-slate-900 px-1.5 py-0.5 text-[9px] font-bold tracking-wide whitespace-nowrap text-white uppercase"
							>
								{maskNationalId(evacuee.person_id?.number)}
							</span>
						</div>
					</div>

					<div class="flex shrink-0 items-center justify-center px-2">
						{#if qrUrl}
							<img src={qrUrl} alt="QR Code" class="size-16 object-contain" />
						{:else}
							<div
								class="flex size-16 items-center justify-center rounded bg-slate-100 text-[10px] text-slate-400"
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
					onclick={() => window.print()}
					class="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#0d2240] py-3.5 text-sm font-semibold text-white transition-colors hover:bg-[#1a3a5c]"
				>
					<Printer class="size-4" />
					พิมพ์บัตรประจำตัว
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
