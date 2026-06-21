<script lang="ts">
	import { onMount } from 'svelte';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { receiveInputSchema, type ReceiveInput } from '../domain/operations';
	import { useSupplyItems, type SupplyItem } from '$lib/features/supply';
	import { authStore } from '$lib/stores/auth.svelte';
	import { SHELTER_CODE } from '../data/operations.pouch';
	import { useReceiveStock } from '../application/queries';
	import { toast } from 'svelte-sonner';
	import PackagePlus from '@lucide/svelte/icons/package-plus';

	let { onsuccess }: { onsuccess?: () => void } = $props();

	// Fetch supply catalog items
	const itemsQuery = useSupplyItems();
	const receiveMutation = useReceiveStock();

	// Local state for searchable items combobox
	let searchQuery = $state('');
	let isDropdownOpen = $state(false);
	let selectedItem = $state<SupplyItem | null>(null);
	let container = $state<HTMLDivElement | null>(null);

	// Filter items based on search query
	const filteredItems = $derived(() => {
		const items = itemsQuery.data ?? [];
		if (!searchQuery) return items;
		const query = searchQuery.toLowerCase().trim();
		return items.filter((i) => i.name.toLowerCase().includes(query));
	});

	const form = superForm(defaults(zod4(receiveInputSchema)), {
		SPA: true,
		validators: zod4(receiveInputSchema),
		resetForm: true,
		onUpdate: async ({ form: validated }) => {
			if (!validated.valid) {
				toast.error('กรุณาตรวจสอบข้อมูลในฟอร์ม');
				return;
			}

			// Validate perishable item expiry date requirement
			if (selectedItem?.perishable && !validated.data.lot?.expiry) {
				toast.error(`สินค้า "${selectedItem.name}" เป็นของเสียได้ จำเป็นต้องระบุวันหมดอายุ`);
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

	// Quick expiry date buttons (+3d / +7d)
	function setQuickExpiry(days: number) {
		const formatted = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
		if (!$formData.lot) {
			$formData.lot = { expiry: formatted, note: '' };
		} else {
			$formData.lot.expiry = formatted;
		}
	}

	// Submit handler
	async function handleCommit(data: ReceiveInput) {
		const ctx = {
			shelterCode: SHELTER_CODE,
			createdBy: authStore.user?.name ?? 'unknown'
		};

		toast.promise(receiveMutation.mutateAsync({ input: data, ctx }), {
			loading: 'กำลังบันทึกข้อมูล...',
			success: () => {
				clearSelection();
				reset();
				if (onsuccess) onsuccess();
				return 'บันทึกของเข้าคลังสำเร็จ!';
			},
			error: (err: unknown) =>
				err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการบันทึกข้อมูล'
		});
	}

	// Click outside container closes dropdown
	onMount(() => {
		function handleClickOutside(event: MouseEvent) {
			if (container && !container.contains(event.target as Node)) {
				isDropdownOpen = false;
			}
		}
		document.addEventListener('click', handleClickOutside);
		return () => {
			document.removeEventListener('click', handleClickOutside);
		};
	});
</script>

<form
	method="POST"
	use:form.enhance
	class="space-y-4 rounded-xl border border-border bg-card p-5 shadow-sm"
>
	<div class="flex items-center gap-2 border-b border-border pb-3">
		<PackagePlus class="h-4.5 w-4.5 text-primary" />
		<h3 class="text-sm font-bold text-foreground">รับของเข้าคลัง (Inbound Stock Receipt)</h3>
	</div>

	<Field.FieldGroup class="grid grid-cols-1 gap-4 sm:grid-cols-2">
		<!-- Searchable Item Selector -->
		<Form.Field {form} name="item_id" class="relative col-span-1 sm:col-span-2">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>ค้นหาและเลือกรายการสิ่งของ</Form.Label>
					<div bind:this={container} class="relative w-full">
						<Input
							{...props}
							placeholder="พิมพ์เพื่อค้นหา เช่น ข้าวสาร, น้ำดื่ม..."
							bind:value={searchQuery}
							onfocus={() => (isDropdownOpen = true)}
							oninput={() => (isDropdownOpen = true)}
							autocomplete="off"
						/>
						{#if selectedItem}
							<button
								type="button"
								class="absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
								onclick={clearSelection}
							>
								ล้างค่า
							</button>
						{/if}

						{#if isDropdownOpen}
							<div
								class="absolute left-0 z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md"
							>
								{#if itemsQuery.isLoading}
									<div class="p-2 text-xs text-muted-foreground">กำลังโหลดรายการสิ่งของ...</div>
								{:else if filteredItems().length === 0}
									<div class="p-2 text-xs text-muted-foreground">ไม่พบรายการสิ่งของ</div>
								{:else}
									{#each filteredItems() as item (item._id)}
										<button
											type="button"
											class="flex w-full items-center justify-between rounded-sm px-3 py-2 text-left text-sm hover:bg-muted"
											onclick={() => selectItem(item)}
										>
											<span class="font-medium text-foreground">{item.name}</span>
											<span class="rounded bg-muted/65 px-2 py-0.5 text-xs text-muted-foreground">
												หน่วย: {item.unit}
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

		<!-- Quantity -->
		<Form.Field {form} name="qty">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>จำนวนที่รับเข้า</Form.Label>
					<Input
						{...props}
						type="number"
						placeholder="ระบุจำนวน"
						min="0.01"
						step="any"
						bind:value={$formData.qty}
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<!-- Unit (Locked) -->
		<Form.Field {form} name="unit">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>หน่วยนับ</Form.Label>
					<Input
						{...props}
						placeholder="หน่วยนับ (ระบบจะล็อกอัตโนมัติ)"
						bind:value={$formData.unit}
						readonly
						class="cursor-not-allowed bg-muted text-muted-foreground"
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<!-- Source -->
		<Form.Field {form} name="source">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>แหล่งที่มา</Form.Label>
					<select
						{...props}
						bind:value={$formData.source}
						class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
					>
						<option value="" disabled selected>เลือกแหล่งที่มา</option>
						<option value="donation">ของบริจาค (Donation)</option>
						<option value="purchase">การจัดซื้อจัดจ้าง (Purchase)</option>
						<option value="transfer_in">โอนย้ายมาจากศูนย์อื่น (Transfer In)</option>
						<option value="manual">กรอกปรับปรุงคลังด้วยตนเอง (Manual/Adjust)</option>
					</select>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<!-- Reference ID (Conditional) -->
		{#if $formData.source === 'donation' || $formData.source === 'transfer_in'}
			<Form.Field {form} name="ref_id">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label>เลขอ้างอิง (เลขอ้างอิงของบริจาค/โอน)</Form.Label>
						<Input
							{...props}
							placeholder="เช่น donation:12345 หรือ transfer:6789"
							bind:value={$formData.ref_id}
						/>
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>
		{/if}

		<!-- Storage Location (lot.note) -->
		<Form.Field {form} name="lot.note">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>สถานที่จัดเก็บในคลัง (โซน/ชั้นวาง)</Form.Label>
					<select
						{...props}
						value={$formData.lot?.note ?? ''}
						onchange={(e) => {
							if (!$formData.lot) {
								$formData.lot = { expiry: '', note: e.currentTarget.value };
							} else {
								$formData.lot.note = e.currentTarget.value;
							}
						}}
						class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
					>
						<option value="">เลือกโซนที่เก็บ</option>
						<option value="Zone A">Zone A (ของใช้ทั่วไป)</option>
						<option value="Zone B">Zone B (ของที่เน่าเสียได้)</option>
						<option value="Zone C">Zone C (ยาและเวชภัณฑ์)</option>
					</select>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<!-- Expiry Date (lot.expiry) -->
		<Form.Field {form} name="lot.expiry" class="col-span-1 sm:col-span-2">
			<Form.Control>
				{#snippet children({ props })}
					<div class="flex items-center justify-between">
						<Form.Label>
							วันหมดอายุ
							{#if selectedItem?.perishable}
								<span class="font-bold text-destructive">* (ของเสียได้ บังคับกรอก)</span>
							{/if}
						</Form.Label>
						<div class="mb-1 flex gap-2">
							<button
								type="button"
								class="rounded bg-muted px-2 py-0.5 text-[10px] text-muted-foreground transition hover:bg-muted/80"
								onclick={() => setQuickExpiry(3)}
							>
								+3 วัน
							</button>
							<button
								type="button"
								class="rounded bg-muted px-2 py-0.5 text-[10px] text-muted-foreground transition hover:bg-muted/80"
								onclick={() => setQuickExpiry(7)}
							>
								+7 วัน
							</button>
						</div>
					</div>
					<Input
						{...props}
						type="date"
						value={$formData.lot?.expiry ?? ''}
						oninput={(e) => {
							if (!$formData.lot) {
								$formData.lot = { expiry: e.currentTarget.value, note: '' };
							} else {
								$formData.lot.expiry = e.currentTarget.value;
							}
						}}
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<!-- Submit Button -->
		<div class="col-span-1 pt-2 sm:col-span-2">
			<Form.Button disabled={$submitting} class="w-full">
				{$submitting ? 'กำลังบันทึกรายการ...' : 'ลงทะเบียนบันทึกของเข้าคลัง'}
			</Form.Button>
		</div>
	</Field.FieldGroup>
</form>
