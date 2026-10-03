<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { z } from 'zod';
	import { getShelterCode } from '$lib/db/shelter';
	import { authStore } from '$lib/stores/auth.svelte';
	import { useCreateTransfer, useStockBalance } from '../application/queries';
	import { useStockFormItems } from '../application/use-stock-form-items.svelte';
	import type { StockFormItem } from '../domain/stock-form-items';
	import ItemCombobox from './item-combobox.svelte';
	import {
		formatUnit,
		useUnitsOfMeasure,
		itemSelectableUoms,
		defaultIssueUom,
		qtyToBaseUnit
	} from '$lib/features/catalog';
	import { useShelters } from '$lib/features/shelters';
	import { langState } from '$lib/states/i18n.svelte';
	import { toast } from 'svelte-sonner';
	import Truck from '@lucide/svelte/icons/truck';
	import { qtyGt, qtyLte, subQty } from '$lib/utils/qty';

	let { onsuccess }: { onsuccess?: () => void } = $props();

	// Session expired (`needsReauth`): every save button is off until the user signs in again.
	const offline = $derived(authStore.needsReauth);

	const createMutation = useCreateTransfer();
	const unitsQuery = useUnitsOfMeasure();
	const units = $derived(unitsQuery.data ?? []);
	const sheltersQuery = useShelters();
	const stockItems = useStockFormItems(() => getShelterCode());
	const balanceQuery = useStockBalance();

	const ownShelter = getShelterCode();
	const destinationShelters = $derived(
		(sheltersQuery.data ?? []).filter((s) => s.code !== ownShelter)
	);
	const items = $derived(stockItems.items);
	const balanceByItemId = $derived(balanceQuery.data ?? new Map<string, string>());

	let selectedItemId = $state('');
	let selectedItem = $state<StockFormItem | null>(null);

	// Interim single-item form schema — the domain's `transferInputSchema` takes an `items[]`
	// array (split-lot allocation across multiple lots/items is out of scope this round; see
	// CR-059's "field ละเอียด" note). Mapped into a one-item TransferInput on submit.
	const transferFormSchema = z.object({
		to_shelter: z.string().trim().min(1, 'กรุณาระบุศูนย์ปลายทาง'),
		item_id: z.string().trim().min(1, 'กรุณาระบุสินค้า'),
		qty: z.coerce.number().positive('จำนวนต้องมากกว่า 0'),
		unit: z.string().trim().min(1, 'กรุณาระบุหน่วยนับ'),
		notes: z.string().trim().optional()
	});

	const form = superForm(defaults(zod4(transferFormSchema)), {
		SPA: true,
		validators: zod4(transferFormSchema),
		resetForm: true,
		onUpdate: async ({ form: validated }) => {
			if (!validated.valid) {
				toast.error('กรุณาตรวจสอบข้อมูลในฟอร์ม');
				return;
			}
			await handleCreate(validated.data);
		}
	});

	const { form: formData, submitting } = form;

	const unitOptions = $derived(selectedItem ? itemSelectableUoms(selectedItem) : []);
	const selectedUnitLabel = $derived(
		formatUnit($formData.unit, units, langState.current) || $formData.unit || 'เลือกหน่วย'
	);
	const currentStock = $derived.by(() => {
		if (!selectedItem) return '0';
		return balanceByItemId.get(selectedItem._id) ?? '0';
	});
	const remainingAfterTransfer = $derived.by(() => {
		if (!selectedItem || !$formData.qty) return null;
		try {
			const inBase = qtyToBaseUnit(String($formData.qty), $formData.unit, selectedItem);
			if (qtyGt(inBase, currentStock)) return 'over' as const;
			return subQty(currentStock, inBase);
		} catch {
			return null;
		}
	});
	const selectedShelterLabel = $derived.by(() => {
		const shelter = destinationShelters.find((s) => s.code === $formData.to_shelter);
		if (!shelter) return 'เลือกศูนย์ปลายทาง';
		return `${shelter.name} (${shelter.code})`;
	});

	function selectItem(item: StockFormItem | null) {
		selectedItem = item;
		selectedItemId = item?._id ?? '';
		$formData.item_id = item?._id ?? '';
		$formData.unit = item ? defaultIssueUom(item) : '';
	}

	async function handleCreate(data: z.infer<typeof transferFormSchema>) {
		if (selectedItem) {
			try {
				const inBase = qtyToBaseUnit(String(data.qty), data.unit, selectedItem);
				if (qtyGt(inBase, currentStock)) {
					toast.error('จำนวนเกินยอดคงเหลือในศูนย์นี้');
					return;
				}
			} catch {
				toast.error('หน่วยที่เลือกไม่ถูกต้องสำหรับสินค้านี้');
				return;
			}
		}

		const input = {
			from_shelter: getShelterCode(),
			to_shelter: data.to_shelter,
			items: [{ item_id: data.item_id, qty: data.qty, unit: data.unit }],
			...(data.notes ? { notes: data.notes } : {})
		};
		const ctx = { shelterCode: getShelterCode(), createdBy: authStore.user?.name ?? 'unknown' };

		toast.promise(createMutation.mutateAsync({ input, ctx }), {
			loading: 'กำลังสร้างคำร้องโอนย้าย...',
			success: () => {
				selectItem(null);
				onsuccess?.();
				return 'สร้างคำร้องโอนย้ายสำเร็จ!';
			},
			error: (err: unknown) =>
				err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการสร้างคำร้อง'
		});
	}
