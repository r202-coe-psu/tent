<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { generateQrDataUrl } from '$lib/utils/qrcode';
	import Download from '@lucide/svelte/icons/download';
	import IdCard from '@lucide/svelte/icons/id-card';
	import Printer from '@lucide/svelte/icons/printer';

	let {
		payload,
		displayName,
		roleLabel,
		position = null,
		shelterName = null,
		volunteerCode = null
	}: {
		payload: string;
		displayName: string;
		roleLabel: string;
		position?: string | null;
		shelterName?: string | null;
		volunteerCode?: string | null;
	} = $props();

	const qrPromise = $derived(
		generateQrDataUrl(payload, {
			width: 320,
			margin: 1,
			color: { dark: '#0A2647', light: '#ffffff' }
		})
	);

	const fileName = $derived(
		`staff-card-${
			displayName
				.trim()
				.replace(/[^\p{L}\p{N}]+/gu, '-')
				.replace(/^-+|-+$/g, '') || 'card'
		}.png`
	);
</script>

<div class="space-y-4">
	<div
		class="mx-auto w-full max-w-sm space-y-4 rounded-2xl border border-slate-200/80 bg-white p-5 text-center shadow-2xs sm:p-6"
	>
		<div class="space-y-2">
			<h3 class="text-xl font-bold text-slate-900">{displayName}</h3>
			<span
				class="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-semibold text-slate-800"
			>
				<IdCard class="size-4 shrink-0 text-[#0A2647]" aria-hidden="true" />
				{roleLabel}
			</span>
			{#if volunteerCode}
				<p class="text-sm text-slate-600 tabular-nums">รหัสจิตอาสา {volunteerCode}</p>
			{:else if position}
				<p class="text-sm text-slate-600">{position}</p>
			{/if}
			{#if shelterName}
				<p class="text-sm text-slate-500">{shelterName}</p>
			{/if}
		</div>

		{#await qrPromise}
			<div
				class="mx-auto aspect-square w-full max-w-72 animate-pulse rounded-xl bg-slate-100"
				role="status"
				aria-label="กำลังสร้าง QR"
			></div>
		{:then dataUrl}
			{#if dataUrl}
				<img
					src={dataUrl}
					alt="QR สำหรับสแกนบัตรเจ้าหน้าที่ของ {displayName}"
					width="320"
					height="320"
					class="mx-auto aspect-square w-full max-w-72 rounded-xl"
				/>
			{:else}
				<p class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
					ไม่สามารถสร้าง QR ได้
				</p>
			{/if}
		{:catch}
			<p class="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">
				ไม่สามารถสร้าง QR ได้
			</p>
		{/await}
	</div>

	<div class="flex flex-col gap-2 sm:flex-row sm:justify-center print:hidden">
		{#await qrPromise then dataUrl}
			{#if dataUrl}
				<Button
					variant="outline"
					class="min-h-11 gap-1.5 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
					href={dataUrl}
					download={fileName}
				>
					<Download class="size-4" aria-hidden="true" /> ดาวน์โหลด PNG
				</Button>
			{/if}
		{/await}
		<Button
			variant="outline"
			class="min-h-11 gap-1.5 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
			onclick={() => window.print()}
		>
			<Printer class="size-4" aria-hidden="true" /> พิมพ์
		</Button>
	</div>
</div>
