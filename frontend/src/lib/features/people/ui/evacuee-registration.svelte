<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Combobox } from '$lib/components/ui/combobox/index.js';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import {
		evacueeInputSchema,
		specialNeedSchema,
		SPECIAL_NEED_CHIPS,
		type EvacueeInput
	} from '../domain/people';
	import Camera from '@lucide/svelte/icons/camera';
	import { COUNTRIES } from '$lib/utils/country';

	const cardTypeOptions = [
		{ value: 'national_id', label: 'เลขประจำตัวประชาชน (Thai National ID)' },
		{ value: 'passport', label: 'หนังสือเดินทาง (Passport)' },
		{ value: 'pink_card', label: 'บัตรประจำตัวคนซึ่งไม่มีสัญชาติไทย (Pink Card)' },
		{ value: 'other', label: 'อื่นๆ (Other)' }
	];

	const genderOptions = [
		{ value: 'male', label: 'ชาย (Male)' },
		{ value: 'female', label: 'หญิง (Female)' },
		{ value: 'other', label: 'อื่นๆ (Other)' }
	];

	const religionOptions = [
		{ value: 'buddhist', label: 'พุทธ (Buddhism)' },
		{ value: 'muslim', label: 'อิสลาม (Islam)' },
		{ value: 'christian', label: 'คริสต์ (Christianity)' },
		{ value: 'other', label: 'อื่นๆ (Other)' },
		{ value: 'unknown', label: 'ไม่ระบุ (Unknown)' }
	];

	let {
		onsubmit,
		pending = false,
		onBack
	}: { onsubmit: (input: EvacueeInput) => void; pending?: boolean; onBack: () => void } = $props();

	let birthDateStr = $state('');
	let facePhotoUrl = $state<string | null>(null);
	let medicalConditionsStr = $state('');
	let medicalMedicationsStr = $state('');
	let medicalAllergiesStr = $state('');

	const form = superForm(defaults(zod4(evacueeInputSchema)), {
		SPA: true,
		dataType: 'json',
		validators: zod4(evacueeInputSchema),
		resetForm: false,
		onSubmit: ({ cancel }) => {
			if ($formData.person_id.cardType === 'national_id' && $formData.person_id.number) {
				const cleanId = $formData.person_id.number.replace(/\D/g, '');
				if (cleanId.length !== 13) {
					// @ts-ignore
					$errors.person_id = { number: ['เลขประจำตัวประชาชนต้องมี 13 หลัก'] };
					cancel();
					return;
				}
			}

			if ($formData.phone) {
				const cleanPhone = $formData.phone.replace(/\D/g, '');
				if (cleanPhone.length !== 10) {
					// @ts-ignore
					$errors.phone = ['เบอร์โทรศัพท์ต้องมี 10 หลัก'];
					cancel();
					return;
				}
			}

			if ($formData.emergency_contact) {
				const ec = $formData.emergency_contact;
				if (!ec.name?.trim() && !ec.phone?.trim()) {
					$formData.emergency_contact = undefined;
				} else if (ec.phone) {
					const cleanPhone = ec.phone.replace(/\D/g, '');
					if (cleanPhone.length !== 10) {
						// @ts-ignore
						if (!$errors.emergency_contact) $errors.emergency_contact = {};
						// @ts-ignore
						$errors.emergency_contact.phone = ['เบอร์ติดต่อฉุกเฉินต้องมี 10 หลัก'];
						cancel();
						return;
					}
				}
			}
		},
		onUpdate: async ({ form }) => {
			if (!form.valid) return;
			onsubmit(form.data);
		}
	});

	const { form: formData, errors, submitting, reset } = form;

	let age = $state('');

	$effect(() => {
		if (birthDateStr) {
			const birthDate = new Date(birthDateStr);
			$formData.birth_year = birthDate.getFullYear() + 543;
		} else if (age && !isNaN(Number(age))) {
			$formData.birth_year = new Date().getFullYear() + 543 - Number(age);
		} else {
			$formData.birth_year = undefined;
		}
	});

	$effect(() => {
		$formData.medical_conditions = medicalConditionsStr
			? medicalConditionsStr
					.split(',')
					.map((s) => s.trim())
					.filter(Boolean)
			: [];
	});

	$effect(() => {
		$formData.medical_medications = medicalMedicationsStr
			? medicalMedicationsStr
					.split(',')
					.map((s) => s.trim())
					.filter(Boolean)
			: [];
	});

	$effect(() => {
		$formData.medical_allergies = medicalAllergiesStr
			? medicalAllergiesStr
					.split(',')
					.map((s) => s.trim())
					.filter(Boolean)
			: [];
	});
