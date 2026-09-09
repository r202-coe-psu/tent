<script lang="ts">
	import { onDestroy } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import SearchSelect from '$lib/components/search-select.svelte';
	import * as Select from '$lib/components/ui/select/index.js';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import {
		householdPreRegisterEvacueeSchema,
		currentBEYear,
		minBirthYearBE,
		MAX_AGE_YEARS,
		cardNumberMaxLength,
		type EvacueeInput
	} from '../domain/people';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { useSaveImage } from '$lib/features/images';
	import { z } from 'zod';

	const vulnerableGroupSchema = z.enum([
		'bedridden',
		'dialysis',
		'wheelchair',
		'psychiatric',
		'elderly_dependent',
		'infant',
		'young_child',
		'pregnant',
		'vision_impaired',
		'hearing_impaired',
		'disability_other',
		'chronic_illness'
	]);

	const VULNERABLE_GROUP_CHIPS: Record<string, { emoji: string; label: string }> = {
		bedridden: { emoji: '🛏️', label: 'ติดเตียง' },
		dialysis: { emoji: '🩺', label: 'ฟอกไต' },
		wheelchair: { emoji: '♿', label: 'วีลแชร์' },
		psychiatric: { emoji: '🧠', label: 'จิตเวช' },
		elderly_dependent: { emoji: '👴', label: 'ผู้สูงอายุพึ่งพิง' },
		infant: { emoji: '👶', label: 'ทารก' },
		young_child: { emoji: '🧒', label: 'เด็กเล็ก' },
		pregnant: { emoji: '🤰', label: 'ครรภ์' },
		vision_impaired: { emoji: '👁️', label: 'สายตา' },
		hearing_impaired: { emoji: '👂', label: 'การได้ยิน' },
		disability_other: { emoji: '♿', label: 'พิการอื่นๆ' },
		chronic_illness: { emoji: '💊', label: 'โรคเรื้อรัง' }
	};
	import { COUNTRIES } from '$lib/utils/country';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Camera from '@lucide/svelte/icons/camera';
	import Loader2 from '@lucide/svelte/icons/loader-2';

	const cardTypeOptions = [
		{ value: 'national_id', label: 'เลขประจำตัวประชาชน (Thai National ID)' },
		{ value: 'passport', label: 'หนังสือเดินทาง (Passport)' },
		{ value: 'pink_card', label: 'บัตรประจำตัวคนซึ่งไม่มีสัญชาติไทย (Pink Card)' },
		{ value: 'other', label: 'อื่นๆ (Other)' },
		{ value: 'anonymous', label: 'บัตรไม่ระบุตัวตน (Anonymous ID)' }
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
	let uploadingPhoto = $state(false);
	const saveImage = useSaveImage();
	let noPhone = $state(false);

	onDestroy(() => {
		if (facePhotoUrl) URL.revokeObjectURL(facePhotoUrl);
	});
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
			if (birthYearError || ageError) {
				const message = birthYearError || ageError || '';
				toast.error(message);
				cancel();
				return;
			}

			if (
				$formData.person_id?.cardType === 'national_id' &&
				($formData.person_id?.number ?? '').replace(/\D/g, '').length !== 13
			) {
				$errors.person_id = {
					...$errors.person_id,
					number: ['เลขประจำตัวประชาชนต้องมี 13 หลัก']
				};
				toast.error('เลขประจำตัวประชาชนต้องมี 13 หลัก');
				cancel();
				return;
			}

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
			},
			emergency_contact: initialData.emergency_contact
				? {
						name: initialData.emergency_contact.name ?? '',
						phone: initialData.emergency_contact.phone ?? '',
						relation: initialData.emergency_contact.relation ?? 'contact'
					}
				: $formData.emergency_contact
		};
		noPhone = !initialData.phone;
		if (typeof initialData.birth_year === 'number') {
			birthYearBE = String(initialData.birth_year);
			if (typeof initialData.age === 'number') {
				age = String(initialData.age);
			} else {
				age = String(Math.max(0, currentBEYear() - initialData.birth_year));
			}
		} else if (typeof initialData.age === 'number') {
			age = String(initialData.age);
			birthYearBE = String(currentBEYear() - initialData.age);
		} else {
			birthYearBE = '';
			age = '';
		}
		medicalConditionsStr = (initialData.medical_conditions ?? []).join(', ');
		medicalMedicationsStr = (initialData.medical_medications ?? []).join(', ');
		medicalAllergiesStr = (initialData.medical_allergies ?? []).join(', ');
	});

	function updateBirthYear(value: string) {
		birthYearBE = value;
		if (value && !isNaN(Number(value))) {
			const y = Number(value);
			$formData.birth_year = y;
			if (y > minBirthYearBE() && y <= currentBEYear()) {
				const calcAge = currentBEYear() - y;
				age = calcAge.toString();
				$formData.age = calcAge;
			}
		} else {
			$formData.birth_year = undefined;
			if (!value) {
				age = '';
				$formData.age = undefined;
			}
		}
	}

	function updateAge(value: string) {
		age = value;
		if (value && !isNaN(Number(value))) {
			const a = Number(value);
			$formData.age = a;
			if (a >= 0 && a <= MAX_AGE_YEARS) {
				const calcBE = currentBEYear() - a;
				birthYearBE = calcBE.toString();
				$formData.birth_year = calcBE;
			}
		} else {
			$formData.age = undefined;
			if (!value) {
				birthYearBE = '';
				$formData.birth_year = undefined;
			}
		}
	}

	const birthYearError = $derived.by(() => {
		if (!birthYearBE) return undefined;
		const y = Number(birthYearBE);
		if (isNaN(y)) return 'กรุณากรอกปีเกิดเป็นตัวเลข';
		if (y > currentBEYear()) return 'ปีเกิด (พ.ศ.) ต้องไม่เป็นปีในอนาคต';
		if (y <= minBirthYearBE()) return `ปีเกิด (พ.ศ.) ต้องมากกว่า ${minBirthYearBE()}`;
		return undefined;
	});

	const ageError = $derived.by(() => {
		if (!age) return undefined;
		const a = Number(age);
		if (isNaN(a)) return 'กรุณากรอกอายุเป็นตัวเลข';
		if (a > MAX_AGE_YEARS) return `อายุต้องไม่เกิน ${MAX_AGE_YEARS} ปี`;
		return undefined;
	});

	function updateMedicalField(
		field: 'medical_conditions' | 'medical_medications' | 'medical_allergies',
		value: string
	) {
		const values = value
			.split(',')
			.map((item) => item.trim())
			.filter(Boolean);
		if (field === 'medical_conditions') medicalConditionsStr = value;
		if (field === 'medical_medications') medicalMedicationsStr = value;
		if (field === 'medical_allergies') medicalAllergiesStr = value;
		$formData[field] = values;
	}
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
						disabled={uploadingPhoto}
						onchange={async (e) => {
							const file = e.currentTarget.files?.[0];
							if (!file) return;

							if (facePhotoUrl) URL.revokeObjectURL(facePhotoUrl);
							facePhotoUrl = URL.createObjectURL(file);
							uploadingPhoto = true;
							try {
								const ctx = {
									shelterCode: getShelterCode(),
									createdBy: authStore.user?.name ?? 'unknown'
								};
								const image = await saveImage.mutateAsync({ file, ctx });
								$formData.photo = image._id;
							} catch {
								$formData.photo = null;
								toast.error('อัปโหลดรูปภาพล้มเหลว สามารถลงทะเบียนต่อได้โดยไม่มีรูป');
							} finally {
								uploadingPhoto = false;
							}
						}}
					/>
					<label
						for="face-photo-input"
						class="block cursor-pointer rounded-xl border border-dashed border-muted-foreground/30 bg-muted/20 p-4 text-center transition-all hover:border-primary/50 hover:bg-muted/30"
					>
						{#if facePhotoUrl}
							<div class="relative h-40 w-full">
								<img
									src={facePhotoUrl}
									alt="Face"
									class="h-40 w-full rounded-lg object-cover {uploadingPhoto ? 'opacity-50' : ''}"
								/>
								{#if uploadingPhoto}
									<div class="absolute inset-0 flex items-center justify-center">
										<Loader2 class="h-8 w-8 animate-spin text-primary" />
									</div>
								{/if}
							</div>
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
								<Select.Trigger class="h-9 w-full"
									>{cardTypeOptions.find((o) => o.value === $formData.person_id.cardType)?.label ??
										'— เลือก —'}</Select.Trigger
								>
								<Select.Content
									>{#each cardTypeOptions as opt (opt.value)}<Select.Item
											value={opt.value}
											label={opt.label}
										/>{/each}</Select.Content
								>
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
										{:else if $formData.person_id.cardType === 'anonymous'}
											หมายเลข Anonymous ID
										{:else}
											เลขหมายบัตร <span class="text-destructive">*</span>
										{/if}
									</Form.Label>
									{#if $formData.person_id.cardType === 'anonymous'}
										<p
											class="flex h-9 items-center rounded-md border border-dashed border-border bg-muted/40 px-3 text-xs text-muted-foreground"
										>
											ระบบจะออกหมายเลข ANON-… เมื่อบันทึก
										</p>
									{:else}
										<Input
											{...props}
											maxlength={cardNumberMaxLength($formData.person_id.cardType)}
											placeholder={$formData.person_id.cardType === 'national_id'
												? 'X-XXXX-XXXXX-XX-X'
												: $formData.person_id.cardType === 'passport'
													? 'Passport Number'
													: 'หมายเลขบัตร'}
											bind:value={$formData.person_id.number}
										/>
									{/if}
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
									<Form.Label>นามสกุล (Last Name)</Form.Label>
									<Input
										{...props}
										placeholder="เว้นว่างได้ถ้าไม่มีนามสกุล"
										bind:value={$formData.last_name}
									/>
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
							<Input
								placeholder="เช่น 2530"
								inputmode="numeric"
								maxlength={4}
								value={birthYearBE}
								aria-invalid={birthYearError ? 'true' : undefined}
								oninput={(event) => {
									const val = event.currentTarget.value.replace(/\D/g, '').slice(0, 4);
									event.currentTarget.value = val;
									updateBirthYear(val);
								}}
							/>
							{#if birthYearError}
								<p class="text-sm font-medium text-destructive">{birthYearError}</p>
							{/if}
						</div>
						<div class="space-y-2">
							<Label>อายุ (ปี)</Label>
							<Input
								placeholder="อายุ"
								value={age}
								inputmode="numeric"
								maxlength={3}
								aria-invalid={ageError ? 'true' : undefined}
								oninput={(e) => {
									const val = e.currentTarget.value.replace(/\D/g, '');
									e.currentTarget.value = val;
									updateAge(val);
								}}
							/>
							{#if ageError}
								<p class="text-sm font-medium text-destructive">{ageError}</p>
							{/if}
						</div>
						<Form.Field {form} name="gender">
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label>เพศ <span class="text-destructive">*</span></Form.Label>
									<Select.Root type="single" bind:value={$formData.gender}
										><Select.Trigger {...props} class="h-9 w-full"
											>{genderOptions.find((o) => o.value === $formData.gender)?.label ??
												'— เลือก —'}</Select.Trigger
										><Select.Content
											>{#each genderOptions as opt (opt.value)}<Select.Item
													value={opt.value}
													label={opt.label}
												/>{/each}</Select.Content
										></Select.Root
									>
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
										name={props.name}
										options={COUNTRIES}
										bind:value={$formData.country}
										placeholder="ค้นหาประเทศ..."
									/>
								{/snippet}
							</Form.Control>
							<Form.FieldErrors />
						</Form.Field>
						<Form.Field {form} name="religion">
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label>ศาสนา <span class="text-destructive">*</span></Form.Label>
									<Select.Root type="single" bind:value={$formData.religion}
										><Select.Trigger {...props} class="h-9 w-full"
											>{religionOptions.find((o) => o.value === $formData.religion)?.label ??
												'— เลือก —'}</Select.Trigger
										><Select.Content
											>{#each religionOptions as opt (opt.value)}<Select.Item
													value={opt.value}
													label={opt.label}
												/>{/each}</Select.Content
										></Select.Root
									>
								{/snippet}
							</Form.Control>
							<Form.FieldErrors />
						</Form.Field>
					</div>
				</div>
			</div>

			<!-- Vulnerable Groups (coded) — separate from free-form Special Needs -->
			<div class="mt-6 space-y-2 border-t pt-4">
				<Label class="text-sm font-semibold">กลุ่มเปราะบาง (Vulnerable Groups)</Label>
				<div class="flex flex-wrap gap-2 pt-1">
					{#each vulnerableGroupSchema.options as need (need)}
						{@const chip = VULNERABLE_GROUP_CHIPS[need]}
						{@const checked = ($formData.vulnerable_groups ?? []).includes(need)}
						<Button
							type="button"
							variant="outline"
							onclick={() => {
								const current = $formData.vulnerable_groups ?? [];
								$formData.vulnerable_groups = checked
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
						value={medicalConditionsStr}
						oninput={(event) => updateMedicalField('medical_conditions', event.currentTarget.value)}
					/>
				</div>
				<div class="space-y-2">
					<Label class="text-xs text-muted-foreground">ยาที่ใช้ประจำ</Label>
					<Input
						placeholder="เช่น ยาลดความดัน, ยาเบาหวาน (ถ้าไม่มีให้เว้นว่าง)"
						value={medicalMedicationsStr}
						oninput={(event) =>
							updateMedicalField('medical_medications', event.currentTarget.value)}
					/>
				</div>
				<div class="space-y-2">
					<Label class="text-xs text-muted-foreground">ประวัติการแพ้ (ยา/อาหาร)</Label>
					<Input
						placeholder="เช่น แพ้เพนิซิลลิน, อาหารทะเล, ถั่ว (ถ้าไม่มีให้เว้นว่าง)"
						value={medicalAllergiesStr}
						oninput={(event) => updateMedicalField('medical_allergies', event.currentTarget.value)}
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
