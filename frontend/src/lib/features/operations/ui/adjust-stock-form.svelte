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
	import { addQty, subQty, qtyAbs } from '$lib/utils/qty';
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

	const REASON_CHIPS = [
		'หมดอายุ',
		'เสียหาย / เน่าเสีย',
		'นับไม่ตรง',
		'สูญหาย',
		'พบของเพิ่ม',
		'อื่นๆ'
	] as const;

	let {
		onsuccess,
		preselectedItemId = undefined
	}: {
		onsuccess?: (result?: { keepOpen: boolean; summary?: string }) => void;
		preselectedItemId?: string;
	} = $props();

	// Session expired (`needsReauth`): every save button is off until the user signs in again.
	const offline = $derived(authStore.needsReauth);

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

	function isExpired(expiry: string): boolean {
		if (!expiry) return false;
		const ms = Date.parse(expiry);
		return !Number.isNaN(ms) && ms <= Date.now();
	}

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

		const unitLabel = formatUnit(currentItem.unit, units, langState.current) || currentItem.unit;

		return Array.from(lotsMap, ([key, l]) => {
			const expired = isExpired(l.expiry);
			const expiryPart = l.expiry
				? expired
					? `(หมดอายุแล้ว: ${formatExpiry(l.expiry)})`
					: `(หมดอายุ: ${formatExpiry(l.expiry)})`
				: '(ไม่ระบุวันหมดอายุ)';
			return {
				...l,
				key,
				expired,
				label: `${lotStorageLabel(l.location, storagePoints.points)} ${expiryPart} - คงเหลือ ${l.qty} ${unitLabel}`
			};
		});
	});

	const currentLot = $derived(itemLots.find((l) => l.key === selectedLotKey));
	const currentLotQty = $derived(currentLot ? currentLot.qty : '0');
	const systemQty = $derived(selectedLotKey === 'new' ? '0' : currentLotQty);

	// Delta Calculation
	const deltaQty = $derived.by(() => {
		if (!newQtyInput || isNaN(Number(newQtyInput))) return '0';
		const base = selectedLotKey === 'new' ? '0' : currentLotQty;
		return subQty(newQtyInput, base);
	});

	const deltaAbs = $derived(qtyAbs(deltaQty));
	const deltaSign = $derived.by(() => {
		const n = Number(deltaQty);
		if (n < 0) return 'write_off' as const;
		if (n > 0) return 'add' as const;
		return null;
	});

	const isSubmitting = $derived(adjustMutation.isPending);

	const unitLabel = $derived(
		selectedItem ? formatUnit(selectedItem.unit, units, langState.current) || selectedItem.unit : ''
	);

	const submitLabel = $derived.by(() => {
		if (isSubmitting) return 'กำลังบันทึก…';
		if (deltaSign === 'write_off') return `ตัดออก ${deltaAbs} ${unitLabel}`;
		if (deltaSign === 'add') return `เพิ่มเข้า ${deltaAbs} ${unitLabel}`;
		return 'บันทึกแล้วปรับชิ้นถัดไป';
	});

	function chipClass(active: boolean) {
		return [
			'inline-flex min-h-11 shrink-0 items-center rounded-full px-3.5 text-sm font-semibold transition-colors',
			active
				? 'border-2 border-[#0284C7] bg-sky-50 text-sky-900'
				: 'border border-slate-300 bg-white text-slate-700 hover:border-slate-400'
		].join(' ');
	}

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
		reason = '';
	}

	function clearSelection() {
		selectedItem = null;
		selectedItemId = '';
		selectedLotKey = '';
		customPointId = '';
		customPoint = null;
		newQtyInput = '';
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
		if (!preselectedItemId) {
			clearSelection();
		}
	}

	function applyReasonChip(chip: string) {
		if (chip === 'อื่นๆ') {
			reason = '';
			return;
		}
		reason = chip;
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
		// Stock coming in must carry an expiry (CR-143 FR-D1) — the new lot's own, or the
		// existing lot's. A write-off (negative delta) is exempt, as on the server.
		const incomingExpiry = selectedLotKey === 'new' ? customExpiry : currentLot?.expiry;
		if (selectedItem.requiresExpiry && Number(deltaQty) > 0 && !incomingExpiry) {
			toast.error('สินค้านี้ต้องระบุวันหมดอายุ');
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

		// Prepare input — reason stays UI-only (Phase B / #343 for adjust_reason on ledger)
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

<form onsubmit={handleSubmit} class="flex flex-col space-y-4">
	<Field.FieldGroup class="grid grid-cols-1 gap-4 sm:grid-cols-2">
		<Field.Root class="relative col-span-1 sm:col-span-2">
			<Field.Label for="item-search"
				>สินค้า <span class="font-bold text-destructive">*</span></Field.Label
			>
			<ItemCombobox
				id="item-search"
				{items}
				allowCreate
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
						class="min-h-11 w-full rounded-md border border-input bg-white px-3 text-sm font-medium {currentLot?.expired
							? 'text-destructive'
							: ''}"
					>
						{selectedLotKey === 'new'
							? 'สร้างที่เก็บใหม่…'
							: (itemLots.find((lot) => lot.key === selectedLotKey)?.label ?? 'เลือกล็อต')}
					</Select.Trigger>
					<Select.Content>
						{#each itemLots as lot (lot.key)}
							<Select.Item
								value={lot.key}
								label={lot.label}
								class={lot.expired ? 'text-destructive' : undefined}
							/>
						{/each}
						<Select.Item value="new" label="สร้างที่เก็บใหม่…" />
					</Select.Content>
				</Select.Root>
				{#if currentLot?.expired}
					<p class="mt-1.5 text-xs font-semibold text-destructive">ล็อตนี้หมดอายุแล้ว</p>
				{/if}
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
						{#if selectedItem.requiresExpiry}
							<span class="font-bold text-destructive">*</span>
						{:else}
							<span class="font-normal text-muted-foreground">(ไม่บังคับ)</span>
						{/if}
					</Field.Label>
					<DatePicker id="custom-expiry" ariaLabel="วันหมดอายุ" bind:value={customExpiry} />
				</Field.Root>
			{/if}

			{#if selectedLotKey}
				<div class="col-span-1 grid grid-cols-1 gap-3 sm:col-span-2 sm:grid-cols-3">
					<div
						class="flex flex-col justify-between rounded-xl border border-border/60 bg-muted/40 p-3"
					>
						<span class="text-xs font-semibold text-muted-foreground">ยอดในระบบ</span>
						<span class="mt-2 font-mono text-xl font-black text-foreground">
							{systemQty}
							<span class="text-sm font-bold text-muted-foreground">{unitLabel}</span>
						</span>
					</div>

					<div
						class="flex flex-col justify-between rounded-xl border-2 border-[#0284C7] bg-sky-50/60 p-3"
					>
						<label for="new-qty" class="text-xs font-semibold text-sky-900">
							นับได้จริง / เหลือใช้ได้ <span class="font-bold text-destructive">*</span>
						</label>
						<div class="relative mt-2">
							<Input
								id="new-qty"
								type="number"
								placeholder="0"
								min="0"
								step="any"
								bind:value={newQtyInput}
								class="min-h-11 border-sky-200 bg-white pr-14 font-mono text-lg font-bold"
							/>
							<span
								class="absolute top-1/2 right-3 -translate-y-1/2 text-xs font-bold text-muted-foreground"
							>
								{unitLabel}
							</span>
						</div>
					</div>

					<div
						class={[
							'flex flex-col justify-between rounded-xl border p-3',
							deltaSign === 'write_off'
								? 'border-rose-500/30 bg-rose-50'
								: deltaSign === 'add'
									? 'border-emerald-500/30 bg-emerald-50'
									: 'border-border/60 bg-muted/40'
						]}
					>
						<span class="text-xs font-semibold text-muted-foreground">ส่วนต่าง</span>
						<span
							class={[
								'mt-2 font-mono text-xl font-black',
								deltaSign === 'write_off'
									? 'text-rose-600'
									: deltaSign === 'add'
										? 'text-emerald-600'
										: 'text-muted-foreground'
							]}
						>
							{#if deltaSign === 'write_off'}
								ตัดออก {deltaAbs}
							{:else if deltaSign === 'add'}
								เพิ่มเข้า {deltaAbs}
							{:else}
								0
							{/if}
							<span class="text-sm font-bold">{unitLabel}</span>
						</span>
					</div>
				</div>

				<div class="col-span-1 space-y-2 sm:col-span-2">
					<Field.Label for="reason"
						>เหตุผล <span class="font-bold text-destructive">*</span></Field.Label
					>
					<div class="flex flex-wrap gap-2">
						{#each REASON_CHIPS as chip (chip)}
							<button
								type="button"
								class={chipClass(
									chip === 'อื่นๆ'
										? !!reason && !(REASON_CHIPS.slice(0, -1) as readonly string[]).includes(reason)
										: reason === chip
								)}
								onclick={() => applyReasonChip(chip)}
							>
								{chip}
							</button>
						{/each}
					</div>
					<Textarea
						id="reason"
						placeholder="เช่น ของเสีย / พบตกหล่น"
						bind:value={reason}
						rows={2}
						class="min-h-11"
					/>
				</div>

				<div
					class="col-span-1 rounded-xl border border-dashed border-border/70 bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground sm:col-span-2"
					aria-disabled="true"
				>
					รอบตรวจนับหลายรายการยังไม่พร้อมในเวอร์ชันนี้ — ปรับทีละล็อตไปก่อน
				</div>

				<div
					class="sticky bottom-0 z-10 col-span-1 -mx-4 -mb-4 border-t border-slate-200 bg-slate-50 px-4 py-4 sm:col-span-2 sm:-mx-6 sm:-mb-6 sm:px-6"
				>
					<Button
						type="submit"
						size="lg"
						variant={deltaSign === 'write_off' ? 'destructive' : 'default'}
						disabled={offline || isSubmitting || deltaQty === '0' || !reason.trim()}
						class="min-h-11 w-full font-bold"
					>
						{submitLabel}
					</Button>
				</div>
			{/if}
		{/if}
	</Field.FieldGroup>
</form>
