<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { SearchSelect } from '$lib/components/ui/search-select/index.js';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import {
		householdPreRegisterEvacueeSchema,
		specialNeedSchema,
		SPECIAL_NEED_CHIPS,
		type EvacueeInput
	} from '../domain/people';
	import { COUNTRIES } from '$lib/utils/country';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Camera from '@lucide/svelte/icons/camera';

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
		initialData = null,
		onNext
	}: {
		initialData?: Partial<EvacueeInput> | null;
		onNext: (data: EvacueeInput) => void;
	} = $props();

	let facePhotoUrl = $state<string | null>(null);
	let noPhone = $state(false);
	let birthYearBE = $state('');
	let age = $state('');
	let medicalConditionsStr = $state('');
	let medicalMedicationsStr = $state('');
	let medicalAllergiesStr = $state('');

	const form = superForm(defaults(zod4(householdPreRegisterEvacueeSchema)), {
		SPA: true,
		dataType: 'json',
		validators: zod4(householdPreRegisterEvacueeSchema),
		resetForm: false,
		onSubmit: ({ cancel }) => {
			if (noPhone) {
				$formData.phone = null;
			} else {
				const cleanPhone = ($formData.phone ?? '').replace(/\D/g, '');
				if (cleanPhone.length !== 10) {
					$errors.phone = ['กรุณากรอกเบอร์โทรศัพท์ 10 หลัก หรือเลือก "ไม่มีเบอร์โทร"'];
					toast.error('กรุณากรอกเบอร์โทรศัพท์ 10 หลัก หรือเลือก "ไม่มีเบอร์โทร"');
					cancel();
					return;
				}
			}
		},
		onUpdate: async ({ form }) => {
			if (!form.valid) {
				toast.error('กรุณากรอกข้อมูลให้ถูกต้องและครบถ้วน');
				return;
			}
			onNext(form.data);
		}
	});

	const { form: formData, errors, submitting } = form;

	let initialized = $state(false);
	$effect(() => {
		if (initialized || !initialData) return;
		initialized = true;
		$formData = {
			...$formData,
			...initialData,
			birth_year: typeof initialData.birth_year === 'number' ? initialData.birth_year : undefined,
			person_id: {
				cardType: initialData.person_id?.cardType ?? 'national_id',
				number: initialData.person_id?.number ?? ''
			}
		};
		noPhone = !initialData.phone;
		birthYearBE = String(initialData.birth_year ?? '');
		medicalConditionsStr = (initialData.medical_conditions ?? []).join(', ');
		medicalMedicationsStr = (initialData.medical_medications ?? []).join(', ');
		medicalAllergiesStr = (initialData.medical_allergies ?? []).join(', ');
	});

	$effect(() => {
		if (birthYearBE && !isNaN(Number(birthYearBE))) {
			$formData.birth_year = Number(birthYearBE);
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

<form method="POST" use:form.enhance class="mx-auto w-full max-w-5xl space-y-6">
	<Field.FieldGroup>
		<div class="rounded-2xl border border-border bg-card p-6 shadow-sm">
			<div class="mb-6 border-b pb-4">
				<h3 class="text-base font-bold text-slate-800 dark:text-slate-200">
					ข้อมูลหัวหน้าครัวเรือน
				</h3>
			</div>

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
							<Label>ประเภทบัตร <span class="text-destructive">*</span></Label>
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
						<Form.Field {form} name="person_id.number">
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label>
										{#if $formData.person_id.cardType === 'national_id'}
											เลขประจำตัวประชาชน <span class="text-destructive">*</span>
										{:else if $formData.person_id.cardType === 'passport'}
											เลขที่พาสปอร์ต <span class="text-destructive">*</span>
										{:else if $formData.person_id.cardType === 'pink_card'}
											เลขประจำตัวคนซึ่งไม่มีสัญชาติไทย <span class="text-destructive">*</span>
										{:else}
											เลขหมายบัตร <span class="text-destructive">*</span>
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
						<Form.Field {form} name="first_name">
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label>ชื่อ (First Name) <span class="text-destructive">*</span></Form.Label>
									<Input {...props} placeholder="ชื่อจริง" bind:value={$formData.first_name} />
								{/snippet}
							</Form.Control>
							<Form.FieldErrors />
						</Form.Field>
						<Form.Field {form} name="last_name">
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label
										>นามสกุล (Last Name) <span class="text-destructive">*</span></Form.Label
									>
									<Input {...props} placeholder="นามสกุล" bind:value={$formData.last_name} />
								{/snippet}
							</Form.Control>
							<Form.FieldErrors />
						</Form.Field>
					</div>

					<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<Form.Field {form} name="nickname">
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label>ชื่อเล่น</Form.Label>
									<Input
										{...props}
										placeholder="ชื่อเล่น (ถ้ามี)"
										bind:value={$formData.nickname}
									/>
								{/snippet}
							</Form.Control>
							<Form.FieldErrors />
						</Form.Field>
					</div>

					<div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
						<div class="space-y-2">
							<Label>ปีเกิด (พ.ศ.)</Label>
							<Input placeholder="เช่น 2530" bind:value={birthYearBE} />
						</div>
						<div class="space-y-2">
							<Label>อายุ (ปี)</Label>
							<Input
								placeholder="อายุ"
								value={age}
								inputmode="numeric"
								maxlength={3}
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
									<Form.Label>เพศ <span class="text-destructive">*</span></Form.Label>
									<Select.Root type="single" bind:value={$formData.gender}>
										<Select.Trigger
											{...props}
											class="flex !h-9 w-full items-start rounded-md border border-input bg-background px-3 !pt-1.5 text-sm font-medium shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 data-placeholder:text-muted-foreground [&_svg]:self-center [&_svg:not([class*='size-'])]:size-4"
										>
											{genderOptions.find((o) => o.value === $formData.gender)?.label ??
												'— เลือก —'}
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
						<Form.Field {form} name="phone">
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label
										>เบอร์โทรศัพท์ยืนยันตัวตน <span class="text-destructive">*</span></Form.Label
									>
									<Input
										{...props}
										inputmode="numeric"
										maxlength={10}
										placeholder="08X-XXX-XXXX"
										disabled={noPhone}
										value={noPhone ? '' : ($formData.phone ?? '')}
										oninput={(e) => {
											const val = e.currentTarget.value.replace(/\D/g, '');
											e.currentTarget.value = val;
											$formData.phone = val === '' ? null : val;
										}}
									/>
									<label class="mt-1.5 flex cursor-pointer items-center gap-2 text-xs">
										<Checkbox
											checked={noPhone}
											onCheckedChange={(v) => {
												noPhone = !!v;
												if (noPhone) {
													$formData.phone = null;
													$errors.phone = undefined;
												}
											}}
										/>
										<span class="text-muted-foreground">ไม่มีเบอร์โทร</span>
									</label>
								{/snippet}
							</Form.Control>
							<Form.FieldErrors />
						</Form.Field>
					</div>

					<div class="grid grid-cols-2 gap-4">
						<Form.Field {form} name="country">
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label>ประเทศ <span class="text-destructive">*</span></Form.Label>
									<SearchSelect
										items={COUNTRIES}
										bind:value={$formData.country}
										placeholder="ค้นหาประเทศ..."
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
									<Form.Label>ศาสนา <span class="text-destructive">*</span></Form.Label>
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

			<!-- Special Needs Chips -->
			<div class="mt-6 space-y-2 border-t pt-4">
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
							class="inline-flex h-auto items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-normal transition-colors
							{checked
								? 'border-primary bg-primary/10 font-medium text-primary hover:bg-primary/15'
								: 'border-border bg-background text-muted-foreground hover:border-primary/50 hover:bg-primary/5'}"
						>
							<span>{chip.emoji}</span>
							<span>{chip.label}</span>
						</Button>
					{/each}
				</div>
			</div>

			<!-- Emergency Contact -->
			<div class="mt-6 space-y-4 rounded-xl border border-border bg-slate-50/50 p-4">
				<h4
					class="flex items-center gap-1.5 text-xs font-bold tracking-wider text-slate-500 uppercase"
				>
					<ShieldAlert class="size-4 text-amber-500" />
					ข้อมูลผู้ติดต่อฉุกเฉิน
				</h4>
				<div class="grid grid-cols-2 gap-4">
					<Form.Field {form} name="emergency_contact.name">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label
									>ชื่อ-นามสกุล บุคคลติดต่อฉุกเฉิน <span class="text-destructive">*</span
									></Form.Label
								>
								<Input
									{...props}
									placeholder="ชื่อนามสกุล ญาติ/ผู้ใกล้ชิด"
									value={$formData.emergency_contact?.name ?? ''}
									oninput={(e) => {
										if (!$formData.emergency_contact) {
											$formData.emergency_contact = { name: '', phone: '', relation: 'contact' };
										}
										$formData.emergency_contact.name = e.currentTarget.value;
									}}
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>
					<Form.Field {form} name="emergency_contact.phone">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>เบอร์ติดต่อฉุกเฉิน <span class="text-destructive">*</span></Form.Label>
								<Input
									{...props}
									inputmode="numeric"
									maxlength={10}
									placeholder="08X-XXX-XXXX"
									value={$formData.emergency_contact?.phone ?? ''}
									oninput={(e) => {
										const val = e.currentTarget.value.replace(/\D/g, '');
										e.currentTarget.value = val;
										if (!$formData.emergency_contact) {
											$formData.emergency_contact = { name: '', phone: '', relation: 'contact' };
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

			<!-- Medical Info -->
			<div class="mt-6 space-y-3 border-t pt-4">
				<Label class="text-sm font-semibold">🏥 โรคประจำตัว & ข้อมูลสุขภาพ</Label>
				<div class="space-y-2">
					<Label class="text-xs text-muted-foreground">โรคประจำตัว</Label>
					<Input
						placeholder="เช่น เบาหวาน, ความดัน (ถ้าไม่มีให้เว้นว่าง)"
						bind:value={medicalConditionsStr}
					/>
				</div>
				<div class="space-y-2">
					<Label class="text-xs text-muted-foreground">ยาที่ใช้ประจำ</Label>
					<Input
						placeholder="เช่น ยาลดความดัน, ยาเบาหวาน (ถ้าไม่มีให้เว้นว่าง)"
						bind:value={medicalMedicationsStr}
					/>
				</div>
				<div class="space-y-2">
					<Label class="text-xs text-muted-foreground">ประวัติการแพ้ (ยา/อาหาร)</Label>
					<Input
						placeholder="เช่น แพ้เพนิซิลลิน, อาหารทะเล, ถั่ว (ถ้าไม่มีให้เว้นว่าง)"
						bind:value={medicalAllergiesStr}
					/>
				</div>
				<Form.Field {form} name="medical_note">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label class="text-xs text-muted-foreground">ความต้องการพิเศษ (ถ้ามี)</Form.Label
							>
							<textarea
								{...props}
								bind:value={$formData.medical_note}
								placeholder="เช่น ผู้ป่วยที่ต้องรับยาเฉพาะทาง หรือต้องการการดูแลพิเศษ"
								class="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
							></textarea>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>
			</div>
		</div>

		<!-- Navigation -->
		<div class="mt-8 flex justify-end border-t border-border pt-4">
			<Form.Button
				disabled={$submitting}
				class="h-11 bg-[#0d2240] px-8 font-semibold text-white hover:bg-[#1a3a5c]"
			>
				ถัดไป (ข้อมูลที่อยู่ครัวเรือน) →
			</Form.Button>
		</div>
	</Field.FieldGroup>
</form>
