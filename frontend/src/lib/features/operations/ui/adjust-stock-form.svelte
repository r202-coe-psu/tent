<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { DatePicker } from '$lib/components/ui/date-picker/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { useSupplyItems } from '$lib/features/supply';
	import { itemMasterUnit, useItemMasters } from '$lib/features/catalog';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { useLedger, useAdjustStock } from '../application/queries';
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
		onsuccess?: () => void;
		preselectedItemId?: string;
		initialAdjustmentType?: 'write_off' | 'add';
	} = $props();

	// Queries & Mutations
	const itemsQuery = useSupplyItems();
	const itemMastersQuery = useItemMasters(() => getShelterCode());
	const ledgerQuery = useLedger();
	const adjustMutation = useAdjustStock();
	const storagePoints = useStoragePoints(() => getShelterCode());

	// Local State
	let searchQuery = $state('');
	let isDropdownOpen = $state(false);
	let selectedItem = $state<{
		_id: string;
		name: string;
		unit: string;
		perishable?: boolean;
	} | null>(null);
	let container = $state<HTMLDivElement | null>(null);
	let selectedLotKey = $state<string>('');
	/** Storage point for a new lot ('' = unspecified / main store). */
	let customPointId = $state('');
	let customPoint = $state<StoragePointRef | null>(null);
	let customExpiry = $state<string>('');
	let newQtyInput = $state<string>('');
	let reason = $state<string>('');

	const items = $derived.by(() => {
		const supplyItems = itemsQuery.data ?? [];
		const itemMasters = itemMastersQuery.data ?? [];

		const mappedItemMasters = itemMasters
			.filter((im) => !im.deactivated)
			.map((im) => ({
				_id: im._id,
				name: im.name,
				category: im.category || 'other',
				unit: itemMasterUnit(im),
				reorder_level: null,
				perishable: false
			}));

		return [...supplyItems, ...mappedItemMasters];
	});

	const filteredItems = $derived.by(() => {
		if (!searchQuery) return items;
		const query = searchQuery.toLowerCase().trim();
		return items.filter((i) => i.name.toLowerCase().includes(query));
	});

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

	// svelte-ignore state_referenced_locally
	let adjustmentType = $state<'write_off' | 'add'>(initialAdjustmentType);

	// Watch newQtyInput to auto-set adjustmentType
	$effect(() => {
		const delta = Number(deltaQty);
		if (delta < 0) {
			adjustmentType = 'write_off';
		} else if (delta > 0) {
			adjustmentType = 'add';
		}
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

	function selectItem(item: typeof selectedItem) {
		selectedItem = item;
		searchQuery = item?.name ?? '';
		isDropdownOpen = false;
		// Reset form fields
		selectedLotKey = '';
		customPointId = '';
		customPoint = null;
		newQtyInput = '';
		adjustmentType = initialAdjustmentType;
		reason = '';
	}

	function clearSelection() {
		selectedItem = null;
		searchQuery = '';
		isDropdownOpen = false;
		selectedLotKey = '';
		customPointId = '';
		customPoint = null;
		newQtyInput = '';
		adjustmentType = initialAdjustmentType;
		reason = '';
	}

	// Submit
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
			loading: 'กำลังปรับปรุงสต๊อก...',
			success: () => {
				clearSelection();
				if (onsuccess) onsuccess();
				return 'ปรับปรุงยอดสต๊อกสำเร็จ!';
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

	function handleClickOutside(event: MouseEvent) {
		if (container && !container.contains(event.target as Node)) {
			isDropdownOpen = false;
		}
	}
</script>

<svelte:document onclick={handleClickOutside} />

<form
	onsubmit={handleSubmit}
	class="flex flex-col space-y-4 rounded-2xl border border-border/80 bg-card p-5 shadow-md"
>
	<div class="mb-2 flex items-center gap-2 border-b border-border/60 pb-3">
		<Settings class="h-4.5 w-4.5 text-primary" />
		<h3 class="text-sm font-bold text-foreground">ปรับปรุงยอดสต๊อก (Stock Adjustment)</h3>
	</div>

	<Field.FieldGroup class="grid grid-cols-1 gap-4 sm:grid-cols-2">
		<!-- Searchable Item Selector -->
		<Field.Root class="relative col-span-1 sm:col-span-2">
			<Field.Label for="item-search"
				>ค้นหาและเลือกรายการสิ่งของ <span class="font-bold text-destructive">*</span></Field.Label
			>
			<div bind:this={container} class="relative w-full">
				<Input
					id="item-search"
					placeholder="พิมพ์เพื่อค้นหา เช่น ข้าวสาร, น้ำดื่ม..."
					bind:value={searchQuery}
					onfocus={() => !preselectedItemId && (isDropdownOpen = true)}
					oninput={() => !preselectedItemId && (isDropdownOpen = true)}
					autocomplete="off"
					disabled={!!preselectedItemId}
					class={preselectedItemId
						? 'cursor-not-allowed bg-muted font-bold text-muted-foreground'
						: ''}
				/>
				{#if selectedItem && !preselectedItemId}
					<Button
						type="button"
						variant="ghost"
						class="absolute top-1/2 right-1 min-h-11 min-w-11 -translate-y-1/2 px-3 text-sm font-semibold text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none"
						onclick={clearSelection}
					>
						ล้างค่า
					</Button>
				{/if}

				{#if isDropdownOpen}
					<div
						class="absolute left-0 z-20 mt-1 max-h-60 w-full animate-in overflow-y-auto rounded-xl border border-border bg-popover p-1.5 shadow-xl duration-150 fade-in slide-in-from-top-1"
					>
						{#if itemsQuery.isLoading || itemMastersQuery.isLoading}
							<div class="p-3 text-xs font-medium text-muted-foreground">กำลังโหลดข้อมูล...</div>
						{:else if filteredItems.length === 0}
							<div class="p-3 text-xs font-medium text-muted-foreground">ไม่พบรายการสิ่งของ</div>
						{:else}
							{#each filteredItems as item (item._id)}
								<button
									type="button"
									class="flex w-full cursor-pointer items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors hover:bg-muted"
									onclick={() => selectItem(item)}
								>
									<span class="font-semibold text-foreground">{item.name}</span>
									<span
										class="rounded-md border border-border/60 bg-muted px-2 py-0.5 text-xs text-muted-foreground"
									>
										หน่วย: {item.unit}
									</span>
								</button>
							{/each}
						{/if}
					</div>
				{/if}
			</div>
		</Field.Root>

		{#if selectedItem}
			<!-- Lot / Location selector -->
			<Field.Root class="col-span-1 sm:col-span-2">
				<Field.Label for="lot-select"
					>สถานที่และล็อตที่ต้องการปรับปรุง <span class="font-bold text-destructive">*</span
					></Field.Label
				>
				<Select.Root type="single" bind:value={selectedLotKey}>
					<Select.Trigger
						id="lot-select"
						class="h-11 w-full min-w-0 rounded-md border border-input bg-white px-3 text-sm font-medium shadow-xs focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none sm:h-10"
					>
						{selectedLotKey === 'new'
							? '➕ สร้าง/ปรับปรุงสถานที่อื่นนอกเหนือจากนี้...'
							: (itemLots.find((lot) => lot.key === selectedLotKey)?.label ??
								'-- เลือกสถานที่ / ล็อตที่พบเจอปัญหา --')}
					</Select.Trigger>
					<Select.Content>
						{#each itemLots as lot (lot.key)}
							<Select.Item value={lot.key} label={lot.label} />
						{/each}
						<Select.Item value="new" label="➕ สร้าง/ปรับปรุงสถานที่อื่นนอกเหนือจากนี้..." />
					</Select.Content>
				</Select.Root>
			</Field.Root>

			<!-- Conditional Inputs for New Lot -->
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
						วันหมดอายุใหม่
						{#if selectedItem.perishable}
							<span class="font-bold text-destructive">* (ของเสียง่าย บังคับกรอก)</span>
						{/if}
					</Field.Label>
					<DatePicker id="custom-expiry" ariaLabel="วันหมดอายุใหม่" bind:value={customExpiry} />
				</Field.Root>
			{/if}

			{#if selectedLotKey}
				<!-- Quantity Input -->
				<Field.Root class="col-span-1">
					<Field.Label for="new-qty"
						>จำนวนใหม่ <span class="font-bold text-destructive">*</span></Field.Label
					>
					<div class="relative">
						<Input
							id="new-qty"
							type="number"
							placeholder="ระบุจำนวนใหม่"
							min="0"
							step="any"
							bind:value={newQtyInput}
							class="pr-16 font-mono font-bold"
						/>
						<span
							class="absolute top-1/2 right-3 -translate-y-1/2 text-xs font-bold text-muted-foreground"
						>
							{selectedItem.unit}
						</span>
					</div>
				</Field.Root>

				<!-- Issuer (Disabled) -->
				<Field.Root class="col-span-1">
					<Field.Label for="issuer">ผู้ดำเนินการ (Issuer)</Field.Label>
					<Input
						id="issuer"
						value={authStore.user?.name || 'เจ้าหน้าที่คลังสินค้า (Admin)'}
						disabled
					/>
				</Field.Root>

				<!-- Delta preview & Type display -->
				<div
					class="col-span-1 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border/50 bg-muted/40 p-4 sm:col-span-2"
				>
					<div class="flex flex-col gap-0.5">
						<span class="text-xs font-medium text-muted-foreground">คำนวณการปรับยอด (Delta):</span>
						{#if selectedLotKey !== 'new'}
							<span class="text-2xs text-muted-foreground/80">
								(ยอดเดิมในคลัง: {currentLotQty}
								{selectedItem.unit})
							</span>
						{/if}
					</div>
					<div class="flex items-center gap-3">
						<span
							class={[
								'rounded-lg border px-3 py-1 font-mono text-lg font-black',
								Number(deltaQty) < 0
									? 'border-rose-500/20 bg-rose-500/10 text-rose-600'
									: Number(deltaQty) > 0
										? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600'
										: 'border-border bg-muted text-muted-foreground'
							]}
						>
							{Number(deltaQty) > 0 ? '+' : ''}{deltaQty}
							{selectedItem.unit}
						</span>
					</div>
				</div>

				<!-- Adjustment Type (Toggle Group) -->
				<Field.Root class="col-span-1 sm:col-span-2">
					<Field.Label>ประเภทการปรับปรุง</Field.Label>
					<div class="grid grid-cols-2 gap-3">
						<Button
							type="button"
							variant={adjustmentType === 'write_off' ? 'destructive' : 'outline'}
							size="lg"
							onclick={() => {
								if (Number(deltaQty) > 0) {
									toast.error('ไม่สามารถเลือกประเภทเขียนทิ้งเมื่อจำนวนใหม่มากกว่าจำนวนเดิม');
									return;
								}
								adjustmentType = 'write_off';
							}}
							disabled={Number(deltaQty) > 0}
							class={adjustmentType === 'write_off' ? 'font-bold shadow-xs' : 'font-bold'}
						>
							<MinusCircle class="h-4 w-4" />
							เขียนทิ้ง/ชำรุด
						</Button>
						<Button
							type="button"
							variant={adjustmentType === 'add' ? 'default' : 'outline'}
							size="lg"
							onclick={() => {
								if (Number(deltaQty) < 0) {
									toast.error('ไม่สามารถเลือกประเภทปรับยอดเพิ่มเมื่อจำนวนใหม่น้อยกว่าจำนวนเดิม');
									return;
								}
								adjustmentType = 'add';
							}}
							disabled={Number(deltaQty) < 0}
							class={adjustmentType === 'add' ? 'font-bold shadow-xs' : 'font-bold'}
						>
							<PlusCircle class="h-4 w-4" />
							ปรับยอดเพิ่ม
						</Button>
					</div>
				</Field.Root>

				<!-- Reason / Note -->
				<Field.Root class="col-span-1 sm:col-span-2">
					<Field.Label for="reason"
						>เหตุผล / หมายเหตุ <span class="font-bold text-destructive">*</span></Field.Label
					>
					<Textarea
						id="reason"
						placeholder="เช่น ถุงข้าวสารเปียกน้ำฝนสาด หรือ ค้นพบสินค้าตกหล่นระหว่างตรวจนับ"
						bind:value={reason}
						rows={3}
					/>
				</Field.Root>

				<!-- Submit Button -->
				<div class="col-span-1 pt-3 sm:col-span-2">
					<Button
						type="submit"
						size="lg"
						disabled={isSubmitting || deltaQty === '0' || !reason.trim()}
						class="w-full font-bold"
					>
						{isSubmitting ? 'กำลังบันทึกยอด...' : 'ยืนยันทำรายการ ปรับปรุงยอด'}
					</Button>
				</div>
			{/if}
		{/if}
	</Field.FieldGroup>
</form>
