<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { untrack } from 'svelte';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { toast } from 'svelte-sonner';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import ShoppingCart from '@lucide/svelte/icons/shopping-cart';
	import { purchaseInputSchema, type Purchase, type PurchaseInput } from '../domain/operations';
	import { useCreatePurchase, useUpdatePurchase } from '../application/queries';
	import { useSupplyItems } from '$lib/features/supply';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode } from '$lib/db/shelter';

	let {
		purchase = undefined,
		onsuccess,
		oncancel
	}: { purchase?: Purchase; onsuccess?: () => void; oncancel?: () => void } = $props();

	const isEdit = $derived(!!purchase);

	const itemsQuery = useSupplyItems();
	const catalog = $derived(itemsQuery.data ?? []);

	const createMutation = useCreatePurchase();
	const updateMutation = useUpdatePurchase();

	/**
	 * Keep the original timestamp when the day was not touched, so re-saving an
	 * unrelated field does not silently move `occurred_at` to midnight.
	 */
	function toTimestamp(dateInput: string | undefined): string {
		if (!dateInput) return new Date().toISOString();
		if (purchase && purchase.occurred_at.slice(0, 10) === dateInput) return purchase.occurred_at;
		return new Date(`${dateInput}T00:00:00`).toISOString();
	}

	// Seeded once — the form owns the values from here on, so a later prop change
	// must not silently overwrite what the user is typing.
	const initial: PurchaseInput = untrack(() =>
		purchase
			? {
					vendor: purchase.vendor,
					po_ref: purchase.po_ref ?? '',
					items: purchase.items.map((i) => ({ ...i })),
					occurred_at: purchase.occurred_at.slice(0, 10),
					note: purchase.note ?? ''
				}
			: {
					vendor: '',
					po_ref: '',
					items: [{ item_id: '', qty: '', unit: '' }],
					occurred_at: new Date().toISOString().slice(0, 10),
					note: ''
				}
	);

	// The create and edit dialogs mount at the same time — distinct ids keep
	// superforms from feeding one form's data to the other.
	const formId = untrack(() => (purchase ? `purchase-edit-${purchase._id}` : 'purchase-create'));

	const form = superForm(defaults(initial, zod4(purchaseInputSchema)), {
		SPA: true,
		id: formId,
		// `items` is a nested array of objects — superforms throws on init without this.
		dataType: 'json',
		validators: zod4(purchaseInputSchema),
		resetForm: false,
		onUpdate: async ({ form: validated }) => {
			if (!validated.valid) {
				toast.error('กรุณาตรวจสอบข้อมูลในฟอร์ม');
				return;
			}

			// Re-parse so `qty` lands as a normalised qty_str — superforms hands back
			// the raw input shape, where the number inputs are still numbers.
			const d = purchaseInputSchema.parse(validated.data);
			const items = d.items.map((i) => ({ item_id: i.item_id, qty: i.qty, unit: i.unit }));
			const occurredAt = toTimestamp(d.occurred_at);

			if (purchase) {
				const merged: Purchase = { ...purchase, vendor: d.vendor, items, occurred_at: occurredAt };
				if (d.po_ref) merged.po_ref = d.po_ref;
				else delete merged.po_ref;
				if (d.note) merged.note = d.note;
				else delete merged.note;

				toast.promise(updateMutation.mutateAsync({ purchase: merged }), {
					loading: 'กำลังบันทึกการแก้ไข...',
					success: () => {
						onsuccess?.();
						return 'แก้ไขใบจัดซื้อสำเร็จ';
					},
					error: (err: unknown) =>
						err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการบันทึกข้อมูล'
				});
				return;
			}

			const ctx = {
				shelterCode: getShelterCode(),
				createdBy: authStore.user?.name ?? 'unknown'
			};

			toast.promise(
				createMutation.mutateAsync({
					input: {
						vendor: d.vendor,
						...(d.po_ref ? { po_ref: d.po_ref } : {}),
						items,
						occurred_at: occurredAt,
						...(d.note ? { note: d.note } : {})
					},
					ctx
				}),
				{
					loading: 'กำลังสร้างใบจัดซื้อ...',
					success: () => {
						onsuccess?.();
						return 'สร้างใบจัดซื้อสำเร็จ';
					},
					error: (err: unknown) =>
						err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการบันทึกข้อมูล'
				}
			);
		}
	});

	const { form: formData, submitting } = form;

	/** The catalog owns the unit — picking an item locks it, matching ReceiveStockForm. */
	function selectItem(index: number, itemId: string) {
		const found = catalog.find((i) => i._id === itemId);
		$formData.items[index].item_id = itemId;
		$formData.items[index].unit = found?.unit ?? '';
	}

	function addRow() {
		$formData.items = [...$formData.items, { item_id: '', qty: '', unit: '' }];
	}

	function removeRow(index: number) {
		$formData.items = $formData.items.filter((_, i) => i !== index);
	}
</script>

<form
	method="POST"
	use:form.enhance
	class="flex flex-col space-y-4 rounded-2xl border border-border/80 bg-card p-5 shadow-md"
