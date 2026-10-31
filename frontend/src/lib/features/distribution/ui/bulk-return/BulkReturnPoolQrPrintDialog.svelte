<script lang="ts">
	import Printer from '@lucide/svelte/icons/printer';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { generateQrDataUrl } from '$lib/utils/qrcode';
	import { poolQrPayload } from '../model/bulk-return-pool-qr';
	import type { BulkReturnPoolRow } from '../model/bulk-return-pool-v3';

	/** #660: printable QR label of a pool; scanning it in "รับของเข้ากอง" picks the pool. */
	interface Props {
		open: boolean;
		pool: BulkReturnPoolRow['pool'];
	}

	let { open = $bindable(), pool }: Props = $props();

	const location = $derived(pool.location_storage_zone?.trim() ?? '');
	const qrPromise = $derived(
		open && pool ? generateQrDataUrl(poolQrPayload(pool._id), { width: 320 }) : null
	);

	function handlePrint() {
		if (typeof window !== 'undefined') window.print();
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content
		class="pool-qr-dialog flex max-h-[92vh] flex-col gap-4 overflow-y-auto sm:max-w-md"
	>
		<Dialog.Header>
			<Dialog.Title class="text-lg font-bold text-slate-900">พิมพ์ QR กอง</Dialog.Title>
			<Dialog.Description class="text-sm text-slate-600">
				ติดป้ายนี้ที่กอง แล้วสแกนในหน้า "รับของเข้ากอง" เพื่อเลือกกองอัตโนมัติ
			</Dialog.Description>
		</Dialog.Header>

		<div
			class="pool-qr-label flex flex-col items-center gap-2 rounded-xl border border-slate-200 bg-white p-5 text-center"
		>
			<p class="text-xl font-extrabold [overflow-wrap:anywhere] text-slate-900">{pool.name}</p>
			{#if location}
				<p class="text-sm font-medium [overflow-wrap:anywhere] text-slate-700">
					จุดเก็บ: {location}
				</p>
			{/if}
			{#await qrPromise}
				<div
					role="status"
					class="flex size-64 items-center justify-center rounded-lg bg-slate-100 text-sm text-slate-500"
				>
					กำลังสร้าง QR...
				</div>
			{:then url}
				{#if url}
					<img src={url} alt="QR กอง {pool.name}" class="size-64 bg-white" />
				{:else}
					<p role="alert" class="flex size-64 items-center justify-center text-sm text-red-700">
						สร้าง QR ไม่สำเร็จ
					</p>
				{/if}
			{:catch}
				<p role="alert" class="flex size-64 items-center justify-center text-sm text-red-700">
					สร้าง QR ไม่สำเร็จ
				</p>
			{/await}
			<p class="font-mono text-[10px] break-all text-slate-500">{pool._id}</p>
		</div>

		<div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
			<Button type="button" variant="outline" class="min-h-11" onclick={() => (open = false)}>
				ปิด
			</Button>
			{#await qrPromise}
				{@render printButton(false)}
			{:then url}
				{@render printButton(Boolean(url))}
			{:catch}
				{@render printButton(false)}
			{/await}
		</div>
	</Dialog.Content>
</Dialog.Root>

{#snippet printButton(ready: boolean)}
	<Button type="button" class="min-h-11 gap-2" disabled={!ready} onclick={handlePrint}>
		<Printer class="h-4 w-4" aria-hidden="true" />
		พิมพ์
	</Button>
{/snippet}

<style>
	@media print {
		:global(body:where(:has(.pool-qr-label)) *) {
			visibility: hidden;
		}
		:global(.pool-qr-label),
		:global(.pool-qr-label *) {
			visibility: visible;
		}
		:global(.pool-qr-dialog) {
			position: absolute !important;
			inset: 0 auto auto 0 !important;
			transform: none !important;
			max-width: none !important;
			width: 100% !important;
			max-height: none !important;
			overflow: visible !important;
			border: 0 !important;
			box-shadow: none !important;
			background: transparent !important;
		}
		:global(.pool-qr-label) {
			border: 2px solid #0f172a;
		}
	}
</style>
