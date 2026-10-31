<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import {
		KIOSK_LABEL_MM,
		KioskLabelCard,
		KioskLabelSheet,
		prepareKioskQrImage
	} from '$lib/features/kiosk';
	import { downloadElementAsPng } from '$lib/utils/pdf';
	import { toast } from 'svelte-sonner';
	import { staffCardFileName, staffCardText } from '../domain/staff-card';
	import Download from '@lucide/svelte/icons/download';
	import Printer from '@lucide/svelte/icons/printer';

	let {
		payload,
		displayName,
		shelterName = null,
		volunteerCode = null
	}: {
		payload: string;
		displayName: string;
		shelterName?: string | null;
		volunteerCode?: string | null;
	} = $props();

	const CSS_PX_PER_MM = 96 / 25.4;
	let previewWidth = $state(0);
	// Narrow dialogs shrink the 80 mm card to fit instead of clipping it.
	const previewZoom = $derived(
		previewWidth > 0 ? Math.min(1, previewWidth / (KIOSK_LABEL_MM.width * CSS_PX_PER_MM)) : 1
	);

	// The preview, the printed sheet and the PNG are the same kiosk label card, so what staff see is
	// what prints and downloads.
	const labelQrPromise = $derived(prepareKioskQrImage(payload));

	const text = $derived(staffCardText({ volunteerCode }));

	const fileName = $derived(staffCardFileName(displayName));

	let downloadEl = $state<HTMLElement>();
	let downloading = $state(false);

	function labelFor(qr: { src: string; sizeMm: number }) {
		return {
			key: payload,
			qrSrc: qr?.src,
			qrSizeMm: qr?.sizeMm,
			name: displayName,
			badge: text.badge,
			lines: text.lines,
			alt: `QR สำหรับสแกนบัตรของ ${displayName}`
		};
	}

	async function downloadCard() {
		if (!downloadEl || downloading) return;
		downloading = true;
		try {
			await downloadElementAsPng(downloadEl, fileName);
		} catch (err) {
			toast.error(
				err instanceof Error && err.message ? err.message : 'ดาวน์โหลดบัตรไม่สำเร็จ กรุณาลองใหม่'
			);
		} finally {
			downloading = false;
		}
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
		<!-- Unzoomed off-screen copy for the PNG: the preview's `zoom` would shrink the raster. -->
		<div class="pointer-events-none fixed top-0 -left-[10000px] print:hidden" aria-hidden="true">
			<div bind:this={downloadEl} class="w-fit">
				<KioskLabelCard label={labelFor(qr)} />
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
		<Button
			variant="outline"
			class="min-h-11 gap-1.5 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
			disabled={!downloadEl || downloading}
			onclick={downloadCard}
		>
			<Download class="size-4" aria-hidden="true" />
			{downloading ? 'กำลังสร้างไฟล์...' : 'ดาวน์โหลด PNG'}
		</Button>
		<Button
			variant="outline"
			class="min-h-11 gap-1.5 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
			onclick={() => window.print()}
		>
			<Printer class="size-4" aria-hidden="true" /> พิมพ์
		</Button>
	</div>
</div>
