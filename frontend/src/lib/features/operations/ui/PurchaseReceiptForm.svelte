<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { untrack } from 'svelte';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { toast } from 'svelte-sonner';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import PackageCheck from '@lucide/svelte/icons/package-check';
	import { purchaseReceiptInputSchema, type Purchase } from '../domain/operations';
	import { useReceivePurchase, useStockLedgers } from '../application/queries';
	import { useSupplyItems } from '$lib/features/supply';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { addQty, qtyAbs, subQty, qtyGt } from '$lib/utils/qty';

	let {
		purchase,
		onsuccess,
		oncancel
	}: { purchase: Purchase; onsuccess?: () => void; oncancel?: () => void } = $props();

	const itemsQuery = useSupplyItems();
	const ledgerQuery = useStockLedgers();
	const receiveMutation = useReceivePurchase();

	const catalog = $derived(itemsQuery.data ?? []);
	const itemById = $derived(new Map(catalog.map((i) => [i._id, i])));

	/** What already arrived against this purchase — informational, never a prefill. */
	const receivedByItem = $derived.by(() => {
		const totals: Record<string, string> = {};
		for (const entry of ledgerQuery.data ?? []) {
			if (entry.reason !== 'purchase' || entry.ref_id !== purchase._id) continue;
			totals[entry.item_id] = addQty(totals[entry.item_id] ?? '0', qtyAbs(entry.qty));
		}
		return totals;
	});

	// Prefilled from the ordered lines (CR-032 §UX 2) — staff correct the numbers
	// against what physically showed up.
	const form = superForm(
		defaults(
			untrack(() => ({
				counted: purchase.items.map((i) => ({
					item_id: i.item_id,
					qty: i.qty,
					unit: i.unit,
					lot: { expiry: '', note: '' }
				}))
			})),
			zod4(purchaseReceiptInputSchema)
		),
		{
			SPA: true,
			// `counted` is a nested array of objects — superforms throws on init without this.
			dataType: 'json',
			validators: zod4(purchaseReceiptInputSchema),
			resetForm: false,
			onUpdate: async ({ form: validated }) => {
				if (!validated.valid) {
					toast.error('กรุณาตรวจสอบจำนวนที่นับได้');
					return;
				}

				// Re-parse so `qty` lands as a normalised qty_str — superforms hands
				// back the raw input shape, where the number inputs are still numbers.
				const parsed = purchaseReceiptInputSchema.parse(validated.data);

				// Perishable goods must carry an expiry. That flag lives in the supply
				// catalog, which the domain schema cannot see — same split as
				// ReceiveStockForm.
				for (const line of parsed.counted) {
					const item = itemById.get(line.item_id);
					if (item?.perishable && !line.lot?.expiry) {
						toast.error(`สินค้า "${item.name}" เป็นของเสียได้ จำเป็นต้องระบุวันหมดอายุ`);
						return;
					}
				}

				const counted = parsed.counted.map((line) => {
					const expiry = line.lot?.expiry?.trim();
					const note = line.lot?.note?.trim();
					const lot = expiry || note ? { ...(expiry && { expiry }), ...(note && { note }) } : null;
					return {
						item_id: line.item_id,
						qty: line.qty,
						unit: line.unit,
						...(lot ? { lot } : {})
					};
				});

				const ctx = {
					shelterCode: getShelterCode(),
					createdBy: authStore.user?.name ?? 'unknown'
				};

				toast.promise(receiveMutation.mutateAsync({ purchase, counted, ctx }), {
					loading: 'กำลังบันทึกของเข้าคลัง...',
					success: () => {
						onsuccess?.();
						return 'บันทึกรับของเข้าคลังสำเร็จ';
					},
					error: (err: unknown) =>
						err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการบันทึกข้อมูล'
				});
			}
		}
	);

	const { form: formData, submitting } = form;

	function removeRow(index: number) {
		$formData.counted = $formData.counted.filter((_, i) => i !== index);
	}

	function itemName(itemId: string): string {
		return itemById.get(itemId)?.name ?? itemId;
	}

	function orderedQty(itemId: string): string | null {
		return purchase.items.find((i) => i.item_id === itemId)?.qty ?? null;
	}

	function outstanding(itemId: string): string | null {
		const ordered = orderedQty(itemId);
		if (!ordered) return null;
		const remaining = subQty(ordered, receivedByItem[itemId] ?? '0');
		return qtyGt(remaining, 0) ? remaining : null;
	}

	/** `lot` is optional in the schema, so every write goes through here. */
	function patchLot(index: number, patch: { expiry?: string; note?: string }) {
		$formData.counted[index].lot = { ...($formData.counted[index].lot ?? {}), ...patch };
	}

	function setQuickExpiry(index: number, days: number) {
		const formatted = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
		patchLot(index, { expiry: formatted });
	}
</script>

<form
	method="POST"
	use:form.enhance
	class="flex flex-col space-y-4 rounded-2xl border border-border/80 bg-card p-5 shadow-md"
