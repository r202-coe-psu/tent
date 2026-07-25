<script lang="ts">
	/* eslint-disable @typescript-eslint/no-unused-vars */
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import * as Form from '$lib/components/ui/form/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { resourceInputSchema, type ReferralInput } from '../domain/referral.schema';
	import type { ReferralSubmitIntent } from '../data/referral.repository';

	let {
		evacueeId,
		onSubmit,
		submitting = false
	}: {
		evacueeId: string;
		onSubmit: (data: ReferralInput, intent: ReferralSubmitIntent) => void;
		submitting?: boolean;
	} = $props();

	let submitIntent = $state<ReferralSubmitIntent>('draft');

	const initialData = {
		referral_type: 'resource' as const,
		evacuee_id: '',
		reason: '',
		urgency: 'normal' as const,
		to_org: {
			name: '',
			kind: 'social_services' as const,
			contact: ''
		},
		notes: ''
	};

	const form = superForm(defaults(initialData, zod4(resourceInputSchema)), {
		id: 'referral-create-resource',
		SPA: true,
		dataType: 'json',
		validators: zod4(resourceInputSchema),
		onUpdate: ({ form: f }) => {
			if (f.valid) {
				onSubmit(f.data, submitIntent);
			}
		}
	});

	const { form: formData, enhance } = form;

	$effect(() => {
		$formData.evacuee_id = evacueeId;
	});
</script>

<form method="POST" use:enhance class="space-y-6">
	<!-- Step 3: Target Destination -->
	<div class="space-y-4">
		<span class="text-sm font-semibold text-foreground">3. ข้อมูลปลายทางที่ส่งต่อ</span>
		<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
			<Form.Field {form} name="to_org.name">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label>ชื่อหน่วยงานปลายทาง *</Form.Label>
						<Input
							{...props}
							bind:value={$formData.to_org.name}
							placeholder="เช่น สำนักงานบรรเทาทุกข์"
						/>
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>

			<Form.Field {form} name="to_org.contact">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label>ข้อมูลการติดต่อ / เบอร์โทรศัพท์</Form.Label>
						<Input {...props} bind:value={$formData.to_org.contact} placeholder="เช่น 053-123456" />
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>
		</div>
	</div>

	<hr class="border-border/60" />

	<!-- Step 4: Referral Details -->
	<div class="space-y-4">
		<span class="text-sm font-semibold text-foreground">4. รายละเอียดความจำเป็น</span>

		<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
			<Form.Field {form} name="urgency">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label>ระดับความเร่งด่วน *</Form.Label>
						<div class="mt-1 flex gap-2">
							<button
								type="button"
								onclick={() => ($formData.urgency = 'normal')}
								class="flex-1 cursor-pointer rounded-md border px-3 py-2 text-center text-sm font-medium transition-all
								{$formData.urgency === 'normal'
									? 'border-primary bg-primary text-primary-foreground shadow-xs'
									: 'border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground'}"
							>
								ปกติ (Normal)
							</button>
							<button
								type="button"
								onclick={() => ($formData.urgency = 'urgent')}
								class="flex-1 cursor-pointer rounded-md border px-3 py-2 text-center text-sm font-medium transition-all
								{$formData.urgency === 'urgent'
									? 'border-red-600 bg-red-600 text-white shadow-xs dark:border-red-700 dark:bg-red-700'
									: 'border-input bg-background text-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/20 dark:hover:text-red-400'}"
							>
								เร่งด่วน (Urgent)
							</button>
						</div>
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>
		</div>

		<Form.Field {form} name="reason">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>เหตุผลการส่งต่อ / ความจำเป็น *</Form.Label>
					<Textarea
						{...props}
						bind:value={$formData.reason}
						placeholder="ระบุรายละเอียดเหตุผลความจำเป็นในการส่งต่อผู้ประสบภัย"
						rows={3}
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="notes">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>บันทึกข้อความเพิ่มเติม / หมายเหตุ</Form.Label>
					<Textarea
						{...props}
						bind:value={$formData.notes}
						placeholder="ระบุข้อมูลเพิ่มเติม (ถ้ามี)"
						rows={2}
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>
	</div>

	<div class="flex flex-wrap items-center justify-end gap-3 border-t border-border/60 pt-4">
		<Button
			type="submit"
			variant="outline"
			disabled={submitting}
			class="min-w-28"
			onclick={() => (submitIntent = 'draft')}
		>
			บันทึกร่าง
		</Button>
		<Button
			type="submit"
			disabled={submitting}
			class="min-w-28 bg-primary text-primary-foreground hover:bg-primary/95"
			onclick={() => (submitIntent = 'send')}
		>
			ส่งข้อมูล
		</Button>
	</div>
</form>
