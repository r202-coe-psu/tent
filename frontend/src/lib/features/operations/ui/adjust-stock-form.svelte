<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import { useSupplyItems } from '$lib/features/supply';
	import { useItemMasters } from '$lib/features/catalog';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { useStockBalance, useLedger, useAdjustStock } from '../application/queries';
	import { toast } from 'svelte-sonner';
	import Settings from '@lucide/svelte/icons/settings';
	import Upload from '@lucide/svelte/icons/upload';
	import Trash from '@lucide/svelte/icons/trash-2';
	import MinusCircle from '@lucide/svelte/icons/minus-circle';
	import PlusCircle from '@lucide/svelte/icons/plus-circle';
	import { qtyGt, qtyGte, qtyLte, qtyAbs, addQty, subQty } from '$lib/utils/qty';
	import type { StockLot } from '../domain/operations';

	let {
		onsuccess,
		preselectedItemId = undefined
	}: { onsuccess?: () => void; preselectedItemId?: string } = $props();

	// Queries & Mutations
	const itemsQuery = useSupplyItems();
	const itemMastersQuery = useItemMasters();
	const balanceQuery = useStockBalance();
	const ledgerQuery = useLedger();
	const adjustMutation = useAdjustStock();

	// Local State
	let searchQuery = $state('');
	let isDropdownOpen = $state(false);
	let selectedItem = $state<{ _id: string; name: string; unit: string; perishable?: boolean } | null>(null);
	let container = $state<HTMLDivElement | null>(null);

	let selectedLotKey = $state<string>('');
	let customLocation = $state<string>('');
	let customExpiry = $state<string>('');

	let newQtyInput = $state<string>('');
	let adjustmentType = $state<'write_off' | 'add'>('write_off');
	let reason = $state<string>('');

	// Attachment Mockup
	let selectedFile = $state<File | null>(null);
	let filePreview = $state<string | null>(null);

	const items = $derived.by(() => {
		const supplyItems = itemsQuery.data ?? [];
		const itemMasters = itemMastersQuery.data ?? [];

		const mappedItemMasters = itemMasters.map((im) => ({
			_id: im._id,
			name: im.name,
			category: im.category || 'other',
			unit: im.base_unit || im.unit || 'ชิ้น',
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
		const entries = ledgerQuery.data.filter((e) => e.item_id === currentItem._id);
		const lotsMap = new Map<string, { note: string; expiry: string; qty: string }>();

		for (const entry of entries) {
			const note = entry.lot?.note?.trim() || 'คลังหลัก';
			const expiry = entry.lot?.expiry || '';
			const key = `${note}||${expiry}`;
			
			const current = lotsMap.get(key) || { note, expiry, qty: '0' };
			lotsMap.set(key, {
				note,
				expiry,
				qty: addQty(current.qty, entry.qty)
			});
		}

		return Array.from(lotsMap.values()).map((l) => ({
			...l,
			key: `${l.note}||${l.expiry}`,
			label: `📍 ${l.note} ${l.expiry ? `(หมดอายุ: ${formatExpiry(l.expiry)})` : '(ไม่ระบุวันหมดอายุ)'} - คงเหลือ ${l.qty} ${currentItem.unit}`
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
		newQtyInput = '';
		adjustmentType = 'write_off';
		reason = '';
	}

	function clearSelection() {
		selectedItem = null;
		searchQuery = '';
		isDropdownOpen = false;
		selectedLotKey = '';
		newQtyInput = '';
		adjustmentType = 'write_off';
		reason = '';
	}

	function handleFileChange(e: Event) {
		const target = e.target as HTMLInputElement;
		if (target.files && target.files[0]) {
			selectedFile = target.files[0];
			filePreview = URL.createObjectURL(selectedFile);
		}
	}

	function removeFile() {
		selectedFile = null;
		filePreview = null;
	}

	// Watch newQtyInput to auto-set adjustmentType
	$effect(() => {
		const delta = Number(deltaQty);
		if (delta < 0) {
			adjustmentType = 'write_off';
		} else if (delta > 0) {
			adjustmentType = 'add';
		}
	});

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
		if (selectedLotKey === 'new' && !customLocation.trim()) {
			toast.error('กรุณาระบุสถานที่จัดเก็บใหม่');
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
				note: customLocation.trim(),
				expiry: customExpiry || undefined
			};
		} else if (currentLot) {
			lot = {
				note: currentLot.note,
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
				removeFile();
				if (onsuccess) onsuccess();
				return 'ปรับปรุงยอดสต๊อกสำเร็จ!';
			},
			error: (err: unknown) =>
				err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการปรับปรุงยอด'
		});
	}

	// Pre-fill
	$effect(() => {
		if (preselectedItemId && (itemsQuery.data || itemMastersQuery.data)) {
			const item = items.find((i) => i._id === preselectedItemId);
			if (item) {
				selectItem(item);
			}
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
		<Settings class="h-4.5 w-4.5 text-primary"/>
		<h3 class="text-sm font-bold text-foreground">ปรับปรุงยอดสต๊อก (Stock Adjustment)</h3>
	</div>

	<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
		<!-- Searchable Item Selector -->
		<div class="relative col-span-1 sm:col-span-2">
			<label class="text-xs font-bold text-foreground">ค้นหาและเลือกรายการสิ่งของ</label>
			<div bind:this={container} class="relative mt-1 w-full">
				<Input
					placeholder="พิมพ์เพื่อค้นหา เช่น ข้าวสาร, น้ำดื่ม..."
					bind:value={searchQuery}
					onfocus={() => !preselectedItemId && (isDropdownOpen = true)}
					oninput={() => !preselectedItemId && (isDropdownOpen = true)}
					autocomplete="off"
					disabled={!!preselectedItemId}
					class={[
						'h-10 w-full rounded-xl border border-border/80 bg-background px-3 shadow-sm transition outline-none focus:border-primary focus:ring-1 focus:ring-primary/20',
						preselectedItemId
							? 'cursor-not-allowed bg-muted font-bold text-muted-foreground'
							: ''
					]}
				/>
				{#if selectedItem && !preselectedItemId}
					<button
						type="button"
						class="absolute top-1/2 right-3 -translate-y-1/2 cursor-pointer text-xs font-bold text-muted-foreground transition-colors hover:text-foreground"
						onclick={clearSelection}
					>
						ล้างค่า
					</button>
				{/if}

				{#if isDropdownOpen}
					<div
						class="absolute left-0 z-20 mt-1 max-h-60 w-full animate-in overflow-y-auto rounded-xl border border-border bg-popover p-1.5 shadow-xl duration-150 fade-in slide-in-from-top-1"
					>
						{#if itemsQuery.isLoading || itemMastersQuery.isLoading}
							<div class="p-3 text-xs font-medium text-muted-foreground">
								กำลังโหลดข้อมูล...
							</div>
						{:else if filteredItems.length === 0}
							<div class="p-3 text-xs font-medium text-muted-foreground">
								ไม่พบรายการสิ่งของ
							</div>
						{:else}
							{#each filteredItems as item (item._id)}
								<button
									type="button"
									class="flex w-full cursor-pointer items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors hover:bg-muted"
									onclick={() => selectItem(item)}
								>
									<span class="font-semibold text-foreground">{item.name}</span>
									<span class="rounded-md border border-border/60 bg-muted px-2 py-0.5 text-xs text-muted-foreground">
										หน่วย: {item.unit}
									</span>
								</button>
							{/each}
						{/if}
					</div>
				{/if}
			</div>
		</div>

		{#if selectedItem}
			<!-- Lot / Location selector -->
			<div class="col-span-1 sm:col-span-2">
				<label class="text-xs font-bold text-foreground">สถานที่และล็อตที่ต้องการปรับปรุง *</label>
				<select
					bind:value={selectedLotKey}
					class="mt-1 h-10 w-full cursor-pointer rounded-xl border border-border/80 bg-background px-3 text-sm font-semibold text-foreground shadow-sm outline-none focus:border-primary"
				>
					<option value="" disabled>-- เลือกสถานที่ / ล็อตที่พบเจอปัญหา --</option>
					{#each itemLots as lot}
						<option value={lot.key}>{lot.label}</option>
					{/each}
					<option value="new">➕ สร้าง/ปรับปรุงสถานที่อื่นนอกเหนือจากนี้...</option>
				</select>
			</div>

			<!-- Conditional Inputs for New Lot -->
			{#if selectedLotKey === 'new'}
				<div class="col-span-1">
					<label class="text-xs font-bold text-foreground">สถานที่จัดเก็บใหม่ *</label>
					<select
						bind:value={customLocation}
						class="mt-1 h-10 w-full cursor-pointer rounded-xl border border-border/80 bg-background px-3 text-sm font-semibold text-foreground shadow-sm outline-none focus:border-primary"
					>
						<option value="">เลือกโซนที่จัดเก็บ</option>
						<option value="Zone A">Zone A (ของใช้ทั่วไป)</option>
						<option value="Zone B">Zone B (ของที่เน่าเสียได้)</option>
						<option value="Zone C">Zone C (ยาและเวชภัณฑ์)</option>
					</select>
				</div>
				<div class="col-span-1">
					<label class="text-xs font-bold text-foreground">
						วันหมดอายุใหม่
						{#if selectedItem.perishable}
							<span class="text-rose-500 font-bold">* (ของเสียง่าย บังคับกรอก)</span>
						{/if}
					</label>
					<Input
						type="date"
						bind:value={customExpiry}
						class="mt-1 h-10 w-full rounded-xl border border-border/80 bg-background px-3 text-sm font-semibold shadow-sm transition outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
					/>
				</div>
			{/if}

			{#if selectedLotKey}
				<!-- Quantity Input -->
				<div class="col-span-1">
					<label class="text-xs font-bold text-foreground">จำนวนใหม่ *</label>
					<div class="relative mt-1">
						<Input
							type="number"
							placeholder="ระบุจำนวนคงเหลือใหม่"
							min="0"
							step="any"
							bind:value={newQtyInput}
							class="h-10 w-full rounded-xl border border-border/80 bg-background px-3 font-mono text-sm font-bold shadow-sm transition outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
						/>
						<span class="absolute top-1/2 right-3 -translate-y-1/2 text-xs font-bold text-muted-foreground">
							{selectedItem.unit}
						</span>
					</div>
				</div>

				<!-- Issuer (Disabled) -->
				<div class="col-span-1">
					<label class="text-xs font-bold text-foreground">ผู้ดำเนินการ (Issuer)</label>
					<Input
						value={authStore.user?.name || 'เจ้าหน้าที่คลังสินค้า (Admin)'}
						disabled
						class="mt-1 h-10 w-full cursor-not-allowed rounded-xl border border-border/80 bg-muted px-3 font-semibold text-muted-foreground shadow-sm"
					/>
				</div>

				<!-- Delta preview & Type display -->
				<div class="col-span-1 sm:col-span-2 flex flex-wrap items-center justify-between rounded-xl border border-border/50 bg-muted/40 p-4 gap-4">
					<div class="flex flex-col gap-0.5">
						<span class="text-xs font-medium text-muted-foreground">คำนวณการปรับยอด (Delta):</span>
						{#if selectedLotKey !== 'new'}
							<span class="text-[11px] text-muted-foreground/80">
								(ยอดเดิมในคลัง: {currentLotQty} {selectedItem.unit})
							</span>
						{/if}
					</div>
					<div class="flex items-center gap-3">
						<span class={[
							'text-lg font-black font-mono px-3 py-1 rounded-lg border',
							Number(deltaQty) < 0
								? 'bg-rose-500/10 border-rose-500/20 text-rose-600'
								: Number(deltaQty) > 0
									? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600'
									: 'bg-muted border-border text-muted-foreground'
						]}>
							{Number(deltaQty) > 0 ? '+' : ''}{deltaQty} {selectedItem.unit}
						</span>
					</div>
				</div>

				<!-- Adjustment Type (Toggle Group) -->
				<div class="col-span-1 sm:col-span-2">
					<label class="text-xs font-bold text-foreground">ประเภทการปรับปรุง</label>
					<div class="mt-2 grid grid-cols-2 gap-3">
						<button
							type="button"
							onclick={() => {
								if (Number(deltaQty) > 0) {
									toast.error('ไม่สามารถเลือกประเภทเขียนทิ้งเมื่อจำนวนใหม่มากกว่าจำนวนเดิม');
									return;
								}
								adjustmentType = 'write_off';
							}}
							disabled={Number(deltaQty) > 0}
							class={[
								'flex h-11 items-center justify-center gap-2 rounded-xl border-2 text-sm font-bold transition-all cursor-pointer',
								adjustmentType === 'write_off'
									? 'border-rose-500 bg-rose-500/5 text-rose-600'
									: 'border-border bg-card text-muted-foreground hover:bg-muted/50',
								Number(deltaQty) > 0 ? 'opacity-40 cursor-not-allowed' : ''
							]}
						>
							<MinusCircle class="h-4 w-4" />
							เขียนทิ้ง/ชำรุด
						</button>
						<button
							type="button"
							onclick={() => {
								if (Number(deltaQty) < 0) {
									toast.error('ไม่สามารถเลือกประเภทปรับยอดเพิ่มเมื่อจำนวนใหม่น้อยกว่าจำนวนเดิม');
									return;
								}
								adjustmentType = 'add';
							}}
							disabled={Number(deltaQty) < 0}
							class={[
								'flex h-11 items-center justify-center gap-2 rounded-xl border-2 text-sm font-bold transition-all cursor-pointer',
								adjustmentType === 'add'
									? 'border-primary bg-primary/5 text-primary'
									: 'border-border bg-card text-muted-foreground hover:bg-muted/50',
								Number(deltaQty) < 0 ? 'opacity-40 cursor-not-allowed' : ''
							]}
						>
							<PlusCircle class="h-4 w-4" />
							ปรับยอดเพิ่ม
						</button>
					</div>
				</div>

				<!-- Evidence Attachment -->
				<div class="col-span-1 sm:col-span-2">
					<label class="text-xs font-bold text-foreground mb-1 block">แนบหลักฐาน (Attachment)</label>
					{#if filePreview}
						<div class="relative flex items-center gap-4 rounded-xl border border-border/80 bg-muted/30 p-3">
							<img src={filePreview} alt="Evidence preview" class="h-16 w-16 rounded-lg object-cover border border-border" />
							<div class="flex-1 min-w-0">
								<p class="truncate text-xs font-bold text-foreground">{selectedFile?.name}</p>
								<p class="text-[10px] text-muted-foreground mt-0.5">
									{(selectedFile?.size ?? 0) / 1024 > 1024
										? `${((selectedFile?.size ?? 0) / 1024 / 1024).toFixed(2)} MB`
										: `${((selectedFile?.size ?? 0) / 1024).toFixed(0)} KB`}
								</p>
							</div>
							<button
								type="button"
								onclick={removeFile}
								class="rounded-lg p-2 text-rose-500 hover:bg-rose-500/10 transition-colors"
							>
								<Trash class="h-4 w-4" />
							</button>
						</div>
					{:else}
						<div class="flex items-center justify-center w-full">
							<label class="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-border/80 rounded-xl cursor-pointer bg-background hover:bg-muted/30 transition-all">
								<div class="flex flex-col items-center justify-center pt-4 pb-4">
									<Upload class="h-5 w-5 text-muted-foreground mb-1.5" />
									<p class="text-xs font-semibold text-muted-foreground">อัปโหลดรูปภาพหลักฐาน</p>
									<p class="text-[10px] text-muted-foreground/60 mt-0.5">PNG, JPG (สูงสุด 5MB)</p>
								</div>
								<input type="file" accept="image/*" class="hidden" onchange={handleFileChange} />
							</label>
						</div>
					{/if}
				</div>

				<!-- Reason / Note -->
				<div class="col-span-1 sm:col-span-2">
					<label class="text-xs font-bold text-foreground">เหตุผล / หมายเหตุ *</label>
					<textarea
						placeholder="เช่น ถุงข้าวสารเปียกน้ำฝนสาด หรือ ค้นพบสินค้าตกหล่นระหว่างตรวจนับ"
						bind:value={reason}
						rows="3"
						class="mt-1 w-full rounded-xl border border-border/80 bg-background p-3 text-sm font-semibold shadow-sm transition outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
					></textarea>
				</div>

				<!-- Submit Button -->
				<div class="col-span-1 pt-3 sm:col-span-2">
					<button
						type="submit"
						disabled={isSubmitting || deltaQty === '0' || !reason.trim()}
						class="flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-slate-900 text-sm font-extrabold text-white shadow-md transition-all duration-300 hover:scale-[1.02] hover:bg-slate-800 hover:shadow-lg active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
					>
						{isSubmitting ? 'กำลังบันทึกยอด...' : 'ยืนยันทำรายการ ปรับปรุงยอด'}
					</button>
				</div>
			{/if}
		{/if}
	</div>
</form>
