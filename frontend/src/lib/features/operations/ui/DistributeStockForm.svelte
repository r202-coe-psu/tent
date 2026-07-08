<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { distributeInputSchema, type DistributeInput } from '../domain/operations';
	import { useSupplyItems, type SupplyItem } from '$lib/features/supply';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { useDistributeStock, useStockBalance } from '../application/queries';
	import { toast } from 'svelte-sonner';
	import PackageMinus from '@lucide/svelte/icons/package-minus';

	let {
		onsuccess,
		preselectedItemId = undefined
	}: { onsuccess?: () => void; preselectedItemId?: string } = $props();

	// Fetch supply catalog items and stock balance
	const itemsQuery = useSupplyItems();
	const balanceQuery = useStockBalance();
	const distributeMutation = useDistributeStock();

	// Local state for searchable items combobox
	let searchQuery = $state('');
	let isDropdownOpen = $state(false);
	let selectedItem = $state<SupplyItem | null>(null);
	let container = $state<HTMLDivElement | null>(null);

	const currentStock = $derived.by(() => {
		if (!selectedItem || !balanceQuery.data) return 0;
		return balanceQuery.data.get(selectedItem._id) ?? 0;
	});

	// Filter items based on search query
	const filteredItems = $derived.by(() => {
		const items = itemsQuery.data ?? [];
		if (!searchQuery) return items;
		const query = searchQuery.toLowerCase().trim();
		return items.filter((i) => i.name.toLowerCase().includes(query));
	});

	const form = superForm(defaults(zod4(distributeInputSchema)), {
		SPA: true,
		validators: zod4(distributeInputSchema),
		resetForm: true,
		onUpdate: async ({ form: validated }) => {
			if (!validated.valid) {
				toast.error('กรุณาตรวจสอบข้อมูลในฟอร์ม');
				return;
			}

			// Validate sufficient stock
			if (validated.data.qty > currentStock) {
				toast.error(
					`ยอดคงเหลือไม่เพียงพอ (มี ${currentStock} ต้องการแจกจ่าย ${validated.data.qty})`
				);
				return;
			}

			await handleCommit(validated.data);
		}
	});

	const { form: formData, submitting, reset } = form;

	// Update locked unit when item is selected
	function selectItem(item: SupplyItem) {
		selectedItem = item;
		$formData.item_id = item._id;
		$formData.unit = item.unit;
		searchQuery = item.name;
		isDropdownOpen = false;
	}

	function clearSelection() {
		selectedItem = null;
		$formData.item_id = '';
		$formData.unit = '';
		searchQuery = '';
		isDropdownOpen = false;
	}

	// Submit handler
	async function handleCommit(data: DistributeInput) {
		const ctx = {
			shelterCode: getShelterCode(),
			createdBy: authStore.user?.name ?? 'unknown'
		};

		toast.promise(distributeMutation.mutateAsync({ input: data, ctx }), {
			loading: 'กำลังบันทึกข้อมูล...',
			success: () => {
				clearSelection();
				reset();
				if (onsuccess) onsuccess();
				return 'บันทึกการแจกจ่ายสำเร็จ!';
			},
			error: (err: unknown) =>
				err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการบันทึกข้อมูล'
		});
	}

	// Automatically pre-fill the selected item when preselectedItemId changes
	$effect(() => {
		if (preselectedItemId && itemsQuery.data) {
			const item = itemsQuery.data.find((i) => i._id === preselectedItemId);
			if (item) {
				selectItem(item);
			}
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
					<Form.Label class="text-xs font-bold text-foreground"
						>ค้นหาและเลือกรายการสิ่งของ</Form.Label
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
								{#if itemsQuery.isLoading || balanceQuery.isLoading}
									<div class="p-3 text-xs font-medium text-muted-foreground">
										กำลังโหลดข้อมูล...
									</div>
								{:else if filteredItems.length === 0}
									<div class="p-3 text-xs font-medium text-muted-foreground">
										ไม่พบรายการสิ่งของ
									</div>
								{:else}
									{#each filteredItems as item (item._id)}
										{@const bal = balanceQuery.data?.get(item._id) ?? 0}
										<button
											type="button"
											class="flex w-full cursor-pointer items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors hover:bg-muted"
											onclick={() => selectItem(item)}
											disabled={bal <= 0}
										>
											<div class="flex items-center gap-2">
												<span class="font-semibold text-foreground {bal <= 0 ? 'opacity-50' : ''}"
													>{item.name}</span
												>
											</div>
											<span
												class="rounded-md {bal > 0
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
				<span class="text-sm font-bold {currentStock > 0 ? 'text-primary' : 'text-destructive'}">
					{currentStock}
					{selectedItem.unit}
				</span>
			</div>
		{/if}

		<!-- Quantity -->
		<Form.Field {form} name="qty" class="col-span-1">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label class="text-xs font-bold text-foreground">จำนวนที่แจกจ่าย</Form.Label>
					<Input
						{...props}
						type="number"
						placeholder="ระบุจำนวน"
						min="0.01"
						max={currentStock || undefined}
						step="any"
						bind:value={$formData.qty}
						class="h-10 w-full rounded-xl border border-border/80 bg-background px-3 font-mono text-sm font-bold shadow-sm transition outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<!-- Unit (Locked) -->
		<Form.Field {form} name="unit" class="col-span-1">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label class="text-xs font-bold text-foreground">หน่วยนับ</Form.Label>
					<Input
						{...props}
						placeholder="ระบบจะล็อกอัตโนมัติ"
						bind:value={$formData.unit}
						readonly
						class="h-10 w-full cursor-not-allowed rounded-xl border border-border/80 bg-muted px-3 font-semibold text-muted-foreground shadow-sm"
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<!-- Destination / Note -->
		<Form.Field {form} name="note" class="col-span-1 sm:col-span-2">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label class="text-xs font-bold text-foreground"
						>สถานที่ปลายทาง หรือ ผู้รับ (ระบุรายละเอียด)</Form.Label
					>
					<Input
						{...props}
						placeholder="เช่น แจกจ่ายโซนเต็นท์ A, หรือระบุชื่อผู้รับ..."
						bind:value={$formData.note}
						class="h-10 w-full rounded-xl border border-border/80 bg-background px-3 text-sm font-semibold shadow-sm transition outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<!-- Submit Button -->
		<div class="col-span-1 pt-3 sm:col-span-2">
			<Form.Button
				disabled={$submitting || currentStock <= 0 || $formData.qty > currentStock}
				class="flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary text-sm font-extrabold text-primary-foreground shadow-md transition-all duration-300 hover:scale-[1.02] hover:bg-primary/95 hover:shadow-lg active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
			>
				{$submitting ? 'กำลังบันทึกรายการ...' : 'บันทึกการแจกจ่ายพัสดุ'}
			</Form.Button>
		</div>
	</Field.FieldGroup>
</form>
