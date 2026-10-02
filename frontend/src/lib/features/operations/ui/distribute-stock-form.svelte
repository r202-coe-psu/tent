<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import {
		distributeInputSchema,
		type DistributeInput,
		projectStockLotBalances,
		sortStockLotsByConsumptionOrder,
		type StockLedger,
		StockLotIntegrityError
	} from '../domain/operations';
	import {
		itemMasterUnit,
		formatUnit,
		useUnitsOfMeasure,
		itemSelectableUoms,
		defaultIssueUom,
		toLedgerQtyUnit,
		qtyToBaseUnit
	} from '$lib/features/catalog';
	import { langState } from '$lib/states/i18n.svelte';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { useDistributeStock, useStockBalance, useLedger } from '../application/queries';
	import { useStockFormItems } from '../application/use-stock-form-items.svelte';
	import type { StockFormItem } from '../domain/stock-form-items';
	import ItemCombobox from './item-combobox.svelte';
	import { toast } from 'svelte-sonner';
	import PackageMinus from '@lucide/svelte/icons/package-minus';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import { qtyGt, qtyGte, qtyIsZero } from '$lib/utils/qty';
	import { ulid } from '$lib/db/ulid';
	import { formatLotClockLine } from '../domain/lot-age';
	import { lotStorageLabel } from '../domain/lot-storage';
	import { useStoragePoints } from '../application/use-storage-points.svelte';

	let {
		onsuccess,
		preselectedItemId = undefined
	}: {
		onsuccess?: (result?: { keepOpen: true; summary?: string }) => void;
		preselectedItemId?: string;
	} = $props();

	// Session expired (`needsReauth`): every save button is off until the user signs in again.
	const offline = $derived(authStore.needsReauth);

	let lastSuccess = $state<string | null>(null);
	let moreOpen = $state(false);

	const stockItems = useStockFormItems(() => getShelterCode());
	const unitsQuery = useUnitsOfMeasure();
	const units = $derived(unitsQuery.data ?? []);
	const storagePoints = useStoragePoints(() => getShelterCode());
	const balanceQuery = useStockBalance();
	const ledgerQuery = useLedger();
	const distributeMutation = useDistributeStock();

	let selectedItemId = $state('');
	let selectedItem = $state<StockFormItem | null>(null);

	const items = $derived(stockItems.items);
	const balanceByItemId = $derived(balanceQuery.data ?? new Map<string, string>());

	const currentStock = $derived.by(() => {
		if (!selectedItem || !balanceQuery.data) return '0';
		return balanceQuery.data.get(selectedItem._id) ?? '0';
	});

	// Calculate per-lot balances for selectedItem
	const lotProjection = $derived.by(() => {
		const current = selectedItem;
		if (!current || !ledgerQuery.data) return { lots: [], error: null };
		try {
			const lots = projectStockLotBalances(ledgerQuery.data as StockLedger[]).filter(
				(l) => l.item_id === current._id && qtyGt(l.qty, 0)
			);
			return { lots: sortStockLotsByConsumptionOrder(lots), error: null };
		} catch (error) {
			if (!(error instanceof StockLotIntegrityError)) throw error;
			return { lots: [], error: error.message };
		}
	});
	const itemLots = $derived(lotProjection.lots);
	const lotProjectionError = $derived(lotProjection.error);

	const activeLot = $derived(itemLots.find((l) => l.lot_ref === $formData.lot_ref));
	const maxLotQty = $derived(activeLot ? activeLot.qty : currentStock);

	const isQtyOverStock = $derived.by(() => {
		if (!$formData.qty || !selectedItem) return false;
		try {
			const inBase = qtyToBaseUnit($formData.qty, $formData.unit, selectedItem);
			return qtyGt(inBase, maxLotQty);
		} catch {
			return true;
		}
	});

	const unitOptions = $derived(selectedItem ? itemSelectableUoms(selectedItem) : []);

	const form = superForm(
		defaults(
			{
				ref_id: `requisition_ticket:direct-${ulid()}`,
				lot_ref: ''
			},
			zod4(distributeInputSchema)
		),
		{
			SPA: true,
			validators: zod4(distributeInputSchema),
			resetForm: true,
			onUpdate: async ({ form: validated }) => {
				if (!validated.valid) {
					toast.error('กรุณาตรวจสอบข้อมูลในฟอร์ม');
					return;
				}

				if (!validated.data.lot_ref) {
					toast.error('กรุณาเลือกสถานที่/ล็อตที่ต้องการเบิกจ่าย');
					return;
				}

				// Validate sufficient stock in selected lot (ledger qty is always base_unit)
				const packaging = selectedItem ?? { base_unit: validated.data.unit, conversions: [] };
				let qtyInBase: string;
				try {
					qtyInBase = qtyToBaseUnit(validated.data.qty, validated.data.unit, packaging);
				} catch {
					toast.error('หน่วยที่เลือกไม่ถูกต้องสำหรับสินค้านี้');
					return;
				}
				if (qtyGt(qtyInBase, maxLotQty)) {
					toast.error(
						`ยอดคงเหลือในล็อตนี้ไม่เพียงพอ (มี ${maxLotQty} ${formatUnit(itemMasterUnit(packaging), units, langState.current)} ต้องการแจกจ่าย ${validated.data.qty} ${formatUnit(validated.data.unit, units, langState.current)})`
					);
					return;
				}

				await handleCommit(validated.data);
			}
		}
	);

	const { form: formData, submitting, reset } = form;

	const selectedUnitLabel = $derived(
		formatUnit($formData.unit, units, langState.current) || $formData.unit || 'เลือกหน่วย'
	);
	const baseUnitLabel = $derived(
		selectedItem
			? formatUnit(itemMasterUnit(selectedItem), units, langState.current) ||
					itemMasterUnit(selectedItem)
			: ''
	);

	// Auto-select the first lot (FEFO) when item lots load or change
	$effect(() => {
		if (itemLots.length > 0) {
			if (!$formData.lot_ref || !itemLots.some((l) => l.lot_ref === $formData.lot_ref)) {
				$formData.lot_ref = itemLots[0].lot_ref;
			}
		} else {
			$formData.lot_ref = '';
		}
	});

	function lotLabel(lot: (typeof itemLots)[number]): string {
		const place = lotStorageLabel(lot.lot, storagePoints.points);
		const no = lot.lot?.lot_no ? ` · ${lot.lot.lot_no}` : '';
		const clocks = formatLotClockLine(lot);
		const clockPart = clocks ? ` · ${clocks}` : '';
		return `${place}${no} · คงเหลือ ${lot.qty} ${baseUnitLabel}${clockPart}`;
	}

	function selectItem(item: StockFormItem) {
		selectedItem = item;
		selectedItemId = item._id;
		$formData.item_id = item._id;
		$formData.unit = defaultIssueUom(item);
		$formData.ref_id = `requisition_ticket:direct-${ulid()}`;
	}

	function clearSelection() {
		selectedItem = null;
		selectedItemId = '';
		$formData.item_id = '';
		$formData.unit = '';
		$formData.lot_ref = '';
		$formData.ref_id = `requisition_ticket:direct-${ulid()}`;
	}

	function resetForNextLine() {
		$formData.qty = '' as unknown as typeof $formData.qty;
		$formData.note = '';
		$formData.lot_ref = '';
		$formData.ref_id = `requisition_ticket:direct-${ulid()}`;
		if (!preselectedItemId) {
			clearSelection();
			reset({
				data: {
					item_id: '',
					unit: '',
					qty: '',
					note: '',
					ref_id: `requisition_ticket:direct-${ulid()}`,
					lot_ref: ''
				}
			});
		}
	}

	async function handleCommit(data: DistributeInput) {
		const ctx = {
			shelterCode: getShelterCode(),
			createdBy: authStore.user?.name ?? 'เจ้าหน้าที่คลังสินค้า (Admin)'
		};

		if (!data.ref_id) {
			data.ref_id = `requisition_ticket:direct-${ulid()}`;
		}

		const packaging = selectedItem ?? { base_unit: data.unit, conversions: [] };
		const displayUnit = data.unit;
		const displayQty = data.qty;
		const ledger = toLedgerQtyUnit(data.qty, data.unit, packaging);
		const payload: DistributeInput = { ...data, qty: ledger.qty, unit: ledger.unit };

		toast.promise(distributeMutation.mutateAsync({ input: payload, ctx }), {
			loading: 'กำลังบันทึก...',
			success: () => {
				const name = selectedItem?.name ?? data.item_id;
				const unitLabel = formatUnit(displayUnit, units, langState.current) || displayUnit;
				const summary = `${name} −${displayQty} ${unitLabel}`;
				lastSuccess = `เบิกแล้ว: ${summary}`;
				resetForNextLine();
				onsuccess?.({ keepOpen: true, summary });
				return 'เบิกแล้ว';
			},
			error: (err: unknown) =>
				err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการบันทึกข้อมูล'
		});
	}

	/**
	 * Keep the modal's locked item pinned to the form — see the same effect in
	 * `receive-stock-form.svelte`. `clearSelection()` on a successful submit
	 * empties `item_id`/`unit` while the combobox is `disabled`, so the pin has to
	 * re-apply on `$formData.item_id` rather than only when `items` loads.
	 */
	$effect(() => {
		if (!preselectedItemId || $formData.item_id === preselectedItemId) return;
		const item = items.find((i) => i._id === preselectedItemId);
		if (item) {
			selectItem(item);
		}
	});
