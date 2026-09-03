<script lang="ts">
	import Megaphone from '@lucide/svelte/icons/megaphone';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { specialRequestSchema, type SpecialRequestInput } from '$lib/features/operations';

	let {
		open = false,
		onclose,
		onsubmit
	}: {
		open: boolean;
		onclose: () => void;
		onsubmit: (input: SpecialRequestInput) => void;
	} = $props();

	const form = superForm(
		defaults(
			{
				name: '',
				target: '1000',
				location: 'คลังช่วยเหลือภัยพิบัติ EOC'
			},
			zod4(specialRequestSchema)
		),
		{
			SPA: true,
			validators: zod4(specialRequestSchema),
			resetForm: true,
			onUpdate: ({ form: f }) => {
				if (!f.valid) return;
				onsubmit(f.data);
				onclose();
				reset();
			}
		}
	);

	const { form: formData, submitting, enhance, reset } = form;

	const WAREHOUSE_OPTIONS = [
		{ value: 'คลังช่วยเหลือภัยพิบัติ EOC', label: 'คลัง EOC' },
		{ value: 'คลังย่อยโรงเรียนเทศบาล 2', label: 'คลังโรงเรียนเทศบาล 2' },
		{ value: 'คลังกลางเทศบาล', label: 'คลังกลางเทศบาล' }
	];
	const warehouseLabel = $derived(
		WAREHOUSE_OPTIONS.find((o) => o.value === $formData.location)?.label ?? 'เลือกคลังเป้าหมาย'
	);
</script>

<Dialog.Root {open} onOpenChange={(next) => !next && onclose()}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2 text-sm font-bold">
				<Megaphone class="h-4 w-4 text-primary" />
				สร้างประกาศความต้องการใหม่
			</Dialog.Title>
		</Dialog.Header>

		<form use:enhance class="space-y-4">
			<Form.Field {form} name="name">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label class="mb-1.5 block text-2xs font-bold text-muted-foreground uppercase">
							รายการพัสดุ / ประกาศพิเศษ
						</Form.Label>
						<Input
							{...props}
							type="text"
							placeholder="เช่น ยาสามัญประจำบ้าน, แพมเพิสเด็กแรกเกิด"
							bind:value={$formData.name}
							class="w-full rounded-xl text-xs"
						/>
					{/snippet}
				</Form.Control>
				<Form.FieldErrors class="mt-1 text-xs text-destructive" />
			</Form.Field>

			<div class="grid grid-cols-2 gap-4">
				<Form.Field {form} name="target">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label class="mb-1.5 block text-2xs font-bold text-muted-foreground uppercase">
								เป้าหมายจำนวนที่ต้องการ
							</Form.Label>
							<Input
								{...props}
								type="text"
								inputmode="decimal"
								bind:value={$formData.target}
								class="w-full rounded-xl text-xs"
							/>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors class="mt-1 text-xs text-destructive" />
				</Form.Field>

				<Form.Field {form} name="location">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label class="mb-1.5 block text-2xs font-bold text-muted-foreground uppercase">
								คลังเป้าหมาย
							</Form.Label>
							<Select.Root type="single" bind:value={$formData.location}>
								<Select.Trigger
									{...props}
									class="h-9 w-full rounded-xl text-xs data-[size=default]:h-9"
								>
									{warehouseLabel}
								</Select.Trigger>
								<Select.Content>
									{#each WAREHOUSE_OPTIONS as option (option.value)}
										<Select.Item value={option.value} label={option.label} />
									{/each}
								</Select.Content>
							</Select.Root>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors class="mt-1 text-xs text-destructive" />
				</Form.Field>
			</div>

			<Dialog.Footer class="gap-2.5 border-t border-border/60 pt-4">
				<Button
					variant="outline"
					type="button"
					onclick={onclose}
					class="h-10 rounded-xl px-4 text-xs font-bold"
				>
					ยกเลิก
				</Button>
				<Button type="submit" disabled={$submitting} class="h-10 rounded-xl px-5 text-xs font-bold">
					เพิ่มความต้องการ
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
