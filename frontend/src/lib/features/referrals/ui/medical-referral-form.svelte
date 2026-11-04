<script lang="ts">
	/* eslint-disable @typescript-eslint/no-unused-vars */
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import * as Form from '$lib/components/ui/form/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import ReferralSubmitBar from './referral-submit-bar.svelte';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import Check from '@lucide/svelte/icons/check';
	import { medicalInputSchema, type ReferralInput } from '../domain/referral.schema';
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
		referral_type: 'medical-emergency' as const,
		evacuee_id: '',
		reason: '',
		urgency: 'normal' as const,
		to_org: {
			name: '',
			kind: 'hospital' as const,
			contact: ''
		},
		notes: ''
	};

	const form = superForm(defaults(initialData, zod4(medicalInputSchema)), {
		id: 'referral-create-medical',
		SPA: true,
		// Keep the typed values: the send confirm dialog can be cancelled, and the default reset-on-valid
		// would blank the form so it could not be submitted again.
		resetForm: false,
		dataType: 'json',
		validators: zod4(medicalInputSchema),
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

<!-- display: contents so the sticky submit bar spans the whole card, not just this form. -->
<form method="POST" use:enhance class="contents">
	<!-- Step 3: Target Destination -->
	<div class="space-y-4">
		<span class="text-sm font-semibold text-foreground">3. ข้อมูลปลายทางที่ส่งต่อ</span>
		<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
			<Form.Field {form} name="to_org.name">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label>ชื่อสถานพยาบาลปลายทาง <span class="text-red-600">*</span></Form.Label>
						<Input
							class="h-11 md:h-9"
							{...props}
							bind:value={$formData.to_org.name}
							placeholder="เช่น โรงพยาบาลมหาราช"
						/>
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>

			<Form.Field {form} name="to_org.contact">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label>ข้อมูลการติดต่อ / เบอร์โทรศัพท์</Form.Label>
						<Input
							class="h-11 md:h-9"
							{...props}
							bind:value={$formData.to_org.contact}
							placeholder="เช่น 053-123456"
						/>
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

		<div class="grid grid-cols-1 gap-4">
			<Form.Field {form} name="urgency">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label>ระดับความเร่งด่วน <span class="text-red-600">*</span></Form.Label>
						<div role="group" aria-label="ระดับความเร่งด่วน" class="mt-1 flex gap-2 md:max-w-md">
							<button
								type="button"
								aria-pressed={$formData.urgency === 'normal'}
								onclick={() => ($formData.urgency = 'normal')}
								class="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-center text-sm font-medium transition-all focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none md:min-h-0 md:whitespace-nowrap
								{$formData.urgency === 'normal'
									? 'border-primary bg-primary text-primary-foreground shadow-xs'
									: 'border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground'}"
							>
								<Check class="h-3.5 w-3.5" aria-hidden="true" />
								ปกติ (Normal)
							</button>
							<button
								type="button"
								aria-pressed={$formData.urgency === 'urgent'}
								onclick={() => ($formData.urgency = 'urgent')}
								class="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-center text-sm font-medium transition-all focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none md:min-h-0 md:whitespace-nowrap
								{$formData.urgency === 'urgent'
									? 'border-red-600 bg-red-600 text-white shadow-xs dark:border-red-700 dark:bg-red-700'
									: 'border-input bg-background text-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/20 dark:hover:text-red-400'}"
							>
								<AlertTriangle class="h-3.5 w-3.5" aria-hidden="true" />
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
					<Form.Label>เหตุผลการส่งต่อ / ความจำเป็น <span class="text-red-600">*</span></Form.Label>
					<Textarea
						{...props}
						bind:value={$formData.reason}
						placeholder="ระบุรายละเอียดเหตุผลความจำเป็นในการส่งต่อผู้เข้าพัก"
						rows={3}
						class="min-h-20"
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

	<ReferralSubmitBar {submitting} onIntent={(intent) => (submitIntent = intent)} />
</form>
