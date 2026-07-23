<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { useQueryClient } from '@tanstack/svelte-query';
	import { toast } from 'svelte-sonner';

	import { referralInputSchema, type Referral } from '../domain/referral.schema';
	import { useCreateReferral } from '../application/queries';
	import RedactionBanner from './redaction-banner.svelte';
	import EvacueeSearchInput from './evacuee-search-input.svelte';

	let {
		onCreated,
		onSuccess
	}: {
		onCreated?: (referralId: string) => void;
		onSuccess?: (doc: Referral) => void;
	} = $props();

	const queryClient = useQueryClient();
	const createMutation = useCreateReferral(queryClient);

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
		to_shelter_code: '',
		notes: ''
	};

	const form = superForm(defaults(initialData, zod4(referralInputSchema)), {
		SPA: true,
		validators: zod4(referralInputSchema),
		onUpdate: async ({ form: f }) => {
			if (!f.valid) return;

			await toast.promise(createMutation.mutateAsync(f.data), {
				loading: 'กำลังบันทึกรายการส่งต่อ...',
				success: (doc) => {
					onCreated?.(doc._id);
					onSuccess?.(doc);
					return 'สร้างรายการส่งต่อผู้ประสบภัยเรียบร้อยแล้ว';
				},
				error: (err) => (err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการบันทึก')
			});
		}
	});

	const { form: formData, errors, enhance, submitting } = form;

	function setReferralType(type: 'capacity' | 'resource' | 'medical-emergency') {
		$formData.referral_type = type;

		if (type === 'capacity') {
			$formData.to_shelter_code = $formData.to_shelter_code || '';
			$formData.to_org = undefined;
		} else {
			$formData.to_shelter_code = undefined;
			if (!$formData.to_org) {
				$formData.to_org = {
					name: '',
					kind: type === 'medical-emergency' ? 'hospital' : 'social_services',
					contact: ''
				};
			} else {
				$formData.to_org.kind = type === 'medical-emergency' ? 'hospital' : 'social_services';
			}
		}
	}
</script>

<div class="space-y-6">
	<!-- Warning Banner when Hospital destination is chosen -->
	{#if $formData.referral_type === 'medical-emergency' || $formData.to_org?.kind === 'hospital'}
		<RedactionBanner />
	{/if}

	<Card.Root class="overflow-hidden border border-border/80 shadow-md">
		<Card.Header class="bg-muted/40 pb-4">
			<Card.Title class="text-xl font-bold"
				>สร้างรายการส่งต่อผู้ประสบภัย (New Referral Request)</Card.Title
			>
			<Card.Description
				>เลือกประเภทการส่งต่อและกรอกข้อมูลปลายทางให้ครบถ้วนก่อนส่งให้เจ้าหน้าที่</Card.Description
			>
		</Card.Header>
		<Card.Content class="p-6">
			<form method="POST" use:enhance class="space-y-6">
				<!-- Step 1: Select Referral Type -->
				<div class="space-y-3">
					<span class="text-sm font-semibold text-foreground"
						>1. เลือกประเภทการส่งต่อ (Referral Type) *</span
					>
					<div class="grid grid-cols-1 gap-3 md:grid-cols-3">
						<button
							type="button"
							onclick={() => setReferralType('medical-emergency')}
							class="flex cursor-pointer flex-col justify-between rounded-xl border-2 p-4 text-left transition-all
							{$formData.referral_type === 'medical-emergency'
								? 'border-red-500 bg-red-50/50 dark:bg-red-950/20'
								: 'border-border/60 hover:border-border'}"
						>
							<div>
								<div class="flex items-center justify-between">
									<span class="font-bold text-red-600 dark:text-red-400">ส่งต่อทางการแพทย์</span>
									<span class="text-xs font-semibold uppercase opacity-60">Medical</span>
								</div>
								<p class="mt-1 text-xs text-muted-foreground">
									ส่งตัวผู้ป่วย/ผู้บาดเจ็บไปยังโรงพยาบาลหรือคลินิก (จำกัดสิทธิ์ข้อมูล FR-48)
								</p>
							</div>
						</button>

						<button
							type="button"
							onclick={() => setReferralType('capacity')}
							class="flex cursor-pointer flex-col justify-between rounded-xl border-2 p-4 text-left transition-all
							{$formData.referral_type === 'capacity'
								? 'border-purple-500 bg-purple-50/50 dark:bg-purple-950/20'
								: 'border-border/60 hover:border-border'}"
						>
							<div>
								<div class="flex items-center justify-between">
									<span class="font-bold text-purple-600 dark:text-purple-400">ย้ายศูนย์พักพิง</span
									>
									<span class="text-xs font-semibold uppercase opacity-60">Capacity</span>
								</div>
								<p class="mt-1 text-xs text-muted-foreground">
									โอนย้ายผู้ประสบภัยไปยังศูนย์พักพิงอื่นเนื่องจากศูนย์เดิมเต็ม
								</p>
							</div>
						</button>

						<button
							type="button"
							onclick={() => setReferralType('resource')}
							class="flex cursor-pointer flex-col justify-between rounded-xl border-2 p-4 text-left transition-all
							{$formData.referral_type === 'resource'
								? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/20'
								: 'border-border/60 hover:border-border'}"
						>
							<div>
								<div class="flex items-center justify-between">
									<span class="font-bold text-blue-600 dark:text-blue-400">ขอสนับสนุนทรัพยากร</span>
									<span class="text-xs font-semibold uppercase opacity-60">Resource</span>
								</div>
								<p class="mt-1 text-xs text-muted-foreground">
									ขอสนับสนุนสิ่งของ ยา เครื่องอุปโภคบริโภค จากองค์กรภายนอก
								</p>
							</div>
						</button>
					</div>
				</div>

				<hr class="border-border/60" />

				<!-- Step 2: Evacuee Selection (Sub-component) -->
				<EvacueeSearchInput bind:value={$formData.evacuee_id} error={$errors.evacuee_id} />

				<hr class="border-border/60" />

				<!-- Step 3: Target Destination -->
				<div class="space-y-4">
					<span class="text-sm font-semibold text-foreground">3. ข้อมูลปลายทางที่ส่งต่อ</span>

					{#if $formData.referral_type === 'capacity'}
						<Form.Field {form} name="to_shelter_code">
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label>รหัสศูนย์พักพิงปลายทาง (Target Shelter Code) *</Form.Label>
									<Input
										{...props}
										bind:value={$formData.to_shelter_code}
										placeholder="เช่น SH002"
									/>
								{/snippet}
							</Form.Control>
							<Form.FieldErrors />
						</Form.Field>
					{:else}
						<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
							{#if $formData.to_org}
								<Form.Field {form} name="to_org.name">
									<Form.Control>
										{#snippet children({ props })}
											<Form.Label>ชื่อหน่วยงาน/สถานพยาบาล ปลายทาง *</Form.Label>
											<Input
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
												{...props}
												bind:value={$formData.to_org.contact}
												placeholder="เช่น 053-123456"
											/>
										{/snippet}
									</Form.Control>
									<Form.FieldErrors />
								</Form.Field>
							{/if}
						</div>
					{/if}
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
									<select
										{...props}
										bind:value={$formData.urgency}
										class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
									>
										<option value="normal">ปกติ (Normal)</option>
										<option value="urgent">เร่งด่วน (Urgent)</option>
									</select>
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

				<div class="flex items-center justify-end gap-3 border-t border-border/60 pt-4">
					<Button
						type="submit"
						disabled={$submitting}
						class="w-32 bg-primary text-primary-foreground hover:bg-primary/95"
					>
						บันทึกร่าง
					</Button>
				</div>
			</form>
		</Card.Content>
	</Card.Root>
</div>
