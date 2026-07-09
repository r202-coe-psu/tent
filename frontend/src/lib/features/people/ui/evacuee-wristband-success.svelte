<script lang="ts">
	import QRCode from 'qrcode';
	import Printer from '@lucide/svelte/icons/printer';
	import CheckCircle from '@lucide/svelte/icons/check-circle';
	import type { Evacuee } from '../domain/people';

	let {
		evacuee,
		onBack
	}: {
		evacuee: Evacuee;
		onBack: () => void;
	} = $props();

	let qrUrl = $state<string | null>(null);

	$effect(() => {
		QRCode.toDataURL(evacuee._id, {
			width: 128,
			margin: 1,
			color: { dark: '#0f172a', light: '#ffffff' }
		}).then((url) => {
			qrUrl = url;
		});
	});

	const shortId = $derived.by(() => {
		const raw = evacuee._id.split(':')[1] ?? evacuee._id;
		return `EV-${raw.slice(-4).toUpperCase()}`;
	});

	const fullId = $derived(evacuee._id.split(':')[1] ?? evacuee._id);

	const zoneName = $derived(evacuee.current_stay?.zone?.toUpperCase() ?? 'GENERAL');
	const showFastTrackBadge = $derived(evacuee.special_needs?.length > 0);
</script>

<div class="flex min-h-[70vh] items-center justify-center">
	<div
		class="w-full max-w-lg rounded-3xl border border-border bg-white px-8 py-12 shadow-sm dark:bg-card"
	>
		<!-- Checkmark -->
		<div class="mb-8 flex flex-col items-center gap-5 text-center">
			<div
				class="flex h-16 w-16 items-center justify-center rounded-full bg-green-50 ring-8 ring-green-50"
			>
				<CheckCircle class="size-9 text-green-500" strokeWidth={2} />
			</div>
			<div class="space-y-2">
				<h2 class="text-2xl font-bold text-slate-900 dark:text-slate-50">เลือกโซนพักพิงสำเร็จ</h2>
				<p class="text-sm leading-relaxed text-muted-foreground">
					ขั้นตอนสุดท้าย กรุณาพิมพ์สายรัดข้อมือ <strong>(Wristband)</strong> ส่งมอบให้ผู้<br
					/>ประสบภัยเพื่อใช้สแกนรับอาหาร เข้าที่พัก และรับบริการทางการแพทย์
				</p>
			</div>
		</div>

		<!-- Prominent code display -->
		<div class="mb-6 flex flex-col items-center gap-1.5">
			<span class="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
				รหัสประจำตัวผู้ประสบภัย
			</span>
			<span
				class="rounded-xl bg-slate-900 px-5 py-2.5 font-mono text-2xl font-black tracking-[0.2em] text-white dark:bg-slate-100 dark:text-slate-900"
			>
				{shortId}
			</span>
		</div>

		<!-- Wristband preview -->
		<div class="mb-6 rounded-2xl bg-slate-100 p-6 dark:bg-slate-800">
			<div
				id="wristband-card"
				class="mx-auto flex h-[90px] max-w-[340px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-md dark:border-slate-700"
			>
				<div class="w-2.5 shrink-0 bg-red-500"></div>

				<div class="flex flex-1 flex-col justify-center gap-0.5 px-3 py-2">
					<span class="font-mono text-[9px] font-bold tracking-widest text-slate-400 uppercase">
						ZONE: {zoneName}
					</span>
					<p class="text-sm leading-tight font-bold text-slate-900">
						{evacuee.first_name}
						{evacuee.last_name}
					</p>
					<div class="mt-0.5 flex items-center gap-1.5">
						<span
							class="inline-block rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-bold tracking-wide text-slate-700"
						>
							{fullId}
						</span>
						{#if showFastTrackBadge}
							<span
								class="inline-block rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-600"
							>
								กักโรค
							</span>
						{/if}
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
				พิมพ์บาร์โค้ดสายรัดข้อมือ (เสร็จสิ้น)
			</button>
			<button
				onclick={onBack}
				class="cursor-pointer py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
			>
				ย้อนกลับ / ลงทะเบียนคนใหม่
			</button>
		</div>
	</div>
</div>

<style>
	@media print {
		:global(body *) {
			visibility: hidden;
		}
		#wristband-card,
		#wristband-card * {
			visibility: visible;
		}
		#wristband-card {
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
