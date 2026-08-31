<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { z } from 'zod';
	import { getShelterCode } from '$lib/db/shelter';
	import { authStore } from '$lib/stores/auth.svelte';
	import { useCreateTransfer } from '../application/queries';
	import { toast } from 'svelte-sonner';
	import Truck from '@lucide/svelte/icons/truck';

	let { onsuccess }: { onsuccess?: () => void } = $props();

	const createMutation = useCreateTransfer();

	// Interim single-item form schema — the domain's `transferInputSchema` takes an `items[]`
	// array (split-lot allocation across multiple lots/items is out of scope this round; see
	// CR-059's "field ละเอียด" note). Mapped into a one-item TransferInput on submit.
	const transferFormSchema = z.object({
		to_shelter: z.string().trim().min(1, 'กรุณาระบุศูนย์ปลายทาง'),
		item_id: z.string().trim().min(1, 'กรุณาระบุรหัสสิ่งของ'),
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

	async function handleCreate(data: z.infer<typeof transferFormSchema>) {
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
				if (onsuccess) onsuccess();
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
	<div class="mb-2 flex items-center gap-2 border-b border-border/60 pb-3">
		<Truck class="h-4.5 w-4.5 text-primary" />
		<h3 class="text-sm font-bold text-foreground">
			สร้างคำร้องโอนย้ายข้ามศูนย์ (Inter-Shelter Transfer)
		</h3>
	</div>

	<Field.FieldGroup class="grid grid-cols-1 gap-4 sm:grid-cols-2">
		<Form.Field {form} name="to_shelter" class="col-span-1">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label class="text-xs font-bold text-foreground">ศูนย์ปลายทาง (รหัสศูนย์)</Form.Label
					>
					<Input
						{...props}
						placeholder="เช่น SH002"
						bind:value={$formData.to_shelter}
						class="h-10 w-full rounded-xl border border-border/80 bg-background px-3 text-sm font-semibold shadow-sm transition outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="item_id" class="col-span-1">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label class="text-xs font-bold text-foreground">รหัสสิ่งของ (Item ID)</Form.Label>
					<Input
						{...props}
						placeholder="เช่น item:rice"
						bind:value={$formData.item_id}
						class="h-10 w-full rounded-xl border border-border/80 bg-background px-3 text-sm font-semibold shadow-sm transition outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="qty" class="col-span-1">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label class="text-xs font-bold text-foreground">จำนวน</Form.Label>
					<Input
						{...props}
						type="number"
						min="0.01"
						step="any"
						placeholder="ระบุจำนวน"
						bind:value={$formData.qty}
						class="h-10 w-full rounded-xl border border-border/80 bg-background px-3 font-mono text-sm font-bold shadow-sm transition outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="unit" class="col-span-1">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label class="text-xs font-bold text-foreground">หน่วยนับ</Form.Label>
					<Input
						{...props}
						placeholder="เช่น kg, ชิ้น"
						bind:value={$formData.unit}
						class="h-10 w-full rounded-xl border border-border/80 bg-background px-3 text-sm font-semibold shadow-sm transition outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="notes" class="col-span-1 sm:col-span-2">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label class="text-xs font-bold text-foreground">หมายเหตุ (ถ้ามี)</Form.Label>
					<Input
						{...props}
						placeholder="รายละเอียดเพิ่มเติม"
						bind:value={$formData.notes}
						class="h-10 w-full rounded-xl border border-border/80 bg-background px-3 text-sm font-semibold shadow-sm transition outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<div class="col-span-1 pt-3 sm:col-span-2">
			<Form.Button
				disabled={$submitting}
				class="flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary text-sm font-extrabold text-primary-foreground shadow-md transition-all duration-300 hover:scale-[1.02] hover:bg-primary/95 hover:shadow-lg active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
			>
				{$submitting ? 'กำลังบันทึกรายการ...' : 'สร้างคำร้องโอนย้าย'}
			</Form.Button>
		</div>
	</Field.FieldGroup>
</form>
