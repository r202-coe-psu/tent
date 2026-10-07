<script lang="ts">
	import { toast } from 'svelte-sonner';
	import GitMerge from '@lucide/svelte/icons/git-merge';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { langState } from '$lib/states/i18n.svelte';
	import {
		formatUnit,
		isMergedItem,
		useItemMasters,
		useUnitsOfMeasure,
		type ItemMaster
	} from '$lib/features/catalog';
	import { useLedger, useMergeItems } from '../application/queries';
	import { checkItemMerge } from '../domain/item-merge';
	import { projectStockLotBalances, type StockLedger } from '../domain/operations';
	import { toStockFormItems } from '../domain/stock-form-items';
	import { qtyGt, addQty } from '$lib/utils/qty';
	import ItemCombobox from './item-combobox.svelte';

	let {
		open = $bindable(false),
		source,
		onsuccess
	}: {
		open?: boolean;
		/** The duplicate that goes away; `null` while the dialog is closed. */
		source: ItemMaster | null;
		onsuccess?: (result: { source: ItemMaster; target: ItemMaster }) => void;
	} = $props();

	const shelterCode = $derived(getShelterCode());
	const roles = $derived(authStore.user?.roles ?? []);
	const offline = $derived(authStore.needsReauth);

	const itemsQuery = useItemMasters(() => shelterCode);
	const ledgerQuery = useLedger();
	const unitsQuery = useUnitsOfMeasure();
	const mergeMutation = useMergeItems();

	const units = $derived(unitsQuery.data ?? []);
	const unitLabel = (code: string) => formatUnit(code, units, langState.current) || code;

	// The pick belongs to one source: opening the dialog for another item starts blank.
	let picked = $state({ sourceId: '', targetId: '' });
	const targetId = $derived(picked.sourceId === source?._id ? picked.targetId : '');

	// Active, un-merged items other than the source, split by whether the merge would be allowed.
	const candidates = $derived.by(() => {
		if (!source) return { allowed: [] as ItemMaster[], unitMismatch: 0 };
		const allowed: ItemMaster[] = [];
		let unitMismatch = 0;
		for (const item of itemsQuery.data ?? []) {
			if (item._id === source._id || item.deactivated || isMergedItem(item)) continue;
			const refusal = checkItemMerge({ source, target: item, roles, shelterCode });
			if (!refusal) allowed.push(item);
			else if (refusal.code === 'unit_mismatch') unitMismatch++;
		}
		return { allowed, unitMismatch };
	});

	const pickerItems = $derived(toStockFormItems([], candidates.allowed));
	const target = $derived(candidates.allowed.find((item) => item._id === targetId) ?? null);

	const refusal = $derived(
		source ? checkItemMerge({ source, target: target ?? source, roles, shelterCode }) : null
	);
	// With no target picked yet only the permission matters; "same item" is an artefact of the fallback.
	const blocker = $derived(refusal && refusal.code !== 'same_item' ? refusal : null);

	const lots = $derived.by(() => {
		if (!source || !ledgerQuery.data) return [];
		try {
			return projectStockLotBalances(
				(ledgerQuery.data as StockLedger[]).filter((entry) => entry.item_id === source._id)
			).filter((lot) => qtyGt(lot.qty, 0));
		} catch {
			return [];
		}
	});
	const totalQty = $derived(lots.reduce((sum, lot) => addQty(sum, lot.qty), '0'));

	const canSubmit = $derived(
		!!source && !!target && !blocker && !mergeMutation.isPending && !offline
	);

	function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (!source || !target || !canSubmit) return;
		const merged = { source, target };
		const ctx = {
			shelterCode,
			createdBy: authStore.user?.name ?? 'เจ้าหน้าที่คลังสินค้า (Admin)'
		};
		toast.promise(
			mergeMutation.mutateAsync({
				input: { sourceId: source._id, targetId: target._id, roles },
				ctx
			}),
			{
				loading: 'กำลังรวมสินค้า...',
				success: () => {
					open = false;
					onsuccess?.(merged);
					return `รวม “${merged.source.name}” เข้ากับ “${merged.target.name}” แล้ว`;
				},
				error: (err: unknown) => (err instanceof Error ? err.message : 'รวมสินค้าไม่สำเร็จ')
			}
		);
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-lg">
		<form onsubmit={handleSubmit} class="flex flex-col gap-4">
			<Dialog.Header>
				<Dialog.Title class="flex items-center gap-2 text-lg font-bold text-slate-900">
					<GitMerge class="h-5 w-5 text-[#0A2647]" aria-hidden="true" />
					รวมกับรายการอื่น
				</Dialog.Title>
				<Dialog.Description class="text-sm text-slate-600">
					ย้ายยอดคงเหลือของ “{source?.name ?? ''}” ไปยังสินค้าปลายทาง แล้วปิดใช้งานรายการนี้
				</Dialog.Description>
			</Dialog.Header>

			<Field.Root>
				<Field.Label for="merge-target">รวมเข้ากับสินค้า</Field.Label>
				<ItemCombobox
					id="merge-target"
					items={pickerItems}
					value={targetId}
					onSelect={(item) => (picked = { sourceId: source?._id ?? '', targetId: item?._id ?? '' })}
					isLoading={itemsQuery.isLoading}
					placeholder="ค้นหาสินค้าปลายทาง…"
					formatBalanceUnit={(item) => unitLabel(item.unit)}
				/>
				{#if candidates.unitMismatch > 0}
					<Field.Description>
						ซ่อน {candidates.unitMismatch} รายการที่หน่วยฐานไม่เข้ากันและแปลงหน่วยไม่ได้
					</Field.Description>
				{/if}
			</Field.Root>

			{#if blocker}
				<div
					role="alert"
					class="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900"
				>
					<TriangleAlert class="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
					<span>{blocker.message}</span>
				</div>
			{:else if source}
				<div class="space-y-1 rounded-xl border border-slate-200/80 bg-slate-50 p-3 text-sm">
					<p class="font-semibold text-slate-900">
						ยอดที่จะย้าย
						<span class="tabular-nums">{totalQty}</span>
						{unitLabel(source.base_unit)} จาก
						<span class="tabular-nums">{lots.length}</span> ล็อต
					</p>
					<p class="text-slate-600">
						ล็อตเดิมคงวันหมดอายุและที่จัดเก็บไว้
						ประวัติความเคลื่อนไหวจะบันทึกเป็นรายการปรับยอดเหตุผล “รวมสินค้า” และไม่สามารถย้อนกลับได้
					</p>
				</div>
			{/if}

			<Dialog.Footer class="gap-2">
				<Button type="button" variant="outline" class="min-h-11" onclick={() => (open = false)}>
					ยกเลิก
				</Button>
				<Button
					type="submit"
					class="min-h-11 bg-[#0A2647] text-white hover:bg-[#051930]"
					disabled={!canSubmit}
				>
					{mergeMutation.isPending ? 'กำลังรวม…' : 'ยืนยันรวมสินค้า'}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
