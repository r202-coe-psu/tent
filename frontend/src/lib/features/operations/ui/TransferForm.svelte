<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { transferInputSchema, type TransferInput } from '../domain/operations';
	import { useSupplyItems } from '$lib/features/supply';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { useCreateAndDispatchTransfer, useStockBalance } from '../application/queries';
	import { useShelters } from '$lib/features/shelters';
	import { toast } from 'svelte-sonner';
	import Truck from '@lucide/svelte/icons/truck';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';

	let { onsuccess }: { onsuccess?: () => void } = $props();

	const itemsQuery = useSupplyItems();
	const balanceQuery = useStockBalance();
	const sheltersQuery = useShelters();
	const transferMutation = useCreateAndDispatchTransfer();

	const form = superForm(
		defaults(
			{
				from_shelter: getShelterCode(),
				to_shelter: '',
				items: [{ item_id: '', qty: 0, unit: '' }]
			},
			zod4(transferInputSchema)
		),
		{
			SPA: true,
			dataType: 'json',
			validators: zod4(transferInputSchema),
			resetForm: true,
			onUpdate: async ({ form: validated }) => {
				if (!validated.valid) {
					toast.error('กรุณาตรวจสอบข้อมูลในฟอร์ม');
					return;
				}

				if (validated.data.from_shelter === validated.data.to_shelter) {
					toast.error('ไม่สามารถโอนไปยังศูนย์ต้นทางเองได้');
					return;
				}

				// Validate sufficient stock for all items
				for (const item of validated.data.items) {
					const currentStock = balanceQuery.data?.get(item.item_id) ?? 0;
					if (item.qty > currentStock) {
						const itemName =
							itemsQuery.data?.find((i) => i._id === item.item_id)?.name ?? item.item_id;
						toast.error(
							`ยอดคงเหลือไม่เพียงพอสำหรับ ${itemName} (มี ${currentStock} ต้องการ ${item.qty})`
						);
						return;
					}
				}

				await handleCommit(validated.data);
			}
		}
	);

	const { form: formData, submitting, reset, errors } = form;

	function addItem() {
		$formData.items = [...$formData.items, { item_id: '', qty: 0, unit: '' }];
	}

	function removeItem(index: number) {
		$formData.items = $formData.items.filter((_, i) => i !== index);
	}

	function selectItem(index: number, itemId: string) {
		const item = itemsQuery.data?.find((i) => i._id === itemId);
		if (item) {
			$formData.items[index].item_id = item._id;
			$formData.items[index].unit = item.unit;
		}
	}

	async function handleCommit(data: TransferInput) {
		const ctx = {
			shelterCode: getShelterCode(),
			createdBy: authStore.user?.name ?? 'unknown'
		};

		toast.promise(transferMutation.mutateAsync({ input: data, ctx }), {
			loading: 'กำลังสร้างรายการโอนและส่งออก...',
			success: () => {
				reset();
				if (onsuccess) onsuccess();
				return 'โอนย้ายพัสดุสำเร็จ!';
			},
			error: (err: unknown) => (err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการโอนย้าย')
		});
	}

	const availableShelters = $derived(
		(sheltersQuery.data ?? []).filter((s) => s.code !== getShelterCode())
	);
</script>

<form
	method="POST"
	use:form.enhance
	class="flex flex-col space-y-6 rounded-2xl border border-border/80 bg-card p-5 shadow-md"
>
	<div class="flex items-center gap-2 border-b border-border/60 pb-3">
		<Truck class="h-5 w-5 text-primary" />
		<h3 class="text-base font-bold text-foreground">โอนย้ายพัสดุ (Inter-Shelter Transfer)</h3>
	</div>

	<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
		<!-- Source Shelter (Read-only) -->
		<Form.Field {form} name="from_shelter" class="col-span-1">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label class="text-xs font-bold text-foreground">ศูนย์ต้นทาง</Form.Label>
					<Input
						{...props}
						bind:value={$formData.from_shelter}
						readonly
						class="h-10 w-full cursor-not-allowed rounded-xl border border-border/80 bg-muted px-3 font-semibold text-muted-foreground shadow-sm"
					/>
				{/snippet}
			</Form.Control>
		</Form.Field>

		<!-- Destination Shelter -->
		<Form.Field {form} name="to_shelter" class="col-span-1">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label class="text-xs font-bold text-foreground"
						>ศูนย์ปลายทาง <span class="text-destructive">*</span></Form.Label
					>
					<select
						{...props}
						bind:value={$formData.to_shelter}
						class="flex h-10 w-full rounded-xl border border-border/80 bg-background px-3 text-sm shadow-sm transition outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
					>
						<option value="" disabled>-- เลือกศูนย์ปลายทาง --</option>
						{#if sheltersQuery.isLoading}
							<option value="" disabled>กำลังโหลด...</option>
						{:else}
							{#each availableShelters as shelter (shelter.code)}
								<option value={shelter.code}>{shelter.code} - {shelter.name}</option>
							{/each}
						{/if}
					</select>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>
	</div>

	<!-- Items List -->
	<div class="space-y-4 rounded-xl border border-border/60 bg-muted/20 p-4">
		<div class="flex items-center justify-between border-b border-border/60 pb-2">
			<h4 class="text-sm font-bold text-foreground">รายการพัสดุที่ต้องการโอน</h4>
			<button
				type="button"
				class="flex items-center gap-1 rounded-lg bg-secondary px-3 py-1.5 text-xs font-semibold text-secondary-foreground transition hover:bg-secondary/80"
				onclick={addItem}
			>
				<Plus class="h-3.5 w-3.5" /> เพิ่มรายการ
			</button>
		</div>

		{#each $formData.items as item, i (item.item_id || i)}
			<div class="grid grid-cols-12 items-end gap-3">
				<!-- Item Selector -->
				<div class="col-span-12 sm:col-span-6">
					<label class="mb-1 block text-xs font-bold text-foreground">รายการที่ {i + 1}</label>
					<select
						class="flex h-10 w-full rounded-xl border border-border/80 bg-background px-3 text-sm shadow-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
						value={$formData.items[i].item_id}
						onchange={(e) => selectItem(i, e.currentTarget.value)}
					>
						<option value="" disabled>-- เลือกพัสดุ --</option>
						{#each itemsQuery.data ?? [] as supplyItem (supplyItem._id)}
							{@const bal = balanceQuery.data?.get(supplyItem._id) ?? 0}
							<option value={supplyItem._id} disabled={bal <= 0}>
								{supplyItem.name} (คงเหลือ: {bal}
								{supplyItem.unit})
							</option>
						{/each}
					</select>
					{#if $errors.items?.[i]?.item_id}
						<p class="mt-1 text-xs font-medium text-destructive">{$errors.items[i].item_id}</p>
					{/if}
				</div>

				<!-- Quantity -->
				<div class="col-span-6 sm:col-span-3">
					<label class="mb-1 block text-xs font-bold text-foreground">จำนวน</label>
					<Input
						type="number"
						placeholder="0"
						min="0.01"
						step="any"
						bind:value={$formData.items[i].qty}
						class="h-10 rounded-xl"
					/>
					{#if $errors.items?.[i]?.qty}
						<p class="mt-1 text-xs font-medium text-destructive">{$errors.items[i].qty}</p>
					{/if}
				</div>

				<!-- Unit -->
				<div class="col-span-4 sm:col-span-2">
					<label class="mb-1 block text-xs font-bold text-foreground">หน่วย</label>
					<Input
						value={$formData.items[i].unit}
						readonly
						class="h-10 cursor-not-allowed rounded-xl bg-muted font-semibold text-muted-foreground"
					/>
				</div>

				<!-- Remove Button -->
				<div class="col-span-2 pb-1 sm:col-span-1">
					<button
						type="button"
						class="flex h-10 w-full items-center justify-center rounded-xl text-destructive transition hover:bg-destructive/10"
						onclick={() => removeItem(i)}
						disabled={$formData.items.length === 1}
					>
						<Trash2 class="h-4.5 w-4.5" />
					</button>
				</div>
			</div>
		{/each}
		{#if $errors.items?._errors}
			<p class="text-xs font-medium text-destructive">{$errors.items._errors}</p>
		{/if}
	</div>

	<!-- Notes -->
	<Form.Field {form} name="notes" class="col-span-1">
		<Form.Control>
			{#snippet children({ props })}
				<Form.Label class="text-xs font-bold text-foreground">หมายเหตุ (Optional)</Form.Label>
				<Input
					{...props}
					bind:value={$formData.notes}
					placeholder="ระบุชื่อผู้ขับรถ, ทะเบียนรถ หรือรายละเอียดเพิ่มเติม"
					class="h-10 w-full rounded-xl border border-border/80 bg-background px-3 text-sm shadow-sm"
				/>
			{/snippet}
		</Form.Control>
	</Form.Field>

	<!-- Submit Button -->
	<div class="pt-2">
		<Form.Button
			disabled={$submitting || $formData.items.length === 0}
			class="flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary text-sm font-extrabold text-primary-foreground shadow-md transition-all duration-300 hover:scale-[1.02] hover:bg-primary/95 hover:shadow-lg active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
		>
			{$submitting ? 'กำลังดำเนินการ...' : 'ยืนยันโอนย้ายพัสดุ (Dispatch)'}
		</Form.Button>
	</div>
</form>
