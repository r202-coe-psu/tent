<script lang="ts">
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

		<Button class="w-full bg-[#003B71] hover:bg-[#002a50]" disabled={true}>
			พิมพ์บัตรครัวเรือน (ปิดใช้งานชั่วคราว)
		</Button>
	</div>

	<div class="flex justify-center border-t border-border pt-6">
		<Button variant="outline" onclick={onFinish}>เสร็จสิ้น กลับหน้าหลัก</Button>
	</div>
</div>
