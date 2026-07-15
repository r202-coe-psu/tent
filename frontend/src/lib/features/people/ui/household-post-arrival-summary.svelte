<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { previewElementAsPdf } from '$lib/utils/pdf';
	import { Button } from '$lib/components/ui/button/index.js';
	import { zoneLabel } from '../index';
	import type { Evacuee, Household } from '../domain/people';

	// Icons
	import Check from '@lucide/svelte/icons/check';

	let {
		createdHousehold,
		selectedHead,
		selectedMembers = [],
		qrUrl,
		onFinish
	}: {
		createdHousehold: Household;
		selectedHead: Evacuee | null;
		selectedMembers: Evacuee[];
		qrUrl: string | null;
		onFinish: () => void;
	} = $props();

	let cardEl = $state<HTMLDivElement | null>(null);
	let isExportingPdf = $state(false);

	const fullId = $derived(createdHousehold._id.split(':')[1] ?? createdHousehold._id);
	const zoneName = $derived(
		selectedHead?.current_stay?.zone
			? zoneLabel(selectedHead.current_stay.zone).toUpperCase()
			: 'GENERAL'
	);

	async function handlePrintPreview() {
		if (!cardEl) return;
		isExportingPdf = true;
		try {
			await previewElementAsPdf(cardEl, `household-id-${fullId}`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'สร้าง PDF ไม่สำเร็จ');
		} finally {
			isExportingPdf = false;
		}
	}
</script>

<div class="mx-auto w-full max-w-2xl space-y-8 pt-8 text-center">
	<div class="flex flex-col items-center justify-center gap-3">
		<div
			class="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-green-600"
		>
			<Check class="h-10 w-10 stroke-[3]" />
		</div>
		<h3 class="text-2xl font-bold text-slate-900 dark:text-slate-50">
			จัดกลุ่มครอบครัวและออกรหัสครัวเรือนสำเร็จ!
		</h3>
		<p class="max-w-md text-sm text-muted-foreground">
			ระบบได้ออกรหัส Shelter ID และ QR Code สำหรับครัวเรือน "{createdHousehold.label}" เรียบร้อยแล้ว
			สมาชิกทุกคนในกลุ่มมีสถานะเช็คอินอยู่ในโซนเดียวกัน
		</p>
	</div>

	<!-- QR Display Card -->
	<div class="mx-auto max-w-sm space-y-6 rounded-2xl border border-border bg-card p-6 shadow-sm">
		<div class="space-y-1">
			<h4 class="text-lg font-bold text-slate-800">{createdHousehold.label}</h4>
			<p class="text-xs text-muted-foreground">Shelter ID: {createdHousehold._id}</p>
		</div>

		<div class="flex justify-center border-y border-dashed border-border/80 py-6">
			{#if qrUrl}
				<img src={qrUrl} alt="QR Code" class="size-36 object-contain" />
			{/if}
		</div>

		<div class="space-y-2 text-left text-sm text-slate-700">
			<p>
				<span class="font-semibold">หัวหน้าครัวเรือน:</span>
				{selectedHead?.first_name}
				{selectedHead?.last_name}
			</p>
			{#if selectedHead?.current_stay?.zone}
				<p>
					<span class="font-semibold">โซนที่จัดสรร:</span>
					{zoneLabel(selectedHead.current_stay.zone)}
				</p>
			{/if}
			<p>
				<span class="font-semibold">เขตพื้นที่:</span>
				{createdHousehold.municipality_zone
					? zoneLabel(createdHousehold.municipality_zone)
					: 'ไม่ได้ระบุ'}
			</p>
			<p><span class="font-semibold">จำนวนสมาชิก:</span> {selectedMembers.length} คน</p>
		</div>

		<Button
			class="w-full bg-[#003B71] hover:bg-[#002a50]"
			onclick={handlePrintPreview}
			disabled={isExportingPdf}
		>
			{isExportingPdf ? 'กำลังสร้าง PDF...' : 'พิมพ์บัตรครัวเรือน'}
		</Button>
	</div>

	<!-- Hidden print target card (exactly identical to the modal design for consistent formatting) -->
	<div style="position: absolute; left: -9999px; top: -9999px;">
		<div
			bind:this={cardEl}
			class="flex min-h-[90px] w-[320px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-md"
		>
			<div class="w-2.5 shrink-0 bg-emerald-500"></div>

			<div class="flex flex-1 flex-col justify-center gap-0.5 px-3 py-2.5 text-left">
				<span class="font-mono text-[9px] font-bold tracking-widest text-slate-400 uppercase">
					ZONE: {zoneName}
				</span>
				<p class="text-sm leading-tight font-bold text-slate-900">
					{createdHousehold.label}
				</p>
				<div class="mt-1 flex flex-col gap-0.5 text-[10px] text-slate-600">
					<p>
						<span class="font-semibold text-slate-700">หัวหน้า:</span>
						{selectedHead ? `${selectedHead.first_name} ${selectedHead.last_name}` : '—'}
					</p>
					<p>
						<span class="font-semibold text-slate-700">จำนวนสมาชิก:</span>
						{selectedMembers.length} คน
					</p>
				</div>
				<div class="mt-1">
					<span
						class="inline-block rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-mono text-[8px] font-bold tracking-wide whitespace-nowrap text-slate-700"
					>
						{fullId}
					</span>
				</div>
			</div>

			<div class="flex shrink-0 items-center justify-center px-2">
				{#if qrUrl}
					<img src={qrUrl} alt="QR Code" class="size-16 object-contain" />
				{/if}
			</div>
		</div>
	</div>

	<div class="flex justify-center border-t border-border pt-6">
		<Button variant="outline" onclick={onFinish}>เสร็จสิ้น กลับหน้าหลัก</Button>
	</div>
</div>
