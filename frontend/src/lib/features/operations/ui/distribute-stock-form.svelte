<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
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
	import { dailyConsumption, daysOfCover, resolveReorderThreshold } from '../domain/stock-summary';
	import {
		itemMasterUnit,
		formatUnit,
		useUnitsOfMeasure,
		itemSelectableUoms,
		defaultIssueUom,
		toLedgerQtyUnit,
		qtyToBaseUnit,
		qtyFromBaseUnit
	} from '$lib/features/catalog';
	import { useSupplyItems, useThresholdOverrides } from '$lib/features/supply';
	import { langState } from '$lib/states/i18n.svelte';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { useDistributeStock, useStockBalance, useLedger } from '../application/queries';
	import { useStockFormItems } from '../application/use-stock-form-items.svelte';
	import type { StockFormItem } from '../domain/stock-form-items';
	import ItemCombobox from './item-combobox.svelte';
	import { toast } from 'svelte-sonner';
	import Minus from '@lucide/svelte/icons/minus';
	import Plus from '@lucide/svelte/icons/plus';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import { qtyGt, qtyGte, qtyIsZero, qtyLte, addQty, subQty, persistQty } from '$lib/utils/qty';
	import { ulid } from '$lib/db/ulid';
	import { formatLotClockLine } from '../domain/lot-age';
	import { lotStorageLabel } from '../domain/lot-storage';
	import { useStoragePoints } from '../application/use-storage-points.svelte';

	const DEST_PRESETS = ['ครัวกลาง', 'โซนเต็นท์ A', 'โซนเต็นท์ B', 'ห้องพยาบาล'] as const;
	const QTY_CHIPS = [10, 20, 50] as const;

	let {
		onsuccess,
		preselectedItemId = undefined,
		occupancy = 0
	}: {
		onsuccess?: (result?: { keepOpen: boolean; summary?: string }) => void;
		preselectedItemId?: string;
		occupancy?: number;
	} = $props();

	// Session expired (`needsReauth`): every save button is off until the user signs in again.
	const offline = $derived(authStore.needsReauth);

	const stockItems = useStockFormItems(() => getShelterCode());
	const unitsQuery = useUnitsOfMeasure();
	const units = $derived(unitsQuery.data ?? []);
	const storagePoints = useStoragePoints(() => getShelterCode());
	const balanceQuery = useStockBalance();
	const ledgerQuery = useLedger();
	const distributeMutation = useDistributeStock();
	const supplyItemsQuery = useSupplyItems();
	const overridesQuery = useThresholdOverrides();

	let selectedItemId = $state('');
	let selectedItem = $state<StockFormItem | null>(null);
	let noteInputEl = $state<HTMLInputElement | null>(null);
	let keepOpenOnSuccess = $state(true);

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

	const maxQtyInUnit = $derived.by(() => {
		if (!selectedItem || !$formData.unit) return '0';
		try {
			return qtyFromBaseUnit(maxLotQty, $formData.unit, selectedItem);
		} catch {
			return maxLotQty;
		}
	});

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

	const reorderPolicy = $derived.by(() => {
		const current = selectedItem;
		if (!current) return null;
		const supply = (supplyItemsQuery.data ?? []).find((s) => s._id === current._id);
		const override = (overridesQuery.data ?? []).find((o) => o.item_id === current._id);
		if (!supply && !override) return null;
		return {
			item: supply
				? {
						reorder_level: supply.reorder_level,
						consumption_rate: supply.consumption_rate,
						target_reserve_days: supply.target_reserve_days,
						timeframe: supply.timeframe
					}
				: {},
			override: override
				? {
						reorder_level: override.reorder_level,
						consumption_rate: override.consumption_rate,
						target_reserve_days: override.target_reserve_days
					}
				: null
		};
	});

	const afterDistributeWarning = $derived.by(() => {
		if (!selectedItem || !reorderPolicy || !$formData.qty) return null;
		try {
			const inBase = qtyToBaseUnit($formData.qty, $formData.unit, selectedItem);
			const remaining = subQty(currentStock, inBase);
			const threshold = resolveReorderThreshold(
				occupancy,
				reorderPolicy.item,
				reorderPolicy.override
			);
			if (!threshold || !qtyLte(remaining, threshold)) return null;
			const daily = dailyConsumption(occupancy, reorderPolicy.item, reorderPolicy.override);
			const cover = daysOfCover(remaining, daily);
			return {
				remaining,
				threshold,
				coverDays: cover
			};
		} catch {
			return null;
		}
	});

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

	const submitQtyLabel = $derived.by(() => {
		const qty = $formData.qty;
		if (!qty || Number(qty) <= 0) return selectedUnitLabel;
		return `${qty} ${selectedUnitLabel}`;
	});

	function chipClass(active: boolean) {
		return [
			'inline-flex min-h-11 shrink-0 items-center rounded-full px-3.5 text-sm font-semibold transition-colors',
			active
				? 'border-2 border-[#0284C7] bg-sky-50 text-sky-900'
				: 'border border-slate-300 bg-white text-slate-700 hover:border-slate-400'
		].join(' ');
	}

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

	function setQty(value: string) {
		try {
			const capped = qtyGt(value, maxQtyInUnit) ? maxQtyInUnit : value;
			$formData.qty = persistQty(capped) as unknown as typeof $formData.qty;
		} catch {
			$formData.qty = value as unknown as typeof $formData.qty;
		}
	}

	function stepQty(delta: number) {
		const current =
			$formData.qty && !Number.isNaN(Number($formData.qty)) ? String($formData.qty) : '0';
		const next = delta >= 0 ? addQty(current, delta) : subQty(current, Math.abs(delta));
		if (qtyLte(next, 0)) {
			$formData.qty = '' as unknown as typeof $formData.qty;
			return;
		}
		setQty(next);
	}

	function setDestination(label: string | null) {
		if (label === null) {
			$formData.note = '';
			queueMicrotask(() => noteInputEl?.focus());
			return;
		}
		$formData.note = label;
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
		const shouldKeepOpen = keepOpenOnSuccess;

		toast.promise(distributeMutation.mutateAsync({ input: payload, ctx }), {
			loading: 'กำลังบันทึก...',
			success: () => {
				const name = selectedItem?.name ?? data.item_id;
				const unitLabel = formatUnit(displayUnit, units, langState.current) || displayUnit;
				const summary = `${name} −${displayQty} ${unitLabel}`;
				resetForNextLine();
				onsuccess?.({ keepOpen: shouldKeepOpen, summary });
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

	const canSubmit = $derived(
		!offline &&
			!$submitting &&
			!!$formData.qty &&
			qtyGt(currentStock, 0) &&
			itemLots.length > 0 &&
			!isQtyOverStock
	);
</script>

<form method="POST" use:form.enhance class="flex flex-col space-y-4">
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
						allowCreate
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

		<div class="col-span-1 space-y-2 sm:col-span-2">
			<Form.Label>จำนวน <span class="font-bold text-destructive">*</span></Form.Label>
			<div class="flex flex-wrap items-stretch gap-2">
				<div
					class="flex min-w-0 flex-1 items-stretch overflow-hidden rounded-lg border border-input"
				>
					<Button
						type="button"
						variant="ghost"
						class="h-auto min-h-11 rounded-none px-3"
						onclick={() => stepQty(-1)}
						disabled={!selectedItem}
						aria-label="ลดจำนวน"
					>
						<Minus class="h-4 w-4" />
					</Button>
					<Form.Field {form} name="qty" class="min-w-0 flex-1 space-y-0">
						<Form.Control>
							{#snippet children({ props })}
								<Input
									{...props}
									type="number"
									placeholder="0"
									min="0.01"
									step="any"
									bind:value={$formData.qty}
									class="min-h-11 rounded-none border-0 border-x border-input font-mono font-bold shadow-none focus-visible:ring-0"
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>
					<Button
						type="button"
						variant="ghost"
						class="h-auto min-h-11 rounded-none px-3"
						onclick={() => stepQty(1)}
						disabled={!selectedItem}
						aria-label="เพิ่มจำนวน"
					>
						<Plus class="h-4 w-4" />
					</Button>
				</div>

				<Form.Field {form} name="unit" class="w-28 shrink-0 space-y-0 sm:w-32">
					<Form.Control>
						{#snippet children({ props })}
							{#if !selectedItem}
								<Input {...props} placeholder="หน่วย" value="" readonly disabled class="min-h-11" />
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
				</Form.Field>
			</div>
			<div class="flex flex-wrap gap-2 pt-1">
				{#each QTY_CHIPS as chip (chip)}
					<button
						type="button"
						class={chipClass(String($formData.qty) === String(chip))}
						disabled={!selectedItem}
						onclick={() => setQty(String(chip))}
					>
						{chip}
					</button>
				{/each}
				<button
					type="button"
					class={chipClass(
						String($formData.qty) === String(maxQtyInUnit) && qtyGt(maxQtyInUnit, 0)
					)}
					disabled={!selectedItem || qtyLte(maxQtyInUnit, 0)}
					onclick={() => setQty(maxQtyInUnit)}
				>
					ทั้งหมด ({maxQtyInUnit})
				</button>
			</div>
		</div>

		<div class="col-span-1 space-y-2 sm:col-span-2">
			<Form.Label>เบิกให้ใคร / ไปที่ไหน</Form.Label>
			<div class="flex flex-wrap gap-2">
				{#each DEST_PRESETS as preset (preset)}
					<button
						type="button"
						class={chipClass($formData.note === preset)}
						onclick={() => setDestination(preset)}
					>
						{preset}
					</button>
				{/each}
				<button
					type="button"
					class={chipClass(
						!!$formData.note && !(DEST_PRESETS as readonly string[]).includes($formData.note)
					)}
					onclick={() => setDestination(null)}
				>
					อื่นๆ...
				</button>
			</div>
			<Form.Field {form} name="note" class="pt-1">
				<Form.Control>
					{#snippet children({ props })}
						<Input
							{...props}
							bind:ref={noteInputEl}
							placeholder="ปลายทาง / ผู้รับ (ไม่บังคับ)"
							bind:value={$formData.note}
							class="min-h-11"
						/>
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>
		</div>

		{#if afterDistributeWarning}
			<div
				class="col-span-1 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950 sm:col-span-2"
				role="status"
			>
				<AlertTriangle class="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
				<div>
					<p class="font-bold">ยอดหลังเบิกจะต่ำกว่าเกณฑ์</p>
					<p class="text-xs font-medium text-amber-900/80">
						เหลือ {afterDistributeWarning.remaining}
						{baseUnitLabel} (เกณฑ์ {afterDistributeWarning.threshold}
						{baseUnitLabel})
						{#if afterDistributeWarning.coverDays !== null}
							· ครอบคลุมประมาณ {afterDistributeWarning.coverDays} วัน
						{/if}
					</p>
				</div>
			</div>
		{/if}

		<div
			class="sticky bottom-0 z-10 col-span-1 -mx-4 -mb-4 flex flex-col gap-2 border-t border-slate-200 bg-slate-50 px-4 py-4 sm:col-span-2 sm:-mx-6 sm:-mb-6 sm:flex-row sm:justify-end sm:px-6"
		>
			<Button
				type="submit"
				variant="outline"
				size="lg"
				disabled={!canSubmit}
				class="min-h-11 flex-1 font-bold"
				onclick={() => {
					keepOpenOnSuccess = true;
				}}
			>
				{$submitting ? 'กำลังบันทึก…' : 'บันทึกแล้วเบิกรายการถัดไป'}
			</Button>
			<Form.Button
				size="lg"
				disabled={!canSubmit}
				class="min-h-11 flex-1 font-bold"
				onclick={() => {
					keepOpenOnSuccess = false;
				}}
			>
				{$submitting ? 'กำลังบันทึก…' : `เบิก ${submitQtyLabel}`}
			</Form.Button>
		</div>
	</Field.FieldGroup>
</form>