>
	<div class="mb-1 flex items-center gap-2 border-b border-border/60 pb-3">
		<PackageCheck class="h-4.5 w-4.5 shrink-0 text-primary" />
		<div class="min-w-0">
			<h3 class="truncate text-sm font-bold text-foreground">
				รับของเข้าคลัง — {purchase.vendor}
			</h3>
			<p class="truncate text-2xs text-muted-foreground">
				{purchase.po_ref ? `เลขที่ ${purchase.po_ref} · ` : ''}นับได้เท่าไรกรอกเท่านั้น
				รับหลายรอบได้
			</p>
		</div>
	</div>

	<Field.FieldGroup class="space-y-3">
		{#if $formData.counted.length === 0}
			<p
				class="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground"
			>
				ไม่เหลือรายการให้บันทึก — กดยกเลิกแล้วเปิดใหม่เพื่อเริ่มต้นอีกครั้ง
			</p>
		{/if}

		{#each $formData.counted as row, i (row)}
			{@const item = itemById.get(row.item_id)}
			{@const remaining = outstanding(row.item_id)}
			<div class="space-y-2 rounded-xl border border-border/60 bg-muted/30 p-3">
				<div class="flex items-start justify-between gap-2">
					<div class="min-w-0">
						<p class="truncate text-sm font-bold text-foreground">{itemName(row.item_id)}</p>
						<p class="text-2xs text-muted-foreground">
							สั่ง {orderedQty(row.item_id) ?? '—'}
							{row.unit} · รับแล้ว {receivedByItem[row.item_id] ?? '0'}
							{row.unit}{remaining ? ` · ค้าง ${remaining} ${row.unit}` : ''}
						</p>
					</div>
					<button
						type="button"
						onclick={() => removeRow(i)}
						aria-label="ไม่บันทึกรายการนี้"
						class="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-border/80 bg-background text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
					>
						<Trash2 class="h-3.5 w-3.5" />
					</button>
				</div>

				<div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
					<Form.ElementField {form} name="counted[{i}].qty" class="col-span-1">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label class="text-2xs font-bold text-foreground">จำนวนที่นับได้</Form.Label>
								<Input
									{...props}
									type="number"
									min="0.01"
									step="any"
									bind:value={$formData.counted[i].qty}
									class="h-10 w-full rounded-lg border border-border/80 bg-background px-2 text-right font-mono text-sm font-bold shadow-sm outline-none focus:border-primary"
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors class="text-2xs" />
					</Form.ElementField>

					<Form.ElementField {form} name="counted[{i}].lot.expiry" class="col-span-1">
						<Form.Control>
							{#snippet children({ props })}
								<div class="flex items-center justify-between gap-1">
									<Form.Label class="text-2xs font-bold text-foreground">
										วันหมดอายุ
										{#if item?.perishable}
											<span class="font-bold text-rose-600 dark:text-rose-400">* บังคับ</span>
										{/if}
									</Form.Label>
									<div class="flex gap-1">
										<button
											type="button"
											class="cursor-pointer rounded-full border border-border bg-background px-2 py-0.5 text-2xs font-bold text-muted-foreground transition hover:bg-muted"
											onclick={() => setQuickExpiry(i, 3)}
										>
											+3 วัน
										</button>
										<button
											type="button"
											class="cursor-pointer rounded-full border border-border bg-background px-2 py-0.5 text-2xs font-bold text-muted-foreground transition hover:bg-muted"
											onclick={() => setQuickExpiry(i, 7)}
										>
											+7 วัน
										</button>
									</div>
								</div>
								<Input
									{...props}
									type="date"
									value={row.lot?.expiry ?? ''}
									oninput={(e) => patchLot(i, { expiry: e.currentTarget.value })}
									class="h-10 w-full rounded-lg border border-border/80 bg-background px-2 text-sm font-semibold shadow-sm outline-none focus:border-primary"
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors class="text-2xs" />
					</Form.ElementField>

					<Form.ElementField {form} name="counted[{i}].lot.note" class="col-span-1">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label class="text-2xs font-bold text-foreground">สถานที่จัดเก็บ</Form.Label>
								<select
									{...props}
									value={row.lot?.note ?? ''}
									onchange={(e) => patchLot(i, { note: e.currentTarget.value })}
									class="h-10 w-full cursor-pointer rounded-lg border border-border/80 bg-background px-2 text-sm font-semibold text-foreground shadow-sm outline-none focus:border-primary"
								>
									<option value="">เลือกโซนที่เก็บ</option>
									<option value="Zone A">Zone A (ของใช้ทั่วไป)</option>
									<option value="Zone B">Zone B (ของที่เน่าเสียได้)</option>
									<option value="Zone C">Zone C (ยาและเวชภัณฑ์)</option>
								</select>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors class="text-2xs" />
					</Form.ElementField>
				</div>
			</div>
		{/each}

		<div class="flex gap-2 pt-1">
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
				disabled={$submitting || $formData.counted.length === 0}
				class="flex h-11 flex-[2] cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary text-sm font-extrabold text-primary-foreground shadow-md transition-all duration-300 hover:bg-primary/95 hover:shadow-lg active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
			>
				{$submitting ? 'กำลังบันทึก...' : 'ยืนยันรับเข้าคลัง'}
			</Form.Button>
		</div>
	</Field.FieldGroup>
</form>
