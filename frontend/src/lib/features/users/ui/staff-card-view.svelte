<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import {
		KIOSK_LABEL_MM,
		KioskLabelCard,
		KioskLabelSheet,
		prepareKioskQrImage
	} from '$lib/features/kiosk';
	import { generateQrDataUrl } from '$lib/utils/qrcode';
	import { staffCardFileName } from '../domain/staff-card';
	import Download from '@lucide/svelte/icons/download';
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

	const CSS_PX_PER_MM = 96 / 25.4;
	let previewWidth = $state(0);
	// Narrow dialogs shrink the 80 mm card to fit instead of clipping it.
	const previewZoom = $derived(
		previewWidth > 0 ? Math.min(1, previewWidth / (KIOSK_LABEL_MM.width * CSS_PX_PER_MM)) : 1
	);

	// The preview and the printed sheet are the same kiosk label card, so what staff see is what prints.
	const labelQrPromise = $derived(prepareKioskQrImage(payload));
	const downloadPromise = $derived(
		generateQrDataUrl(payload, {
			width: 320,
			margin: 1,
			color: { dark: '#0A2647', light: '#ffffff' }
		})
	);

	const lines = $derived([
		roleLabel,
		...(volunteerCode ? [`รหัสจิตอาสา ${volunteerCode}`] : position ? [position] : [])
	]);

	const fileName = $derived(staffCardFileName(displayName));

	function labelFor(qr: { src: string; sizeMm: number }) {
		return {
			key: payload,
			qrSrc: qr?.src,
			qrSizeMm: qr?.sizeMm,
			name: displayName,
			lines,
			alt: `QR สำหรับสแกนบัตรของ ${displayName}`
		};
	}
</script>

<div class="min-w-0 space-y-4">
	{#await labelQrPromise}
		<div class="flex justify-center">
			<div
				class="aspect-[4/3] w-[80mm] max-w-full animate-pulse rounded-lg bg-slate-100"
				role="status"
				aria-label="กำลังสร้าง QR"
			></div>
		</div>
	{:then qr}
		<div class="w-full min-w-0 overflow-hidden" bind:clientWidth={previewWidth}>
			<div class="mx-auto w-fit" style:zoom={previewZoom}>
				<KioskLabelCard
					label={labelFor(qr)}
					class="rounded-lg border border-slate-300 shadow-2xs"
				/>
			</div>
		</div>
		{#if shelterName}
			<p class="text-center text-sm text-slate-500 print:hidden">{shelterName}</p>
		{/if}
		<KioskLabelSheet labels={[labelFor(qr)]} />
	{:catch}
		<p class="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">
			ไม่สามารถสร้าง QR ได้
		</p>
	{/await}

	<div class="flex flex-col gap-2 sm:flex-row sm:justify-center print:hidden">
		{#await downloadPromise then dataUrl}
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
