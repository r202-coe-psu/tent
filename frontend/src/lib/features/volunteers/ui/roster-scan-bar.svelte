<script lang="ts">
	/**
	 * "แถบสแกนและค้นหาด่วน (Fast Scan & Live Roster)" — Roster tab (Tab 2),
	 * owner-approved mockup 2026-08-29.
	 *
	 * `date` is the ONE server-side filter here: it re-keys
	 * `useTodayAttendance()` so a different day is fetched (default = today in
	 * Asia/Bangkok). `search`/`shift`/`status` filter that already-fetched
	 * roster client-side (mirrors `volunteer-filter-bar.svelte`'s split — there
	 * is no server-side index for those three). "สแกนรับเข้างาน" (camera QR/barcode scan)
	 * has no browser camera integration in this pass — owner instruction
	 * 2026-08-29 scopes the on-site scan/kiosk hardware flow out for now, so it
	 * stays a UI-only stub (`toast.info`, same convention as
	 * `volunteer-card.svelte`'s "ลบ" button) until that hardware integration is
	 * built.
	 */
	import { toast } from 'svelte-sonner';
	import Search from '@lucide/svelte/icons/search';
	import Camera from '@lucide/svelte/icons/camera';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { shiftKindSchema, shiftAssignmentStatusSchema } from '../domain/shift-assignment.schema';
	import type { ShiftAssignmentStatus, ShiftKind } from '../domain/shift-assignment.schema';
	import { todayDateString } from '../application/queries';

	let {
		search = $bindable(''),
		shift = $bindable<ShiftKind | ''>(''),
		status = $bindable<ShiftAssignmentStatus | ''>(''),
		date = $bindable(todayDateString())
	}: {
		search?: string;
		shift?: ShiftKind | '';
		status?: ShiftAssignmentStatus | '';
		date?: string;
	} = $props();

	const isToday = $derived(date === todayDateString());

	const SHIFT_LABELS: Record<ShiftKind, string> = {
		morning: 'กะเช้า',
		afternoon: 'กะบ่าย',
		night: 'กะดึก',
		flex: 'ยืดหยุ่น (Flex)',
		custom: 'กะกำหนดเอง'
	};
	const shiftOptions = [
		{ value: '', label: 'ทุกกะทำงาน' },
		...shiftKindSchema.options.map((v) => ({ value: v, label: SHIFT_LABELS[v] }))
	];

	const STATUS_LABELS: Record<ShiftAssignmentStatus, string> = {
		assigned: 'รับกะแล้ว',
		standby: 'รอสแตนด์บาย',
		checked_in: 'ปฏิบัติหน้าที่อยู่',
		completed: 'เสร็จสิ้นภารกิจ',
		no_show: 'ขาดปฏิบัติงาน',
		cancelled: 'ยกเลิก'
	};
	const statusOptions = [
		{ value: '', label: 'ทุกสถานะการเข้างาน' },
		...shiftAssignmentStatusSchema.options.map((v) => ({ value: v, label: STATUS_LABELS[v] }))
	];

	const selectTriggerClass = 'h-11 w-full min-w-0 rounded-xl bg-background px-3 shadow-xs';

	/** An empty date input (the operator cleared it) falls back to today rather
	 * than querying `date: ''`, which would match no assignment at all. */
	function onDateInput(event: Event & { currentTarget: HTMLInputElement }) {
		date = event.currentTarget.value || todayDateString();
	}

	function mockScan() {
		toast.info('สแกนรับเข้างานด้วยกล้อง — ฟีเจอร์นี้อยู่ระหว่างการพัฒนา (mock up)');
	}
</script>

<div class="space-y-3 rounded-2xl border border-border bg-card p-4">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<p class="text-sm font-bold text-foreground">แถบสแกนและค้นหาด่วน (Fast Scan & Live Roster)</p>
		<p class="text-[11px] text-muted-foreground">
			รองรับ Barcode / QR Scanner ยิงค้นหา หรือพิมพ์เบอร์โทรศัพท์ 4 ตัวท้าย
		</p>
	</div>

	<div class="flex flex-col gap-2 lg:flex-row">
		<div class="relative flex-1">
			<Search
				class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
			/>
			<Input
				type="search"
				placeholder="สแกน QR / Barcode หรือพิมพ์ชื่อ, ID, เบอร์โทร"
				bind:value={search}
				class="h-11 rounded-xl bg-background pl-9 shadow-xs"
			/>
		</div>

		<Select.Root type="single" bind:value={shift}>
			<Select.Trigger class="{selectTriggerClass} lg:w-48" aria-label="กะทำงาน">
				<span class="truncate"
					>{shiftOptions.find((o) => o.value === shift)?.label ?? 'ทุกกะทำงาน'}</span
				>
			</Select.Trigger>
			<Select.Content>
				{#each shiftOptions as opt (opt.value)}
					<Select.Item value={opt.value} label={opt.label} />
				{/each}
			</Select.Content>
		</Select.Root>

		<Select.Root type="single" bind:value={status}>
			<Select.Trigger class="{selectTriggerClass} lg:w-56" aria-label="สถานะการเข้างาน">
				<span class="truncate">
					{statusOptions.find((o) => o.value === status)?.label ?? 'ทุกสถานะการเข้างาน'}
				</span>
			</Select.Trigger>
			<Select.Content>
				{#each statusOptions as opt (opt.value)}
					<Select.Item value={opt.value} label={opt.label} />
				{/each}
			</Select.Content>
		</Select.Root>

		<div class="relative shrink-0">
			<CalendarDays
				class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
			/>
			<Input
				type="date"
				value={date}
				oninput={onDateInput}
				aria-label="วันที่ของตารางกะ"
				class="h-11 rounded-xl bg-background pl-9 shadow-xs lg:w-44"
			/>
		</div>

		{#if !isToday}
			<Button
				variant="ghost"
				class="h-11 shrink-0 rounded-xl"
				onclick={() => (date = todayDateString())}
			>
				กลับไปวันนี้
			</Button>
		{/if}

		<Button variant="outline" class="h-11 shrink-0 gap-1.5 rounded-xl" onclick={mockScan}>
			<Camera class="h-4 w-4" />
			สแกนรับเข้างาน
		</Button>
	</div>
</div>
