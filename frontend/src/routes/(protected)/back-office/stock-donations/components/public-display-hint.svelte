<script lang="ts">
	import Info from '@lucide/svelte/icons/info';
	import { useSupplyItems } from '$lib/features/supply';
	import { itemMasterUnit, useItemMasters } from '$lib/features/catalog';
	import { getShelterCode } from '$lib/db/shelter';

	/**
	 * What the donor-facing board will really show for this need.
	 *
	 * The public board is an aggregate PER ITEM (schema.md §2.4 / T-60): the worker
	 * projects `{shelter}:{item_id}` and names it from the catalog, so the campaign
	 * title, unit, category and urgency typed here never reach it. Staff kept filling
	 * those in and then reporting the campaign "missing" from `/donate`, because it had
	 * silently merged into the existing card for the same item.
	 *
	 * This says so at the point of entry rather than leaving it to be discovered.
	 */
	let {
		itemId,
		typedUnit = ''
	}: {
		/** Catalog id the need is bound to (`item:` or `item_master:`). */
		itemId: string;
		/** Unit the form currently has, so a mismatch with the catalog can be named. */
		typedUnit?: string;
	} = $props();

	const supplyItemsQuery = useSupplyItems();
	const itemMastersQuery = useItemMasters(() => getShelterCode());

	const catalogItem = $derived.by(() => {
		const supply = (supplyItemsQuery.data ?? []).find((i) => i._id === itemId);
		if (supply) return { name: supply.name, unit: supply.unit || '', category: supply.category };
		const master = (itemMastersQuery.data ?? []).find((m) => m._id === itemId);
		if (master)
			return { name: master.name, unit: itemMasterUnit(master) || '', category: master.category };
		return null;
	});

	const unitDiffers = $derived(
		!!catalogItem?.unit && !!typedUnit.trim() && catalogItem.unit !== typedUnit.trim()
	);
</script>

<div
	class="flex items-start gap-2 rounded-xl border border-blue-200/70 bg-blue-50/60 p-3 text-2xs leading-relaxed text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/25 dark:text-blue-200"
>
	<Info class="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
	<div class="space-y-1">
		{#if catalogItem}
			<p>
				หน้าบริจาคสาธารณะจะแสดงรายการนี้เป็น
				<span class="font-bold">{catalogItem.name}</span>
				{#if catalogItem.unit}
					<span class="font-bold">· {catalogItem.unit}</span>
				{/if}
				(ตามแคตตาล็อก) — ชื่อประกาศ ความเร่งด่วน และหมวดหมู่ที่กรอกที่นี่ ใช้ในหลังบ้านเท่านั้น
			</p>
			{#if unitDiffers}
				<p class="font-bold">
					หน่วยที่เลือก "{typedUnit.trim()}" ต่างจากแคตตาล็อก "{catalogItem.unit}" —
					ผู้บริจาคจะเห็นหน่วยของแคตตาล็อก
				</p>
			{/if}
		{:else}
			<p>
				ยังจับคู่รายการนี้กับแคตตาล็อกไม่ได้ ({itemId}) — หน้าบริจาคสาธารณะจะแสดงรหัสนี้แทนชื่อ
				กรุณาสร้างรายการในแคตตาล็อกก่อนเปิดรับบริจาค
			</p>
		{/if}
	</div>
</div>