</script>

<form method="POST" use:form.enhance class="space-y-6">
	<Field.FieldGroup>
		<div class="grid grid-cols-1 items-start gap-6 md:grid-cols-[200px_1fr]">
			<!-- Column 1: Face Photo mockup -->
			<div class="space-y-2">
				<p class="text-sm leading-none font-medium text-foreground">
					ภาพถ่ายใบหน้า (Face Recognition)
				</p>
				<input
					type="file"
					accept="image/*"
					class="hidden"
					id="face-photo-input"
					onchange={(e) => {
						const file = e.currentTarget.files?.[0];
						if (file) {
							facePhotoUrl = URL.createObjectURL(file);
						}
					}}
				/>
				<label
					for="face-photo-input"
					class="block cursor-pointer rounded-xl border border-dashed border-muted-foreground/30 bg-muted/20 p-4 text-center transition-all hover:border-primary/50 hover:bg-muted/30"
				>
					{#if facePhotoUrl}
						<img src={facePhotoUrl} alt="Face" class="h-40 w-full rounded-lg object-cover" />
					{:else}
						<div class="flex h-40 flex-col items-center justify-center">
							<Camera class="mb-2 h-10 w-10 text-muted-foreground" />
							<span class="text-xs text-muted-foreground">แตะเพื่อถ่ายภาพ</span>
						</div>
					{/if}
				</label>
			</div>

			<!-- Column 2: Fields grid -->
			<div class="space-y-4">
				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<div class="space-y-2">
						<Label>ประเภทบัตร</Label>
						<Select.Root type="single" bind:value={$formData.person_id.cardType}>
							<Select.Trigger
								class="flex !h-9 w-full items-start rounded-md border border-input bg-background px-3 !pt-1.5 text-sm font-medium shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 data-placeholder:text-muted-foreground [&_svg]:self-center [&_svg:not([class*='size-'])]:size-4"
							>
								{cardTypeOptions.find((o) => o.value === $formData.person_id.cardType)?.label ??
									'— เลือก —'}
							</Select.Trigger>
							<Select.Content>
								{#each cardTypeOptions as opt (opt.value)}
									<Select.Item value={opt.value} label={opt.label} />
								{/each}
							</Select.Content>
						</Select.Root>
					</div>

					<!-- เลขประจำตัวประชาชน / พาสปอร์ต / อื่นๆ -->
					<Form.Field {form} name="person_id.number">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>
									{#if $formData.person_id.cardType === 'national_id'}
										เลขประจำตัวประชาชน
									{:else if $formData.person_id.cardType === 'passport'}
										เลขที่พาสปอร์ต
									{:else if $formData.person_id.cardType === 'pink_card'}
										เลขประจำตัวคนซึ่งไม่มีสัญชาติไทย
									{:else}
										เลขหมายบัตร
									{/if}
								</Form.Label>
								<Input
									{...props}
									maxlength={$formData.person_id.cardType === 'national_id'
										? 13
										: $formData.person_id.cardType === 'passport'
											? 9
											: undefined}
									placeholder={$formData.person_id.cardType === 'national_id'
										? 'X-XXXX-XXXXX-XX-X'
										: $formData.person_id.cardType === 'passport'
											? 'Passport Number'
											: 'หมายเลขบัตร'}
									bind:value={$formData.person_id.number}
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>
				</div>

				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<!-- ชื่อ -->
					<Form.Field {form} name="first_name">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>ชื่อ (First Name)</Form.Label>
								<Input {...props} placeholder="ชื่อจริง" bind:value={$formData.first_name} />
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>

					<!-- นามสกุล -->
					<Form.Field {form} name="last_name">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>นามสกุล (Last Name)</Form.Label>
								<Input {...props} placeholder="นามสกุล" bind:value={$formData.last_name} />
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>

					<!-- ชื่อเล่น -->
					<Form.Field {form} name="nickname">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>ชื่อเล่น</Form.Label>
								<Input {...props} placeholder="ชื่อเล่น (ถ้ามี)" bind:value={$formData.nickname} />
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>
				</div>

				<div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
					<!-- วันเกิด -->
					<div class="space-y-2">
						<Label>วันเกิด</Label>
						<Input type="date" bind:value={birthDateStr} />
					</div>

					<!-- อายุ -->
					<div class="space-y-2">
						<Label>อายุ (ปี)</Label>
						<Input
							type="text"
							inputmode="numeric"
							maxlength={3}
							value={age}
							oninput={(e) => {
								const val = e.currentTarget.value.replace(/\D/g, '');
								e.currentTarget.value = val;
								age = val;
							}}
						/>
					</div>

					<Form.Field {form} name="gender">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>เพศ</Form.Label>
								<Select.Root type="single" bind:value={$formData.gender}>
									<Select.Trigger
										{...props}
										class="flex !h-9 w-full items-start rounded-md border border-input bg-background px-3 !pt-1.5 text-sm font-medium shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 data-placeholder:text-muted-foreground [&_svg]:self-center [&_svg:not([class*='size-'])]:size-4"
									>
										{genderOptions.find((o) => o.value === $formData.gender)?.label ?? '— เลือก —'}
									</Select.Trigger>
									<Select.Content>
										{#each genderOptions as opt (opt.value)}
											<Select.Item value={opt.value} label={opt.label} />
										{/each}
									</Select.Content>
								</Select.Root>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>

					<!-- เบอร์โทรศัพท์ -->
					<Form.Field {form} name="phone">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>เบอร์โทรศัพท์ยืนยันตัวตน</Form.Label>
								<Input
									{...props}
									inputmode="numeric"
									maxlength={10}
									placeholder="08X-XXX-XXXX"
									value={$formData.phone ?? ''}
									oninput={(e) => {
										const val = e.currentTarget.value.replace(/\D/g, '');
										e.currentTarget.value = val;
										$formData.phone = val === '' ? null : val;
									}}
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>
				</div>

				<div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
					<Form.Field {form} name="country">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>ประเทศ</Form.Label>
								<Combobox
									items={COUNTRIES}
									bind:value={$formData.country}
									placeholder="เลือกประเทศ..."
									searchPlaceholder="ค้นหาประเทศ..."
									emptyText="ไม่พบประเทศ"
									controlProps={props}
									class="h-9"
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>

					<Form.Field {form} name="religion">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>ศาสนา *</Form.Label>
								<Select.Root type="single" bind:value={$formData.religion}>
									<Select.Trigger
										{...props}
										class="flex !h-9 w-full items-start rounded-md border border-input bg-background px-3 !pt-1.5 text-sm font-medium shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 data-placeholder:text-muted-foreground [&_svg]:self-center [&_svg:not([class*='size-'])]:size-4"
									>
										{religionOptions.find((o) => o.value === $formData.religion)?.label ??
											'— เลือก —'}
									</Select.Trigger>
									<Select.Content>
										{#each religionOptions as opt (opt.value)}
											<Select.Item value={opt.value} label={opt.label} />
										{/each}
									</Select.Content>
								</Select.Root>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>
				</div>
			</div>
		</div>

		<!-- Medical fields section (โรคประจำตัว) -->
		<div class="w-full space-y-4 border-t border-border pt-6">
			<h3 class="flex items-center gap-2 text-sm font-semibold text-foreground">
				<span>🏥</span> โรคประจำตัว & ข้อมูลสุขภาพ
			</h3>
			<div class="grid grid-cols-1 gap-4">
				<div class="space-y-2">
					<Label>โรคประจำตัว</Label>
					<Input
						placeholder="เช่น เบาหวาน, ความดัน (ถ้าไม่มีให้เว้นว่าง)"
						bind:value={medicalConditionsStr}
					/>
				</div>
			</div>

			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<div class="space-y-2">
					<Label>ประวัติการแพ้ยา</Label>
					<Input
						placeholder="เช่น พาราเซตามอล (ถ้าไม่มีให้เว้นว่าง)"
						bind:value={medicalMedicationsStr}
					/>
				</div>

				<div class="space-y-2">
					<Label>ประวัติการแพ้อาหาร</Label>
					<Input
						placeholder="เช่น อาหารทะเล, ถั่ว (ถ้าไม่มีให้เว้นว่าง)"
						bind:value={medicalAllergiesStr}
					/>
				</div>
			</div>
		</div>

		<!-- Special Needs section -->
		<div class="w-full space-y-2 border-t border-border pt-6">
			<Label class="text-sm font-semibold">แท็กกลุ่มเปราะบางและความต้องการพิเศษ</Label>
			<div class="flex flex-wrap gap-2 pt-1">
				{#each specialNeedSchema.options as need (need)}
					{@const chip = SPECIAL_NEED_CHIPS[need]}
					{@const checked = ($formData.special_needs ?? []).includes(need)}
					<Button
						type="button"
						variant="outline"
						onclick={() => {
							const current = $formData.special_needs ?? [];
							$formData.special_needs = checked
								? current.filter((n) => n !== need)
								: [...current, need];
						}}
						class="inline-flex h-auto items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-normal transition-colors {checked
							? 'border-primary bg-primary/10 font-medium text-primary hover:bg-primary/15'
							: 'border-border bg-background text-muted-foreground hover:border-primary/50 hover:bg-primary/5'}"
					>
						<span>{chip.emoji}</span>
						<span>{chip.label}</span>
					</Button>
				{/each}
			</div>
			<Form.Field {form} name="special_needs"><Form.FieldErrors /></Form.Field>

			<div class="mt-8 mb-4 overflow-hidden rounded-xl border border-[#E2E8F0] bg-[#F8FAFC]">
				<div class="border-b border-[#E2E8F0] px-4 py-3 sm:px-6">
					<h3 class="flex items-center gap-2 text-base font-bold text-foreground">
						<span>🚨</span> ข้อมูลติดต่อฉุกเฉิน (Emergency Contact)
					</h3>
				</div>
				<div class="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 sm:p-6">
					<Form.Field {form} name="emergency_contact.name">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>ชื่อ-นามสกุล บุคคลติดต่อฉุกเฉิน</Form.Label>
								<Input
									{...props}
									placeholder="ชื่อนามสกุล ญาติ/ผู้ใกล้ชิด"
									value={$formData.emergency_contact?.name ?? ''}
									oninput={(e) => {
										if (!$formData.emergency_contact) {
											$formData.emergency_contact = {
												name: '',
												phone: '',
												relation: 'ญาติ/ผู้ใกล้ชิด'
											};
										}
										$formData.emergency_contact.name = e.currentTarget.value;
									}}
									class="bg-white"
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>

					<Form.Field {form} name="emergency_contact.phone">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>เบอร์ติดต่อฉุกเฉิน</Form.Label>
								<Input
									{...props}
									inputmode="numeric"
									maxlength={10}
									placeholder="08X-XXX-XXXX"
									value={$formData.emergency_contact?.phone ?? ''}
									class="bg-white"
									oninput={(e) => {
										const val = e.currentTarget.value.replace(/\D/g, '');
										e.currentTarget.value = val;
										if (!$formData.emergency_contact) {
											$formData.emergency_contact = {
												name: '',
												phone: '',
												relation: 'ญาติ/ผู้ใกล้ชิด'
											};
										}
										$formData.emergency_contact.phone = val;
									}}
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>
				</div>
			</div>

			<div class="pt-2">
				<Form.Field {form} name="medical_note">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>ความต้องการพิเศษ (ถ้ามี)</Form.Label>
							<textarea
								{...props}
								bind:value={$formData.medical_note}
								placeholder="เช่น ผู้ป่วยที่ต้องรับยาเฉพาะทาง หรือต้องการการดูแลพิเศษ"
								class="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
							></textarea>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>
			</div>
		</div>

		<!-- Back + Submit row -->
		<div class="flex w-full items-center gap-3 border-t border-border pt-6">
			<Button
				type="button"
				variant="outline"
				onclick={onBack}
				class="h-10 gap-1 px-6 py-2 text-sm font-medium"
			>
				ย้อนกลับ
			</Button>
		</div>
		<div class="flex items-center justify-end gap-3 pt-2">
			<Form.Button disabled={$submitting || pending}>Next ⏭️</Form.Button>
		</div>
	</Field.FieldGroup>
</form>
