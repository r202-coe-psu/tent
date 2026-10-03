<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import Combobox from '$lib/components/ui/combobox/combobox.svelte';
	import {
		formatUnit,
		itemMasterUnit,
		systemCategoryId,
		useItemMasters,
		useUnitsOfMeasure
	} from '$lib/features/catalog';
	import { StoragePointSelect, type StoragePointRef } from '$lib/features/operations';
	import { getShelterCode } from '$lib/db/shelter';
	import { ulid } from '$lib/db/ulid';
	import { qtyStrCoerceSchema } from '$lib/utils/qty';
	import { yieldTotal, type YieldDraftLine } from '../domain/kitchen-yield-receipt';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import PackagePlus from '@lucide/svelte/icons/package-plus';

	/**
	 * Lines of the warehouse's "รับของเข้าคลัง" form: which ready-meal item the
	 * cooked food becomes, how many, and where it is stored. The rows are plain
	 * strings; `toYieldReceiptInput` + the confirm mutation validate them.
	 */
	let {
		lines = $bindable([]),
		points,
		expectedTotal,
		disabled = false,
		oncreatenew
	}: {
		lines: YieldDraftLine[];
		points: readonly StoragePointRef[];
		/** The kitchen's recorded yield, shown next to the running total. */
		expectedTotal?: number | string;
		disabled?: boolean;
		/** Open the "create a new item" page for this row. */
		oncreatenew?: (key: string) => void;
	} = $props();

	const itemMasters = useItemMasters(() => getShelterCode());
	const units = useUnitsOfMeasure();

	const readyMeals = $derived(
		(itemMasters.data ?? []).filter(
			(item) => item.category === systemCategoryId('READY_MEAL') && !item.deactivated
		)
	);
	const comboItems = $derived(readyMeals.map((item) => ({ value: item._id, label: item.name })));

	function unitOf(itemId: string): string {
		const item = readyMeals.find((i) => i._id === itemId);
		return item ? formatUnit(itemMasterUnit(item), units.data) : '';
	}

	function addLine() {
		lines.push({ key: ulid(), item_id: '', qty: '', storage_point_id: '' });
	}

	function removeLine(key: string) {
		lines = lines.filter((line) => line.key !== key);
	}

	// Rows with an unparseable qty count as 0 so a half-typed number never throws.
	const total = $derived(
		yieldTotal(
			lines.map((line) => {
				const parsed = qtyStrCoerceSchema.safeParse(line.qty);
				return { qty: parsed.success ? parsed.data : '0' };
			})
		)
	);
	const mismatch = $derived(
		expectedTotal !== undefined && expectedTotal !== '' && Number(total) !== Number(expectedTotal)
	);
</script>

<div class="space-y-3">
	<div class="flex items-center justify-between gap-2">
		<h4 class="text-sm font-bold text-slate-900">รายการอาหารที่รับเข้าคลัง</h4>
		<Button variant="outline" size="sm" class="gap-1.5" {disabled} onclick={addLine}>
			<Plus class="h-4 w-4" />
			เพิ่มรายการ
		</Button>
	</div>

	{#each lines as line, index (line.key)}
		<div class="space-y-3 rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs">
			<div class="flex items-center justify-between gap-2">
				<span class="text-xs font-semibold text-slate-500">รายการที่ {index + 1}</span>
				{#if lines.length > 1}
					<Button
						variant="ghost"
						size="icon"
						class="h-9 w-9 text-slate-500 hover:text-red-600"
						{disabled}
						onclick={() => removeLine(line.key)}
					>
						<Trash2 class="h-4 w-4" />
						<span class="sr-only">ลบรายการที่ {index + 1}</span>
					</Button>
				{/if}
			</div>

			<div class="space-y-1.5">
				<Label class="text-sm font-semibold text-slate-700">
					ชนิดอาหาร <span class="text-red-500">*</span>
				</Label>
				<Combobox
					items={comboItems}
					bind:value={line.item_id}
					{disabled}
					placeholder="เลือกอาหารปรุงสำเร็จ"
					searchPlaceholder="ค้นหาชื่ออาหาร..."
					emptyText="ไม่พบรายการ — สร้างชนิดของใหม่ได้ด้านล่าง"
					class="h-11 sm:h-10"
				/>
				{#if oncreatenew}
					<Button
						variant="link"
						size="sm"
						class="h-auto gap-1.5 p-0 text-sky-700"
						{disabled}
						onclick={() => oncreatenew(line.key)}
					>
						<PackagePlus class="h-4 w-4" />
						ไม่มีในรายการ? สร้างชนิดของใหม่
					</Button>
				{/if}
			</div>

			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
				<div class="space-y-1.5">
					<Label for={`yield-qty-${line.key}`} class="text-sm font-semibold text-slate-700">
						จำนวน <span class="text-red-500">*</span>
						{#if unitOf(line.item_id)}
							<span class="font-normal text-slate-500">({unitOf(line.item_id)})</span>
						{/if}
					</Label>
					<Input
						id={`yield-qty-${line.key}`}
						type="text"
						inputmode="decimal"
						placeholder="0"
						bind:value={line.qty}
						{disabled}
						class="h-11 tabular-nums sm:h-10"
					/>
				</div>
				<div class="space-y-1.5">
					<Label class="text-sm font-semibold text-slate-700">สถานที่จัดเก็บ</Label>
					<StoragePointSelect {points} bind:value={line.storage_point_id} {disabled} />
				</div>
			</div>
		</div>
	{/each}

	<div
		class="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-3 text-sm {mismatch
			? 'border-amber-200 bg-amber-50 text-amber-900'
			: 'border-slate-200/80 bg-slate-50 text-slate-700'}"
	>
		<span class="font-semibold">
			รวมที่รับเข้า <span class="tabular-nums">{total}</span>
			{#if expectedTotal !== undefined && expectedTotal !== ''}
				/ ครัวบันทึก <span class="tabular-nums">{expectedTotal}</span>
			{/if}
		</span>
		{#if mismatch}
			<span class="inline-flex items-center gap-1.5 text-xs font-semibold">
				<TriangleAlert class="h-4 w-4" />
				ยอดรวมไม่ตรงกับที่ครัวบันทึก (บันทึกต่อได้)
			</span>
		{/if}
	</div>
</div>
