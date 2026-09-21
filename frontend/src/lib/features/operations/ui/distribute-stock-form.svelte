<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
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
	import { useSupplyItems } from '$lib/features/supply';
	import { itemMasterUnit, useItemMasters } from '$lib/features/catalog';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { useDistributeStock, useStockBalance, useLedger } from '../application/queries';
	import { toast } from 'svelte-sonner';
	import PackageMinus from '@lucide/svelte/icons/package-minus';
	import { qtyGt, qtyGte, qtyIsZero, qtyLte } from '$lib/utils/qty';
	import { ulid } from '$lib/db/ulid';

	let {
		onsuccess,
		preselectedItemId = undefined
	}: { onsuccess?: () => void; preselectedItemId?: string } = $props();

	// Fetch supply catalog items and stock balance
	const itemsQuery = useSupplyItems();
	const itemMastersQuery = useItemMasters(() => getShelterCode());
	const balanceQuery = useStockBalance();
	const ledgerQuery = useLedger();
	const distributeMutation = useDistributeStock();

	// Local state for searchable items combobox
	let searchQuery = $state('');
	let isDropdownOpen = $state(false);
	let selectedItem = $state<{ _id: string; name: string; unit: string } | null>(null);
	let container = $state<HTMLDivElement | null>(null);

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
		if (!$formData.qty) return false;
		try {
			return qtyGt($formData.qty, maxLotQty);
		} catch {
			return true;
		}
	});

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

	// Filter items based on search query
	const filteredItems = $derived.by(() => {
		if (!searchQuery) return items;
		const query = searchQuery.toLowerCase().trim();
		return items.filter((i) => i.name.toLowerCase().includes(query));
	});

	const form = superForm(
		defaults(
			{
				ref_id: `distribution_batch:direct-${ulid()}`,
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

				// Validate sufficient stock in selected lot
				if (qtyGt(validated.data.qty, maxLotQty)) {
					toast.error(
						`ยอดคงเหลือในล็อตนี้ไม่เพียงพอ (มี ${maxLotQty} ต้องการแจกจ่าย ${validated.data.qty})`
					);
					return;
				}

				await handleCommit(validated.data);
			}
		}
	);

	const { form: formData, submitting, reset } = form;

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

	// Update locked unit when item is selected
	function selectItem(item: { _id: string; name: string; unit: string }) {
		selectedItem = item;
		$formData.item_id = item._id;
		$formData.unit = item.unit;
		$formData.ref_id = `distribution_batch:direct-${ulid()}`;
		searchQuery = item.name;
		isDropdownOpen = false;
	}

	function clearSelection() {
		selectedItem = null;
		$formData.item_id = '';
		$formData.unit = '';
		$formData.lot_ref = '';
		$formData.ref_id = `distribution_batch:direct-${ulid()}`;
		searchQuery = '';
		isDropdownOpen = false;
	}

	// Submit handler
	async function handleCommit(data: DistributeInput) {
		const ctx = {
			shelterCode: getShelterCode(),
			createdBy: authStore.user?.name ?? 'เจ้าหน้าที่คลังสินค้า (Admin)'
		};

		if (!data.ref_id) {
			data.ref_id = `distribution_batch:direct-${ulid()}`;
		}

		toast.promise(distributeMutation.mutateAsync({ input: data, ctx }), {
			loading: 'กำลังบันทึกข้อมูล...',
			success: () => {
				clearSelection();
				reset({
					data: {
						item_id: '',
						unit: '',
						qty: '',
						note: '',
						ref_id: `distribution_batch:direct-${ulid()}`,
						lot_ref: ''
					}
				});
				if (onsuccess) onsuccess();
				return 'บันทึกการแจกจ่ายสำเร็จ!';
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

	// Click outside container closes dropdown
	function handleClickOutside(event: MouseEvent) {
		if (container && !container.contains(event.target as Node)) {
			isDropdownOpen = false;
		}
	}
</script>

<svelte:document onclick={handleClickOutside} />

<form
	method="POST"
	use:form.enhance
	class="flex flex-col space-y-4 rounded-2xl border border-border/80 bg-card p-5 shadow-md"
>
	<div class="mb-2 flex items-center gap-2 border-b border-border/60 pb-3">
		<PackageMinus class="h-4.5 w-4.5 text-primary" />
		<h3 class="text-sm font-bold text-foreground">แจกจ่ายพัสดุออก (Outbound Stock Distribute)</h3>
	</div>

	<Field.FieldGroup class="grid grid-cols-1 gap-4 sm:grid-cols-2">
		<!-- Searchable Item Selector -->
		<Form.Field {form} name="item_id" class="relative col-span-1 sm:col-span-2">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label
						>ค้นหาและเลือกรายการสิ่งของ <span class="font-bold text-destructive">*</span
						></Form.Label
					>
					<div bind:this={container} class="relative w-full">
						<Input
							{...props}
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
								id="item-listbox"
								role="listbox"
								class="absolute left-0 z-20 mt-1 max-h-60 w-full animate-in overflow-y-auto rounded-xl border border-border bg-popover p-1.5 shadow-xl duration-150 fade-in slide-in-from-top-1"
							>
								{#if itemsQuery.isLoading || itemMastersQuery.isLoading || balanceQuery.isLoading}
									<div class="p-3 text-xs font-medium text-muted-foreground">
										กำลังโหลดข้อมูล...
									</div>
								{:else if filteredItems.length === 0}
									<div class="p-3 text-xs font-medium text-muted-foreground">
										ไม่พบรายการสิ่งของ
									</div>
								{:else}
									{#each filteredItems as item (item._id)}
										{@const bal = balanceQuery.data?.get(item._id) ?? '0'}
										<button
											type="button"
											class="flex w-full cursor-pointer items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors hover:bg-muted"
											onclick={() => selectItem(item)}
											disabled={qtyLte(bal, 0)}
										>
											<div class="flex items-center gap-2">
												<span
													class="font-semibold text-foreground {qtyLte(bal, 0) ? 'opacity-50' : ''}"
													>{item.name}</span
												>
											</div>
											<span
												class="rounded-md {qtyGt(bal, 0)
													? 'border-primary/20 bg-primary/10 text-primary'
													: 'border-destructive/20 bg-destructive/10 text-destructive'} border px-2 py-0.5 text-xs font-bold"
											>
												คงเหลือ: {bal}
												{item.unit}
											</span>
										</button>
									{/each}
								{/if}
							</div>
						{/if}
					</div>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<!-- Current Stock Info -->
		{#if selectedItem}
			<div
				class="col-span-1 flex items-center justify-between rounded-xl border border-border/50 bg-muted/50 p-3 sm:col-span-2"
			>
				<span class="text-sm font-medium text-muted-foreground">ยอดคงเหลือในคลังขณะนี้:</span>
				<span
					class="text-sm font-bold {!qtyIsZero(currentStock) && qtyGte(currentStock, 0)
						? 'text-primary'
						: 'text-destructive'}"
				>
					{currentStock}
					{selectedItem.unit}
				</span>
			</div>

			<!-- Lot Selector -->
			<Form.Field {form} name="lot_ref" class="col-span-1 sm:col-span-2">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label
							>สถานที่จัดเก็บ / ล็อตที่ต้องการเบิกจ่าย <span class="font-bold text-destructive"
								>*</span
							></Form.Label
						>
						{#if ledgerQuery.isLoading}
							<div class="text-xs text-muted-foreground">กำลังโหลดข้อมูลล็อต...</div>
						{:else if lotProjectionError}
							<div
								class="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs font-semibold text-destructive"
							>
								<p>ข้อมูลประวัติคลังไม่สอดคล้องกัน จึงคำนวณยอดคงเหลือของล็อตไม่ได้</p>
								<p class="mt-1 font-normal">กรุณาแจ้งผู้ดูแลระบบ: {lotProjectionError}</p>
							</div>
						{:else if itemLots.length === 0}
							<div
								class="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs font-semibold text-destructive"
							>
								ไม่พบล็อตสินค้าที่มีสต็อกคงเหลือสำหรับเบิกจ่าย
							</div>
						{:else}
							<Select.Root type="single" bind:value={$formData.lot_ref}>
								<Select.Trigger
									{...props}
									class="h-11 w-full min-w-0 rounded-md border border-input bg-white px-3 text-sm font-medium shadow-xs focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none sm:h-10"
								>
									{activeLot
										? `📍 ${activeLot.lot?.note || activeLot.lot?.storage_zone || 'คลังหลัก'} ${activeLot.lot?.expiry ? `(หมดอายุ: ${formatExpiry(activeLot.lot.expiry)})` : '(ไม่ระบุวันหมดอายุ)'} ${activeLot.lot?.lot_no ? `[${activeLot.lot.lot_no}]` : ''} - คงเหลือ ${activeLot.qty} ${selectedItem?.unit}`
										: 'เลือกสถานที่ / ล็อตที่ต้องการเบิกจ่าย'}
								</Select.Trigger>
								<Select.Content>
									{#each itemLots as lot (lot.lot_ref)}
										<Select.Item
											value={lot.lot_ref}
											label={`📍 ${lot.lot?.note || lot.lot?.storage_zone || 'คลังหลัก'} ${lot.lot?.expiry ? `(หมดอายุ: ${formatExpiry(lot.lot?.expiry)})` : '(ไม่ระบุวันหมดอายุ)'} ${lot.lot?.lot_no ? `[${lot.lot?.lot_no}]` : ''} - คงเหลือ ${lot.qty} ${selectedItem?.unit}`}
										/>
									{/each}
								</Select.Content>
							</Select.Root>
						{/if}
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>
		{/if}

		<!-- Quantity -->
		<Form.Field {form} name="qty" class="col-span-1">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>จำนวนที่แจกจ่าย <span class="font-bold text-destructive">*</span></Form.Label>
					<Input
						{...props}
						type="number"
						placeholder="ระบุจำนวน"
						min="0.01"
						max={maxLotQty || undefined}
						step="any"
						bind:value={$formData.qty}
						class="font-mono font-bold"
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<!-- Unit (Locked) -->
		<Form.Field {form} name="unit" class="col-span-1">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>หน่วยนับ</Form.Label>
					<Input
						{...props}
						placeholder="ระบบจะล็อกอัตโนมัติ"
						bind:value={$formData.unit}
						readonly
						disabled
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<!-- Destination / Note -->
		<Form.Field {form} name="note" class="col-span-1 sm:col-span-2">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>สถานที่ปลายทาง หรือ ผู้รับ (ระบุรายละเอียด)</Form.Label>
					<Input
						{...props}
						placeholder="เช่น แจกจ่ายโซนเต็นท์ A, หรือระบุชื่อผู้รับ..."
						bind:value={$formData.note}
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<!-- Submit Button -->
		<div class="col-span-1 pt-3 sm:col-span-2">
			<Form.Button
				size="lg"
				disabled={$submitting ||
					!$formData.qty ||
					!qtyGt(currentStock, 0) ||
					itemLots.length === 0 ||
					isQtyOverStock}
				class="w-full font-bold"
			>
				{$submitting ? 'กำลังบันทึกรายการ...' : 'บันทึกการแจกจ่ายพัสดุ'}
			</Form.Button>
		</div>
	</Field.FieldGroup>
</form>
