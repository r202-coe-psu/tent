<script lang="ts">
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import SearchSelect from '$lib/components/search-select.svelte';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import {
		evacueeInputSchema,
		currentBEYear,
		minBirthYearBE,
		MAX_AGE_YEARS,
		type EvacueeInput
	} from '../domain/people';
	import { useMasterData } from '$lib/features/master-data';
	import { useShelter } from '$lib/features/shelters';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { authStore } from '$lib/stores/auth.svelte';
	import { useSaveImage } from '$lib/features/images';
	import Camera from '@lucide/svelte/icons/camera';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { COUNTRIES } from '$lib/utils/country';
	import { getTranslation } from '$lib/utils/i18n';

	import { languageStore, type LanguageCode } from '$lib/stores/language.svelte';
	import { EVACUEE_REGISTRATION_I18N } from './_constants/evacuee-registration.i18n';

	let {
		onsubmit,
		pending = false,
		onBack,
		hasSymptomsSelected = false,
		initialInput = null,
		ondraftchange,
		facePhotoUrl = $bindable(null),
		lang
	}: {
		onsubmit: (input: EvacueeInput) => void;
		pending?: boolean;
		onBack: () => void;
		hasSymptomsSelected?: boolean;
		initialInput?: Partial<EvacueeInput> | null;
		ondraftchange?: (input: Partial<EvacueeInput>) => void;
		facePhotoUrl?: string | null;
		lang?: LanguageCode;
	} = $props();

	const activeLang = $derived(lang ?? languageStore.current);
	const t = $derived(getTranslation(EVACUEE_REGISTRATION_I18N, activeLang));

	const cardTypeOptions = $derived([
		{ value: 'national_id', label: t.cardType.options.national_id },
		{ value: 'passport', label: t.cardType.options.passport },
		{ value: 'pink_card', label: t.cardType.options.pink_card },
		{ value: 'other', label: t.cardType.options.other }
	]);

	const genderOptions = $derived([
		{ value: 'male', label: t.personal.gender.options.male },
		{ value: 'female', label: t.personal.gender.options.female },
		{ value: 'other', label: t.personal.gender.options.other }
	]);

	const religionOptions = $derived([
		{ value: 'buddhist', label: t.personal.religion.options.buddhist },
		{ value: 'muslim', label: t.personal.religion.options.muslim },
		{ value: 'christian', label: t.personal.religion.options.christian },
		{ value: 'other', label: t.personal.religion.options.other },
		{ value: 'unknown', label: t.personal.religion.options.unknown }
	]);

	const initial = untrack(() => initialInput);
	let birthYearBE = $state(
		typeof initial?.birth_year === 'number'
			? String(initial.birth_year)
			: typeof initial?.age === 'number'
				? String(currentBEYear() - initial.age)
				: ''
	);
	let age = $state(
		typeof initial?.age === 'number'
			? String(initial.age)
			: typeof initial?.birth_year === 'number'
				? String(Math.max(0, currentBEYear() - initial.birth_year))
				: ''
	);
	let uploadingPhoto = $state(false);
	const saveImage = useSaveImage();
	// "ไม่มีเบอร์โทร" — เก็บ phone เป็น null ตาม spec (schema.md §evacuee: phone str|null, req)
	let noPhone = $state(false);
	let medicalConditionsStr = $state(initial?.medical_conditions?.join(', ') ?? '');
	let medicalMedicationsStr = $state(initial?.medical_medications?.join(', ') ?? '');
	let medicalAllergiesStr = $state(initial?.medical_allergies?.join(', ') ?? '');

	$effect(() => {
		if (initialInput) {
			if (typeof initialInput.birth_year === 'number') {
				birthYearBE = String(initialInput.birth_year);
				if (typeof initialInput.age === 'number') {
					age = String(initialInput.age);
				} else {
					age = String(Math.max(0, currentBEYear() - initialInput.birth_year));
				}
			} else if (typeof initialInput.age === 'number') {
				age = String(initialInput.age);
				birthYearBE = String(currentBEYear() - initialInput.age);
			}
		}
	});

	const initialFormData = {
		...initial,
		person_id: initial?.person_id ?? { cardType: 'national_id' as const, number: '' }
	};
	const form = superForm(defaults(initialFormData, zod4(evacueeInputSchema)), {
		SPA: true,
		dataType: 'json',
		validators: zod4(evacueeInputSchema),
		resetForm: false,
		onSubmit: ({ cancel }) => {
			if (birthYearError || ageError) {
				const message = birthYearError || ageError || '';
				toast.error(message);
				cancel();
				return;
			}

			if ($formData.person_id.cardType === 'national_id' && $formData.person_id.number) {
				const cleanId = $formData.person_id.number.replace(/\D/g, '');
				if (cleanId.length !== 13) {
					$errors.person_id = {
						...($errors.person_id || {}),
						number: [t.validation.nationalIdLength]
					};
					toast.error(t.validation.nationalIdLength);
					cancel();
					return;
				}
			}

			if (noPhone) {
				$formData.phone = null;
			} else {
				const cleanPhone = ($formData.phone ?? '').replace(/\D/g, '');
				if (cleanPhone.length !== 10) {
					$errors.phone = [t.validation.phoneRequired];
					toast.error(t.validation.phoneRequired);
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
						$errors.emergency_contact = {
							...($errors.emergency_contact || {}),
							phone: [t.validation.emergencyPhoneLength]
						};
						toast.error(t.validation.emergencyPhoneLength);
						cancel();
						return;
					}
				}
			}
		},
		onUpdate: async ({ form }) => {
			if (!form.valid) {
				toast.error(t.validation.formIncomplete);
				return;
			}
			onsubmit(form.data as EvacueeInput);
		}
	});

	const { form: formData, errors, submitting } = form;

	const shelterQuery = useShelter(() => shelterStore.selectedShelterCode ?? getShelterCode());
	const vulnerableGroupQuery = useMasterData(() => 'vulnerable_group');

	// Vulnerable-group chips — restricted to this shelter's admission_policy.supported_vulnerable_groups
	// (shelter config), label from master data. Codes no longer present in the master list are
	// orphans (deleted upstream) and must not be offered for new registrations — that cleanup
	// happens on the shelter admission-policy form instead.
	const specialNeedChipOptions = $derived.by(() => {
		if (!vulnerableGroupQuery.isSuccess) return [];
		const supported = shelterQuery.data?.admission_policy?.supported_vulnerable_groups ?? [];
		const masterByCode = new Map(
			vulnerableGroupQuery.data.items
				.filter((item) => item.status === 'active')
				.map((item) => [item.code, item])
		);
		return supported
			.filter((code) => masterByCode.has(code))
			.map((code) => ({ code, label: masterByCode.get(code)!.label }));
	});

	const birthYearError = $derived.by(() => {
		if (!birthYearBE) return undefined;
		const y = Number(birthYearBE);
		if (isNaN(y)) return t.validation.birthYearNumeric;
		if (y > currentBEYear()) return t.validation.birthYearFuture;
		if (y <= minBirthYearBE()) return t.validation.birthYearMin(minBirthYearBE());
		return undefined;
	});

	const ageError = $derived.by(() => {
		if (!age) return undefined;
		const a = Number(age);
		if (isNaN(a)) return t.validation.ageNumeric;
		if (a > MAX_AGE_YEARS) return t.validation.ageMax(MAX_AGE_YEARS);
		return undefined;
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

	function parseMedicalList(value: string) {
		return value
			.split(',')
			.map((item) => item.trim())
			.filter(Boolean);
	}

	function handleBack() {
		ondraftchange?.($formData);
		onBack();
	}
</script>

<form
	method="POST"
	use:form.enhance
	class="space-y-8 sm:space-y-6 [&_[data-slot=form-label]]:text-base sm:[&_[data-slot=form-label]]:text-sm [&_[data-slot=input]]:h-12 [&_[data-slot=input]]:text-base sm:[&_[data-slot=input]]:h-10 sm:[&_[data-slot=input]]:text-sm"
>
	<Field.FieldGroup>
		<div class="grid grid-cols-1 items-start gap-8 lg:grid-cols-[200px_1fr] lg:gap-6">
			<!-- Column 1: Face Photo mockup -->
			<div class="space-y-3 sm:max-w-xs lg:max-w-none">
				<p class="text-base leading-snug font-medium text-foreground sm:text-sm">
					{t.photo.label}
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
								shelterCode: shelterStore.selectedShelterCode ?? getShelterCode(),
								createdBy: authStore.user?.name ?? 'unknown'
							};
							const image = await saveImage.mutateAsync({ file, ctx });
							$formData.photo = image._id;
						} catch {
							$formData.photo = null;
							toast.error(t.photo.uploadFailed);
						} finally {
							uploadingPhoto = false;
						}
					}}
				/>
				<label
					for="face-photo-input"
					class="block min-h-44 cursor-pointer rounded-xl border border-dashed border-muted-foreground/30 bg-muted/20 p-4 text-center transition-all hover:border-primary/50 hover:bg-muted/30"
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
							<span class="text-sm text-muted-foreground">{t.photo.add}</span>
						</div>
					{/if}
				</label>
			</div>

			<!-- Column 2: Fields grid -->
			<div class="space-y-5 sm:space-y-4">
				<div class="flex items-center justify-between border-b border-border/60 pb-1">
					<span class="text-xs font-semibold tracking-wider text-muted-foreground uppercase"
						>ข้อมูลประจำตัว</span
					>
				</div>

				<div class="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-4">
					<Form.Field {form} name="person_id.cardType">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>{t.cardType.label}</Form.Label>
								<Select.Root type="single" bind:value={$formData.person_id.cardType}>
									<Select.Trigger
										{...props}
										class="!h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 data-placeholder:text-muted-foreground [&_svg]:self-center [&_svg:not([class*='size-'])]:size-4"
									>
										{cardTypeOptions.find((o) => o.value === $formData.person_id.cardType)?.label ??
											t.cardType.selectPlaceholder}
									</Select.Trigger>
									<Select.Content>
										{#each cardTypeOptions as opt (opt.value)}
											<Select.Item value={opt.value} label={opt.label} />
										{/each}
									</Select.Content>
								</Select.Root>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>

					<!-- เลขประจำตัวประชาชน / พาสปอร์ต / อื่นๆ -->
					<Form.Field {form} name="person_id.number">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>
									{#if $formData.person_id.cardType === 'national_id'}
										{t.idNumber.labels.national_id}
									{:else if $formData.person_id.cardType === 'passport'}
										{t.idNumber.labels.passport}
									{:else if $formData.person_id.cardType === 'pink_card'}
										{t.idNumber.labels.pink_card}
									{:else}
										{t.idNumber.labels.other}
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
										? t.idNumber.placeholders.national_id
										: $formData.person_id.cardType === 'passport'
											? t.idNumber.placeholders.passport
											: t.idNumber.placeholders.other}
									bind:value={$formData.person_id.number}
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>
				</div>

				<div class="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-4">
					<!-- ชื่อ -->
					<Form.Field {form} name="first_name">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label
									>{t.personal.firstName.label} <span class="text-destructive">*</span></Form.Label
								>
								<Input
									{...props}
									placeholder={t.personal.firstName.placeholder}
									bind:value={$formData.first_name}
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>

					<!-- นามสกุล -->
					<Form.Field {form} name="last_name">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label
									>{t.personal.lastName.label} <span class="text-destructive">*</span></Form.Label
								>
								<Input
									{...props}
									placeholder={t.personal.lastName.placeholder}
									bind:value={$formData.last_name}
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>

					<!-- ชื่อเล่น -->
					<Form.Field {form} name="nickname">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>{t.personal.nickname.label}</Form.Label>
								<Input
									{...props}
									placeholder={t.personal.nickname.placeholder}
									bind:value={$formData.nickname}
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>
				</div>

				<div class="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
					<!-- ปีเกิด (พ.ศ.) -->
					<div class="space-y-2">
						<Label class="text-base sm:text-sm">{t.personal.birthYear.label}</Label>
						<Input
							type="text"
							inputmode="numeric"
							maxlength={4}
							placeholder={t.personal.birthYear.placeholder}
							value={birthYearBE}
							aria-invalid={birthYearError ? 'true' : undefined}
							oninput={(e) => {
								const val = e.currentTarget.value.replace(/\D/g, '').slice(0, 4);
								e.currentTarget.value = val;
								updateBirthYear(val);
							}}
						/>
						{#if birthYearError}
							<p class="text-sm font-medium text-destructive">{birthYearError}</p>
						{/if}
					</div>

					<!-- อายุ -->
					<div class="space-y-2">
						<Label class="text-base sm:text-sm">{t.personal.age.label}</Label>
						<Input
							type="text"
							inputmode="numeric"
							maxlength={3}
							value={age}
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
								<Form.Label
									>{t.personal.gender.label} <span class="text-destructive">*</span></Form.Label
								>
								<Select.Root type="single" bind:value={$formData.gender}>
									<Select.Trigger
										{...props}
										class="flex !h-12 w-full items-center rounded-md border border-input bg-background px-3 text-base font-medium shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 data-placeholder:text-muted-foreground sm:!h-10 sm:text-sm [&_svg]:self-center [&_svg:not([class*='size-'])]:size-4"
									>
										{genderOptions.find((o) => o.value === $formData.gender)?.label ??
											t.personal.gender.selectPlaceholder}
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
								<Form.Label
									>{t.personal.phone.label} <span class="text-destructive">*</span></Form.Label
								>
								<Input
									{...props}
									inputmode="numeric"
									maxlength={10}
									placeholder={t.personal.phone.placeholder}
									disabled={noPhone}
									value={noPhone ? '' : ($formData.phone ?? '')}
									oninput={(e) => {
										const val = e.currentTarget.value.replace(/\D/g, '');
										e.currentTarget.value = val;
										$formData.phone = val === '' ? null : val;
									}}
								/>
								<label class="mt-2 flex min-h-11 cursor-pointer items-center gap-3 text-sm">
									<Checkbox
										class="size-5"
										checked={noPhone}
										onCheckedChange={(value) => {
											noPhone = !!value;
											if (noPhone) {
												$formData.phone = null;
												$errors.phone = undefined;
											}
										}}
									/>
									<span class="text-muted-foreground">{t.personal.phone.noPhone}</span>
								</label>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>
				</div>

				<div class="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
					<Form.Field {form} name="country">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label
									>{t.personal.country.label} <span class="text-destructive">*</span></Form.Label
								>
								<SearchSelect
									name="country"
									options={COUNTRIES}
									bind:value={$formData.country}
									placeholder={t.personal.country.placeholder}
									searchPlaceholder={t.personal.country.searchPlaceholder}
									emptyText={t.personal.country.emptyText}
									controlProps={props}
									class="h-12 rounded-md text-base sm:h-10 sm:text-sm"
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>

					<Form.Field {form} name="religion">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>{t.personal.religion.label}</Form.Label>
								<Select.Root type="single" bind:value={$formData.religion}>
									<Select.Trigger
										{...props}
										class="flex !h-12 w-full items-center rounded-md border border-input bg-background px-3 text-base font-medium shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 data-placeholder:text-muted-foreground sm:!h-10 sm:text-sm [&_svg]:self-center [&_svg:not([class*='size-'])]:size-4"
									>
										{religionOptions.find((o) => o.value === $formData.religion)?.label ??
											t.personal.religion.selectPlaceholder}
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
		<div class="w-full space-y-5 border-t border-border pt-8 sm:space-y-4 sm:pt-6">
			<h3 class="flex items-center gap-2 text-base font-semibold text-foreground">
				<span>🏥</span>
				{t.medical.header}
			</h3>
			<div class="grid grid-cols-1 gap-5 sm:gap-4">
				<div class="space-y-2">
					<Label class="text-base sm:text-sm">{t.medical.conditions.label}</Label>
					<Input
						placeholder={t.medical.conditions.placeholder}
						value={medicalConditionsStr}
						oninput={(event) => {
							medicalConditionsStr = event.currentTarget.value;
							$formData.medical_conditions = parseMedicalList(medicalConditionsStr);
						}}
					/>
				</div>
			</div>

			<div class="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-4">
				<div class="space-y-2">
					<Label class="text-base sm:text-sm">{t.medical.medications.label}</Label>
					<Input
						placeholder={t.medical.medications.placeholder}
						value={medicalMedicationsStr}
						oninput={(event) => {
							medicalMedicationsStr = event.currentTarget.value;
							$formData.medical_medications = parseMedicalList(medicalMedicationsStr);
						}}
					/>
				</div>

				<div class="space-y-2">
					<Label class="text-base sm:text-sm">{t.medical.allergies.label}</Label>
					<Input
						placeholder={t.medical.allergies.placeholder}
						value={medicalAllergiesStr}
						oninput={(event) => {
							medicalAllergiesStr = event.currentTarget.value;
							$formData.medical_allergies = parseMedicalList(medicalAllergiesStr);
						}}
					/>
				</div>
			</div>
		</div>

		<!-- Special Needs section -->
		<div class="w-full space-y-3 border-t border-border pt-8 sm:space-y-2 sm:pt-6">
			<Label class="text-base font-semibold sm:text-sm">{t.specialNeeds.label}</Label>
			<div class="flex flex-wrap gap-2.5 pt-1 sm:gap-2">
				{#each specialNeedChipOptions as chip (chip.code)}
					{@const need = chip.code as NonNullable<EvacueeInput['special_needs']>[number]}
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
						class="inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 py-2 text-base font-normal transition-colors sm:min-h-0 sm:px-3 sm:py-1.5 sm:text-sm {checked
							? 'border-primary bg-primary/10 font-medium text-primary hover:bg-primary/15'
							: 'border-border bg-background text-muted-foreground hover:border-primary/50 hover:bg-primary/5'}"
					>
						<span>{chip.label}</span>
					</Button>
				{/each}
			</div>
			<Form.Field {form} name="special_needs"><Form.FieldErrors /></Form.Field>

			<div class="mt-8 mb-4 overflow-hidden rounded-xl border border-[#E2E8F0] bg-[#F8FAFC]">
				<div class="border-b border-[#E2E8F0] px-4 py-4 sm:px-6 sm:py-3">
					<h3 class="flex items-center gap-2 text-base font-bold text-foreground">
						<span>🚨</span>
						{t.emergencyContact.header}
					</h3>
				</div>
				<div class="grid grid-cols-1 gap-5 p-4 sm:grid-cols-2 sm:gap-4 sm:p-6">
					<Form.Field {form} name="emergency_contact.name">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>{t.emergencyContact.name.label}</Form.Label>
								<Input
									{...props}
									placeholder={t.emergencyContact.name.placeholder}
									value={$formData.emergency_contact?.name ?? ''}
									oninput={(e) => {
										if (!$formData.emergency_contact) {
											$formData.emergency_contact = {
												name: '',
												phone: '',
												relation: t.emergencyContact.defaultRelation
											};
										}
										$formData.emergency_contact.name = e.currentTarget.value;
									}}
									class="bg-white text-base sm:text-sm"
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>

					<Form.Field {form} name="emergency_contact.phone">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>{t.emergencyContact.phone.label}</Form.Label>
								<Input
									{...props}
									inputmode="numeric"
									maxlength={10}
									placeholder={t.emergencyContact.phone.placeholder}
									value={$formData.emergency_contact?.phone ?? ''}
									class="bg-white text-base sm:text-sm"
									oninput={(e) => {
										const val = e.currentTarget.value.replace(/\D/g, '');
										e.currentTarget.value = val;
										if (!$formData.emergency_contact) {
											$formData.emergency_contact = {
												name: '',
												phone: '',
												relation: t.emergencyContact.defaultRelation
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
							<Form.Label>{t.specialNeeds.note.label}</Form.Label>
							<textarea
								{...props}
								bind:value={$formData.medical_note}
								placeholder={t.specialNeeds.note.placeholder}
								class="flex min-h-28 w-full rounded-md border border-input bg-background px-3 py-3 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-24 sm:py-2 sm:text-sm"
							></textarea>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>
			</div>

			{#if hasSymptomsSelected}
				<div
					class="flex animate-in items-center justify-center gap-2 rounded-xl border border-red-300 bg-red-50 px-4 py-4 text-red-700 duration-300 fade-in slide-in-from-top-2 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400"
					role="alert"
				>
					<TriangleAlert class="size-5 shrink-0" aria-hidden="true" />
					<p class="text-base font-bold sm:text-sm">
						{t.sos.title} <span class="font-extrabold">{t.sos.badge}</span>
					</p>
				</div>
				<p class="text-center text-sm text-muted-foreground">
					{t.sos.description}
				</p>
			{/if}
		</div>

		<!-- Back + Submit row -->
		<div
			class="flex w-full flex-col gap-3 border-t border-border pt-6 sm:flex-row-reverse sm:items-center sm:justify-between"
		>
			<Form.Button
				disabled={$submitting || pending}
				class="h-12 w-full px-6 text-base font-semibold sm:h-10 sm:w-auto sm:text-sm"
			>
				{t.actions.next}
			</Form.Button>
			<Button
				type="button"
				variant="outline"
				onclick={handleBack}
				class="h-12 w-full px-6 text-base font-medium sm:h-10 sm:w-auto sm:text-sm"
			>
				{t.actions.back}
			</Button>
		</div>
	</Field.FieldGroup>
</form>