</script>

<form
	method="POST"
	use:form.enhance
	class="flex flex-col space-y-4 rounded-2xl border border-border/80 bg-card p-4 shadow-md sm:p-5"
>
	<div class="flex items-center gap-2 border-b border-border/60 pb-3">
		<PackageMinus class="h-4.5 w-4.5 text-primary" aria-hidden="true" />
		<h3 class="text-sm font-bold text-foreground">เบิกจ่าย</h3>
	</div>

	{#if lastSuccess}
		<p
			class="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800"
			role="status"
		>
			{lastSuccess} ✓
		</p>
	{/if}

	<Field.FieldGroup class="grid grid-cols-1 gap-4 sm:grid-cols-2">
		<Form.Field {form} name="item_id" class="relative col-span-1 sm:col-span-2">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>สินค้า <span class="font-bold text-destructive">*</span></Form.Label>
					<ItemCombobox
						id={props.id}
						name={props.name}
						aria-invalid={props['aria-invalid']}
						aria-describedby={props['aria-describedby']}
						{items}
						bind:value={selectedItemId}
						disabled={!!preselectedItemId}
						isLoading={stockItems.isLoading || balanceQuery.isLoading}
						{balanceByItemId}
						disableWhenEmpty={true}
						formatBalanceUnit={(item) =>
							formatUnit(item.unit, units, langState.current) || item.unit}
						onSelect={(item) => {
							if (item) selectItem(item);
							else clearSelection();
						}}
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		{#if selectedItem}
			<div
				class="col-span-1 flex items-center justify-between rounded-xl border border-border/50 bg-muted/50 p-3 sm:col-span-2"
			>
				<span class="text-sm text-muted-foreground">คงเหลือ</span>
				<span
					class="text-sm font-bold {!qtyIsZero(currentStock) && qtyGte(currentStock, 0)
						? 'text-primary'
						: 'text-destructive'}"
				>
					{currentStock}
					{baseUnitLabel}
				</span>
			</div>

			<Form.Field {form} name="lot_ref" class="col-span-1 sm:col-span-2">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label>ล็อต <span class="font-bold text-destructive">*</span></Form.Label>
						{#if ledgerQuery.isLoading}
							<div class="text-xs text-muted-foreground">กำลังโหลดล็อต…</div>
						{:else if lotProjectionError}
							<div
								class="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs font-semibold text-destructive"
							>
								คำนวณยอดล็อตไม่ได้ — {lotProjectionError}
							</div>
						{:else if itemLots.length === 0}
							<div
								class="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs font-semibold text-destructive"
							>
								ไม่พบล็อตที่มีคงเหลือ
							</div>
						{:else}
							<Select.Root type="single" bind:value={$formData.lot_ref}>
								<Select.Trigger
									{...props}
									class="min-h-11 w-full rounded-md border border-input bg-white px-3 text-left text-sm font-medium"
								>
									{activeLot ? lotLabel(activeLot) : 'เลือกล็อต'}
								</Select.Trigger>
								<Select.Content>
									{#each itemLots as lot (lot.lot_ref)}
										<Select.Item value={lot.lot_ref} label={lotLabel(lot)} />
									{/each}
								</Select.Content>
							</Select.Root>
							{#if activeLot}
								{@const clocks = formatLotClockLine(activeLot)}
								{#if clocks}
									<p class="mt-1.5 text-xs text-muted-foreground">{clocks}</p>
								{/if}
							{/if}
						{/if}
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>
		{/if}

		<Form.Field {form} name="qty" class="col-span-1">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>จำนวน <span class="font-bold text-destructive">*</span></Form.Label>
					<Input
						{...props}
						type="number"
						placeholder="0"
						min="0.01"
						step="any"
						bind:value={$formData.qty}
						class="min-h-11 font-mono font-bold"
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="unit" class="col-span-1">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>หน่วย <span class="font-bold text-destructive">*</span></Form.Label>
					{#if !selectedItem}
						<Input
							{...props}
							placeholder="เลือกสินค้าก่อน"
							value=""
							readonly
							disabled
							class="min-h-11"
						/>
					{:else if unitOptions.length <= 1}
						<Input {...props} value={selectedUnitLabel} readonly disabled class="min-h-11" />
					{:else}
						<Select.Root
							type="single"
							value={$formData.unit}
							onValueChange={(val) => {
								if (val) $formData.unit = val;
							}}
						>
							<Select.Trigger
								{...props}
								class="min-h-11 w-full rounded-md border border-input bg-white px-3 text-sm font-medium"
							>
								{selectedUnitLabel}
							</Select.Trigger>
							<Select.Content>
								{#each unitOptions as option (option.code)}
									<Select.Item
										value={option.code}
										label={formatUnit(option.code, units, langState.current) || option.code}
									/>
								{/each}
							</Select.Content>
						</Select.Root>
					{/if}
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<div class="col-span-1 sm:col-span-2">
			<button
				type="button"
				class="flex min-h-11 w-full items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-3 text-sm font-semibold"
				onclick={() => (moreOpen = !moreOpen)}
				aria-expanded={moreOpen}
			>
				<span>เพิ่มเติม</span>
				<ChevronDown
					class="h-4 w-4 transition-transform {moreOpen ? 'rotate-180' : ''}"
					aria-hidden="true"
				/>
			</button>
			{#if moreOpen}
				<div class="mt-3">
					<Form.Field {form} name="note" class="col-span-1 sm:col-span-2">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>ปลายทาง / ผู้รับ</Form.Label>
								<Input
									{...props}
									placeholder="เช่น โซนเต็นท์ A"
									bind:value={$formData.note}
									class="min-h-11"
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>
				</div>
			{/if}
		</div>

		<div class="col-span-1 pt-1 sm:col-span-2">
			<Form.Button
				size="lg"
				disabled={offline ||
					$submitting ||
					!$formData.qty ||
					!qtyGt(currentStock, 0) ||
					itemLots.length === 0 ||
					isQtyOverStock}
				class="min-h-11 w-full font-bold"
			>
				{$submitting ? 'กำลังบันทึก…' : 'บันทึกแล้วเบิกชิ้นถัดไป'}
			</Form.Button>
		</div>
	</Field.FieldGroup>
</form>
