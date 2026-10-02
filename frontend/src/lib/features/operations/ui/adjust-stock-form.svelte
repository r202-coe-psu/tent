<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { DatePicker } from '$lib/components/ui/date-picker/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { formatUnit, useUnitsOfMeasure } from '$lib/features/catalog';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { useLedger, useAdjustStock, useStockBalance } from '../application/queries';
	import { useStockFormItems } from '../application/use-stock-form-items.svelte';
	import type { StockFormItem } from '../domain/stock-form-items';
	import ItemCombobox from './item-combobox.svelte';
	import { langState } from '$lib/states/i18n.svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { toast } from 'svelte-sonner';
	import Settings from '@lucide/svelte/icons/settings';
	import MinusCircle from '@lucide/svelte/icons/minus-circle';
	import PlusCircle from '@lucide/svelte/icons/plus-circle';
	import { addQty, subQty } from '$lib/utils/qty';
	import type { StockLot, StockLedger } from '../domain/operations';
	import {
		lotLocationFields,
		lotStorageKey,
		lotStorageLabel,
		storageLotFields,
		type StoragePointRef
	} from '../domain/lot-storage';
	import { useStoragePoints } from '../application/use-storage-points.svelte';
	import StoragePointSelect from './storage-point-select.svelte';

	let {
		onsuccess,
		preselectedItemId = undefined,
		initialAdjustmentType = 'write_off'
	}: {
		onsuccess?: (result?: { keepOpen: true; summary?: string }) => void;
		preselectedItemId?: string;
		initialAdjustmentType?: 'write_off' | 'add';
	} = $props();

	let lastSuccess = $state<string | null>(null);
	let moreOpen = $state(false);

	const stockItems = useStockFormItems(() => getShelterCode());
	const balanceQuery = useStockBalance();
	const ledgerQuery = useLedger();
	const adjustMutation = useAdjustStock();
	const storagePoints = useStoragePoints(() => getShelterCode());
	const unitsQuery = useUnitsOfMeasure();
	const units = $derived(unitsQuery.data ?? []);

	let selectedItemId = $state('');
	let selectedItem = $state<StockFormItem | null>(null);
	let selectedLotKey = $state<string>('');
	/** Storage point for a new lot ('' = unspecified / main store). */
	let customPointId = $state('');
	let customPoint = $state<StoragePointRef | null>(null);
	let customExpiry = $state<string>('');
	let newQtyInput = $state<string>('');
	let reason = $state<string>('');

	const items = $derived(stockItems.items);
	const balanceByItemId = $derived(balanceQuery.data ?? new Map<string, string>());

	// Calculate balance of each lot for selectedItem
	const itemLots = $derived.by(() => {
		const currentItem = selectedItem;
		if (!currentItem || !ledgerQuery.data) return [];
		const entries = (ledgerQuery.data as StockLedger[]).filter(
			(e: StockLedger) => e.item_id === currentItem._id
		);
		const lotsMap = new SvelteMap<string, { location: StockLot; expiry: string; qty: string }>();

		// Grouped by location (point id, else name — draft-shelter-storage-points)
		// and expiry; `location` is what an adjustment writes to land in this group.
		for (const entry of entries) {
			const expiry = entry.lot?.expiry || '';
			const key = `${lotStorageKey(entry.lot)}||${expiry}`;
			const current = lotsMap.get(key) || {
				location: lotLocationFields(entry.lot),
				expiry,
				qty: '0'
			};
			lotsMap.set(key, { ...current, qty: addQty(current.qty, entry.qty) });
		}

		return Array.from(lotsMap, ([key, l]) => ({
			...l,
			key,
			label: `📍 ${lotStorageLabel(l.location, storagePoints.points)} ${l.expiry ? `(หมดอายุ: ${formatExpiry(l.expiry)})` : '(ไม่ระบุวันหมดอายุ)'} - คงเหลือ ${l.qty} ${currentItem.unit}`
		}));
	});

	const currentLot = $derived(itemLots.find((l) => l.key === selectedLotKey));
	const currentLotQty = $derived(currentLot ? currentLot.qty : '0');

	// Delta Calculation
	const deltaQty = $derived.by(() => {
		if (!newQtyInput || isNaN(Number(newQtyInput))) return '0';
		const base = selectedLotKey === 'new' ? '0' : currentLotQty;
		return subQty(newQtyInput, base);
	});

	// Preferred type when delta is zero (buttons / reset); otherwise derived from delta.
	// svelte-ignore state_referenced_locally
	let preferredAdjustmentType = $state<'write_off' | 'add'>(initialAdjustmentType);

	const adjustmentType = $derived.by(() => {
		const delta = Number(deltaQty);
		if (delta < 0) return 'write_off' as const;
		if (delta > 0) return 'add' as const;
		return preferredAdjustmentType;
	});

	const isSubmitting = $derived(adjustMutation.isPending);

	// Helpers
	function formatExpiry(expiryStr: string | undefined): string {
		if (!expiryStr) return '-';
		try {
			return new Date(expiryStr).toLocaleDateString('th-TH', {
				day: '2-digit',
				month: 'short',
				year: '2-digit'
			});
		} catch {
			return expiryStr;
		}
	}

	function selectItem(item: StockFormItem) {
		selectedItem = item;
		selectedItemId = item._id;
		// Reset form fields
		selectedLotKey = '';
		customPointId = '';
		customPoint = null;
		newQtyInput = '';
		preferredAdjustmentType = initialAdjustmentType;
		reason = '';
	}

	function clearSelection() {
		selectedItem = null;
		selectedItemId = '';
		selectedLotKey = '';
		customPointId = '';
		customPoint = null;
		newQtyInput = '';
		preferredAdjustmentType = initialAdjustmentType;
		reason = '';
		customExpiry = '';
	}

	function resetForNextLine() {
		selectedLotKey = '';
		newQtyInput = '';
		reason = '';
		customPointId = '';
		customPoint = null;
		customExpiry = '';
		preferredAdjustmentType = initialAdjustmentType;
		if (!preselectedItemId) {
			clearSelection();
		}
	}

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();

		if (!selectedItem) {
			toast.error('กรุณาเลือกรายการสิ่งของ');
			return;
		}
		if (!selectedLotKey) {
			toast.error('กรุณาเลือกสถานที่/ล็อต');
			return;
		}
		if (selectedItem.perishable && selectedLotKey === 'new' && !customExpiry) {
			toast.error('สินค้าเน่าเสียได้ จำเป็นต้องระบุวันหมดอายุ');
			return;
		}
		if (!newQtyInput || isNaN(Number(newQtyInput)) || Number(newQtyInput) < 0) {
			toast.error('กรุณาระบุจำนวนใหม่ที่ถูกต้อง (ต้องไม่ติดลบ)');
			return;
		}
		if (deltaQty === '0') {
			toast.error('จำนวนใหม่เท่ากับจำนวนเดิม ไม่มีความเปลี่ยนแปลง');
			return;
		}
		if (!reason.trim()) {
			toast.error('กรุณาระบุเหตุผลในการปรับปรุง');
			return;
		}

		// Prepare Lot
		let lot: StockLot = {};
		if (selectedLotKey === 'new') {
			lot = {
				...storageLotFields(customPoint),
				expiry: customExpiry || undefined
			};
		} else if (currentLot) {
			// Refresh the name snapshot when the lot's point still exists (it may have been renamed).
			const point = storagePoints.points.find((p) => p.id === currentLot.location.storage_point_id);
			lot = {
				...(point ? storageLotFields(point) : currentLot.location),
				expiry: currentLot.expiry || undefined
			};
		}

		// Prepare input
		const input = {
			item_id: selectedItem._id,
			qty: deltaQty, // positive or negative string
			unit: selectedItem.unit,
			lot,
			ref_id: null
		};

		const ctx = {
			shelterCode: getShelterCode(),
			createdBy: authStore.user?.name ?? 'เจ้าหน้าที่คลังสินค้า (Admin)'
		};

		toast.promise(adjustMutation.mutateAsync({ input, ctx }), {
			loading: 'กำลังบันทึก...',
			success: () => {
				const name = selectedItem?.name ?? input.item_id;
				const signed = Number(deltaQty) > 0 ? `+${deltaQty}` : `${deltaQty}`;
				const summary = `${name} ${signed} ${selectedItem?.unit ?? ''}`;
				lastSuccess = `ปรับยอดแล้ว: ${summary}`;
				resetForNextLine();
				onsuccess?.({ keepOpen: true, summary });
				return 'ปรับยอดแล้ว';
			},
			error: (err: unknown) =>
				err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการปรับปรุงยอด'
		});
	}

	/**
	 * Keep the modal's locked item pinned — see `receive-stock-form.svelte`.
	 * Guarding on `selectedItem` also stops a background refetch of `items` from
	 * re-running `selectItem()` mid-edit, which would wipe the lot, quantity and
	 * reason the user is part-way through typing.
	 */
	$effect(() => {
		if (!preselectedItemId || selectedItem?._id === preselectedItemId) return;
		const item = items.find((i) => i._id === preselectedItemId);
		if (item) {
			selectItem(item);
		}
	});