</script>

<form
	method="POST"
	use:form.enhance
	class="flex flex-col space-y-4 rounded-2xl border border-border/80 bg-card p-5 shadow-md"
>
	<div class="mb-1 flex flex-col gap-1 border-b border-border/60 pb-3">
		<div class="flex items-center gap-2">
			<Truck class="h-4.5 w-4.5 text-primary" aria-hidden="true" />
			<h3 class="text-sm font-bold text-foreground">สร้างคำขอโอนออก</h3>
		</div>
		<p class="text-xs text-muted-foreground">ส่งคำขอไปยังศูนย์อื่น — ต้นทางอนุมัติส่งมอบทีหลัง</p>
	</div>

	<Field.FieldGroup class="grid grid-cols-1 gap-4">
		<Form.Field {form} name="to_shelter">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>ศูนย์ปลายทาง <span class="font-bold text-destructive">*</span></Form.Label>
					<Select.Root
						type="single"
						value={$formData.to_shelter}
						onValueChange={(value) => {
							if (value) $formData.to_shelter = value;
						}}
						disabled={sheltersQuery.isLoading || destinationShelters.length === 0}
					>
						<Select.Trigger {...props} class="min-h-11 w-full">
							{selectedShelterLabel}
						</Select.Trigger>
						<Select.Content>
							{#each destinationShelters as shelter (shelter.code)}
								<Select.Item value={shelter.code} label={`${shelter.name} (${shelter.code})`}>
									{shelter.name}
									<span class="ml-1 font-mono text-xs text-muted-foreground">{shelter.code}</span>
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="item_id" class="relative">
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
						isLoading={stockItems.isLoading || balanceQuery.isLoading}
						{balanceByItemId}
						disableWhenEmpty={true}
						formatBalanceUnit={(item) =>
							formatUnit(item.unit, units, langState.current) || item.unit}
						onSelect={selectItem}
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
			<Form.Field {form} name="qty">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label>จำนวน <span class="font-bold text-destructive">*</span></Form.Label>
						<Input
							{...props}
							type="number"
							min="0.01"
							step="any"
							placeholder="ระบุจำนวน"
							bind:value={$formData.qty}
							class="min-h-11 font-mono font-bold"
						/>
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>

			<Form.Field {form} name="unit">
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
								onValueChange={(value) => {
									if (value) $formData.unit = value;
								}}
							>
								<Select.Trigger {...props} class="min-h-11 w-full">
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
		</div>

		<p class="text-xs text-muted-foreground">
			หน่วยแสดงเฉพาะที่สินค้าใช้ได้
			{#if remainingAfterTransfer === 'over'}
				· <span class="font-semibold text-destructive">เกินยอดคงเหลือ</span>
			{:else if remainingAfterTransfer !== null && selectedItem}
				· <span class="font-semibold text-foreground"
					>หลังโอนจะเหลือ {remainingAfterTransfer}
					{formatUnit(selectedItem.unit, units, langState.current) || selectedItem.unit}</span
				>
			{/if}
		</p>

		<Form.Field {form} name="notes">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>หมายเหตุ (ถ้ามี)</Form.Label>
					<Input
						{...props}
						placeholder="รายละเอียดเพิ่มเติม"
						bind:value={$formData.notes}
						class="min-h-11"
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<div class="pt-1">
			<Form.Button
				disabled={$submitting || offline || !selectedItem || qtyLte(currentStock, 0)}
				class="min-h-11 w-full font-bold"
			>
				{$submitting ? 'กำลังบันทึก…' : 'ส่งคำขอโอน'}
			</Form.Button>
		</div>
	</Field.FieldGroup>
</form>