>
	<div class="mb-2 flex items-center gap-2 border-b border-border/60 pb-3">
		<ShoppingCart class="h-4.5 w-4.5 text-primary" />
		<h3 class="text-sm font-bold text-foreground">
			{isEdit ? 'แก้ไขใบจัดซื้อ' : 'สร้างใบจัดซื้อ (Purchase Order)'}
		</h3>
	</div>

	<Field.FieldGroup class="grid grid-cols-1 gap-4 sm:grid-cols-2">
		<Form.Field {form} name="vendor" class="col-span-1">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label class="text-xs font-bold text-foreground"
						>ผู้ขาย / หน่วยงานที่จัดหา</Form.Label
					>
					<Input
						{...props}
						placeholder="เช่น บริษัท สยามค้าส่ง จำกัด"
						bind:value={$formData.vendor}
						class="h-10 w-full rounded-xl border border-border/80 bg-background px-3 shadow-sm transition outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="po_ref" class="col-span-1">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label class="text-xs font-bold text-foreground">
						เลขใบสั่งซื้อ / สัญญา
						<span class="font-normal text-muted-foreground">(ไม่บังคับ)</span>
					</Form.Label>
					<Input
						{...props}
						placeholder="เช่น PO-2569-0142"
						bind:value={$formData.po_ref}
						class="h-10 w-full rounded-xl border border-border/80 bg-background px-3 font-mono text-sm shadow-sm transition outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="occurred_at" class="col-span-1">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label class="text-xs font-bold text-foreground">วันที่รับของเข้าศูนย์</Form.Label>
					<Input
						{...props}
						type="date"
						bind:value={$formData.occurred_at}
						class="h-10 w-full rounded-xl border border-border/80 bg-background px-3 text-sm font-semibold shadow-sm transition outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<!-- Ordered items — a planning signal only; real stock comes from the receipt -->
		<div class="col-span-1 space-y-2 sm:col-span-2">
			<div class="flex flex-wrap items-center justify-between gap-1">
				<span class="text-xs font-bold text-foreground">รายการที่สั่งซื้อ</span>
				<span class="text-2xs text-muted-foreground">
					ยอดจริงมาจากตอนกดรับเข้าคลัง — รายการนี้ใช้เทียบว่าของมาครบหรือยัง
				</span>
			</div>

			{#each $formData.items as row, i (row)}
				<div class="flex items-start gap-2 rounded-xl border border-border/60 bg-muted/30 p-2">
					<Form.ElementField {form} name="items[{i}].item_id" class="flex-1">
						<Form.Control>
							{#snippet children({ props })}
								<select
									{...props}
									value={row.item_id}
									onchange={(e) => selectItem(i, e.currentTarget.value)}
									disabled={itemsQuery.isLoading}
									aria-label="สิ่งของที่สั่งซื้อ"
									class="h-10 w-full cursor-pointer rounded-lg border border-border/80 bg-background px-2 text-sm font-semibold text-foreground shadow-sm outline-none focus:border-primary"
								>
									<option value="">
										{itemsQuery.isLoading ? 'กำลังโหลดรายการ...' : 'เลือกสิ่งของ'}
									</option>
									{#each catalog as item (item._id)}
										<option value={item._id}>{item.name}</option>
									{/each}
								</select>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors class="text-2xs" />
					</Form.ElementField>

					<Form.ElementField {form} name="items[{i}].qty" class="w-28">
						<Form.Control>
							{#snippet children({ props })}
								<Input
									{...props}
									type="number"
									placeholder="จำนวน"
									min="0.01"
									step="any"
									aria-label="จำนวนที่สั่ง"
									bind:value={$formData.items[i].qty}
									class="h-10 w-full rounded-lg border border-border/80 bg-background px-2 text-right font-mono text-sm font-bold shadow-sm outline-none focus:border-primary"
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors class="text-2xs" />
					</Form.ElementField>

					<div
						class="flex h-10 w-20 items-center justify-center rounded-lg border border-border/80 bg-muted px-2 text-xs font-semibold text-muted-foreground"
					>
						{row.unit || '—'}
					</div>

					<button
						type="button"
						onclick={() => removeRow(i)}
						disabled={$formData.items.length === 1}
						aria-label="ลบรายการนี้"
						class="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-border/80 bg-background text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40"
					>
						<Trash2 class="h-4 w-4" />
					</button>
				</div>
			{/each}

			<button
				type="button"
				onclick={addRow}
				class="flex h-9 w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-dashed border-border text-xs font-bold text-muted-foreground transition hover:border-primary hover:text-primary"
			>
				<Plus class="h-3.5 w-3.5" />
				เพิ่มรายการ
			</button>
		</div>

		<Form.Field {form} name="note" class="col-span-1 sm:col-span-2">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label class="text-xs font-bold text-foreground">
						หมายเหตุ <span class="font-normal text-muted-foreground">(ไม่บังคับ)</span>
					</Form.Label>
					<Textarea
						{...props}
						rows={2}
						placeholder="รายละเอียดเพิ่มเติมของใบจัดซื้อนี้"
						bind:value={$formData.note}
						class="w-full rounded-xl border border-border/80 bg-background px-3 py-2 text-sm shadow-sm transition outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<div class="col-span-1 flex gap-2 pt-3 sm:col-span-2">
			{#if oncancel}
				<button
					type="button"
					onclick={oncancel}
					class="h-11 flex-1 cursor-pointer rounded-xl border border-border bg-background text-sm font-bold text-muted-foreground transition hover:bg-muted"
				>
					ยกเลิก
				</button>
			{/if}
			<Form.Button
				disabled={$submitting}
				class="flex h-11 flex-[2] cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary text-sm font-extrabold text-primary-foreground shadow-md transition-all duration-300 hover:bg-primary/95 hover:shadow-lg active:scale-[0.98]"
			>
				{#if $submitting}
					กำลังบันทึก...
				{:else}
					{isEdit ? 'บันทึกการแก้ไข' : 'สร้างใบจัดซื้อ'}
				{/if}
			</Form.Button>
		</div>
	</Field.FieldGroup>
</form>
