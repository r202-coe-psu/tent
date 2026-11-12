<script lang="ts">
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { formatUnit, useUnitDimensionResolver, useUnitsOfMeasure } from '$lib/features/catalog';
	import { getShelterCode } from '$lib/db/shelter';
	import { authStore } from '$lib/stores/auth.svelte';
	import { langState } from '$lib/states/i18n.svelte';
	import { qtyAbs, subQty } from '$lib/utils/qty';
	import { toast } from 'svelte-sonner';
	import { useAdjustStock } from '../../application/queries';
	import { fractionWriteOffInput } from '../../domain/fraction-write-off';
	import type { StockLotBalance } from '../../domain/operations';
	import { OFFLINE_HINT } from './hints';

	let {
		lot,
		offline = false
	}: {
		lot: StockLotBalance;
		/** Session expired: the same gate that turns "ปรับยอด" off. */
		offline?: boolean;
	} = $props();

	const adjustMutation = useAdjustStock();
	const unitsQuery = useUnitsOfMeasure();
	const unitDimension = useUnitDimensionResolver();

	let open = $state(false);

	const input = $derived(fractionWriteOffInput(lot, unitDimension.resolve(lot.unit)));
	const fraction = $derived(input ? qtyAbs(input.qty) : '');
	const remaining = $derived(input ? subQty(lot.qty, fraction) : '');
	const unitLabel = $derived(
		formatUnit(lot.unit, unitsQuery.data ?? [], langState.current) || lot.unit
	);

	function confirm() {
		if (!input) return;
		open = false;
		const ctx = {
			shelterCode: getShelterCode(),
			createdBy: authStore.user?.name ?? 'เจ้าหน้าที่คลังสินค้า (Admin)'
		};
		toast.promise(adjustMutation.mutateAsync({ input, ctx }), {
			loading: 'กำลังบันทึก...',
			success: `ตัดเศษ ${fraction} ${unitLabel} แล้ว`,
			error: (err: unknown) =>
				err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการตัดเศษเหลือทิ้ง'
		});
	}
</script>

{#if input}
	<Button
		type="button"
		variant="outline"
		size="sm"
		class="mt-2 min-h-9 border-slate-300 bg-white text-slate-800"
		disabled={offline || adjustMutation.isPending}
		title={offline ? OFFLINE_HINT : undefined}
		onclick={() => (open = true)}
	>
		ตัดเศษเหลือทิ้ง
	</Button>

	<AlertDialog.Root bind:open>
		<AlertDialog.Content>
			<AlertDialog.Header>
				<AlertDialog.Title>ตัดเศษเหลือทิ้ง</AlertDialog.Title>
				<AlertDialog.Description>
					ตัดเศษ {fraction}
					{unitLabel} ออกจาก lot นี้ ยอดคงเหลือจะเป็น {remaining}
					{unitLabel} บันทึกเป็นรายการปรับยอด และไม่สามารถย้อนกลับได้
				</AlertDialog.Description>
			</AlertDialog.Header>
			<AlertDialog.Footer>
				<AlertDialog.Cancel>ยกเลิก</AlertDialog.Cancel>
				<AlertDialog.Action
					class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
					onclick={confirm}
				>
					ตัดเศษเหลือทิ้ง
				</AlertDialog.Action>
			</AlertDialog.Footer>
		</AlertDialog.Content>
	</AlertDialog.Root>
{/if}