</script>

<form
	onsubmit={handleSubmit}
	class="flex flex-col space-y-4 rounded-2xl border border-border/80 bg-card p-4 shadow-md sm:p-5"
>
	<div class="flex items-center gap-2 border-b border-border/60 pb-3">
		<Settings class="h-4.5 w-4.5 text-primary" aria-hidden="true" />
		<h3 class="text-sm font-bold text-foreground">ปรับปรุง</h3>
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
		<Field.Root class="relative col-span-1 sm:col-span-2">
			<Field.Label for="item-search"
				>สินค้า <span class="font-bold text-destructive">*</span></Field.Label
			>
			<ItemCombobox
				id="item-search"
				{items}
				bind:value={selectedItemId}
				disabled={!!preselectedItemId}
				isLoading={stockItems.isLoading}
				{balanceByItemId}
				formatBalanceUnit={(item) => formatUnit(item.unit, units, langState.current) || item.unit}
				onSelect={(item) => {
					if (item) selectItem(item);
					else clearSelection();
				}}
			/>
		</Field.Root>

		{#if selectedItem}
			<Field.Root class="col-span-1 sm:col-span-2">
				<Field.Label for="lot-select"
					>ล็อต <span class="font-bold text-destructive">*</span></Field.Label
				>
				<Select.Root type="single" bind:value={selectedLotKey}>
					<Select.Trigger
						id="lot-select"
						class="min-h-11 w-full rounded-md border border-input bg-white px-3 text-sm font-medium"
					>
						{selectedLotKey === 'new'
							? 'สร้างที่เก็บใหม่…'
							: (itemLots.find((lot) => lot.key === selectedLotKey)?.label ?? 'เลือกล็อต')}
					</Select.Trigger>
					<Select.Content>
						{#each itemLots as lot (lot.key)}
							<Select.Item value={lot.key} label={lot.label} />
						{/each}
						<Select.Item value="new" label="สร้างที่เก็บใหม่…" />
					</Select.Content>
				</Select.Root>
			</Field.Root>

			{#if selectedLotKey === 'new'}
				<Field.Root class="col-span-1">
					<Field.Label for="custom-location">สถานที่จัดเก็บใหม่</Field.Label>
					<StoragePointSelect
						id="custom-location"
						points={storagePoints.points}
						bind:value={customPointId}
						onchange={(point) => (customPoint = point)}
					/>
				</Field.Root>
				<Field.Root class="col-span-1">
					<Field.Label for="custom-expiry">
						วันหมดอายุ
						{#if selectedItem.perishable}
							<span class="font-bold text-destructive">*</span>
						{:else}
							<span class="font-normal text-muted-foreground">(ไม่บังคับ)</span>
						{/if}
					</Field.Label>
					<DatePicker id="custom-expiry" ariaLabel="วันหมดอายุ" bind:value={customExpiry} />
				</Field.Root>
			{/if}

			{#if selectedLotKey}
				<Field.Root class="col-span-1">
					<Field.Label for="new-qty"
						>จำนวนใหม่ <span class="font-bold text-destructive">*</span></Field.Label
					>
					<div class="relative">
						<Input
							id="new-qty"
							type="number"
							placeholder="0"
							min="0"
							step="any"
							bind:value={newQtyInput}
							class="min-h-11 pr-16 font-mono font-bold"
						/>
						<span
							class="absolute top-1/2 right-3 -translate-y-1/2 text-xs font-bold text-muted-foreground"
						>
							{selectedItem.unit}
						</span>
					</div>
				</Field.Root>

				<div
					class="col-span-1 flex items-center justify-between gap-3 rounded-xl border border-border/50 bg-muted/40 p-3 sm:col-span-1"
				>
					<span class="text-xs text-muted-foreground">ปรับยอด</span>
					<span
						class={[
							'rounded-lg border px-3 py-1 font-mono text-base font-black',
							Number(deltaQty) < 0
								? 'border-rose-500/20 bg-rose-500/10 text-rose-600'
								: Number(deltaQty) > 0
									? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600'
									: 'border-border bg-muted text-muted-foreground'
						]}
					>
						{Number(deltaQty) > 0 ? '+' : ''}{deltaQty}
					</span>
				</div>

				<div class="col-span-1 sm:col-span-2">
					<button
						type="button"
						class="flex min-h-11 w-full items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-3 text-sm font-semibold"
						onclick={() => (moreOpen = !moreOpen)}
						aria-expanded={moreOpen}
					>
						<span>เพิ่มเติม</span>
						<span class="text-xs text-muted-foreground"
							>{moreOpen ? 'ซ่อน' : 'เหตุผล · ประเภท'}</span
						>
					</button>
					{#if moreOpen}
						<div class="mt-3 space-y-4">
							<div class="grid grid-cols-2 gap-3">
								<Button
									type="button"
									variant={adjustmentType === 'write_off' ? 'destructive' : 'outline'}
									size="lg"
									onclick={() => {
										if (Number(deltaQty) > 0) {
											toast.error('จำนวนใหม่มากกว่าเดิม — ใช้ปรับยอดเพิ่ม');
											return;
										}
										preferredAdjustmentType = 'write_off';
									}}
									disabled={Number(deltaQty) > 0}
									class="min-h-11 font-bold"
								>
									<MinusCircle class="h-4 w-4" />
									เขียนทิ้ง
								</Button>
								<Button
									type="button"
									variant={adjustmentType === 'add' ? 'default' : 'outline'}
									size="lg"
									onclick={() => {
										if (Number(deltaQty) < 0) {
											toast.error('จำนวนใหม่น้อยกว่าเดิม — ใช้เขียนทิ้ง');
											return;
										}
										preferredAdjustmentType = 'add';
									}}
									disabled={Number(deltaQty) < 0}
									class="min-h-11 font-bold"
								>
									<PlusCircle class="h-4 w-4" />
									ปรับเพิ่ม
								</Button>
							</div>
							<Field.Root>
								<Field.Label for="reason"
									>เหตุผล <span class="font-bold text-destructive">*</span></Field.Label
								>
								<Textarea
									id="reason"
									placeholder="เช่น ของเสีย / พบตกหล่น"
									bind:value={reason}
									rows={2}
								/>
							</Field.Root>
						</div>
					{:else}
						<!-- reason still required: show compact when collapsed -->
						<Field.Root class="mt-3">
							<Field.Label for="reason-compact"
								>เหตุผล <span class="font-bold text-destructive">*</span></Field.Label
							>
							<Textarea
								id="reason-compact"
								placeholder="เช่น ของเสีย / พบตกหล่น"
								bind:value={reason}
								rows={2}
							/>
						</Field.Root>
					{/if}
				</div>

				<div class="col-span-1 pt-1 sm:col-span-2">
					<Button
						type="submit"
						size="lg"
						disabled={isSubmitting || deltaQty === '0' || !reason.trim()}
						class="min-h-11 w-full font-bold"
					>
						{isSubmitting ? 'กำลังบันทึก…' : 'บันทึกแล้วปรับชิ้นถัดไป'}
					</Button>
				</div>
			{/if}
		{/if}
	</Field.FieldGroup>
</form>
