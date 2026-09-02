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
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { authStore } from '$lib/stores/auth.svelte';
	import { useSaveImage } from '$lib/features/images';
	import Camera from '@lucide/svelte/icons/camera';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import User from '@lucide/svelte/icons/user';
	import Phone from '@lucide/svelte/icons/phone';
	import { COUNTRIES } from '$lib/utils/country';
	import { getTranslation } from '$lib/utils/i18n';

	import { languageStore, type LanguageCode } from '$lib/stores/language.svelte';
	import { EVACUEE_REGISTRATION_I18N } from './_constants/evacuee-registration.i18n';

	let {
		onsubmit,
		pending = false,
		onBack,
		initialInput = null,
		ondraftchange,
		facePhotoUrl = $bindable(null),
		lang
	}: {
		onsubmit: (input: EvacueeInput) => void;
		pending?: boolean;
		onBack: () => void;
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

	function handleBack() {
		ondraftchange?.($formData);
		onBack();
	}

	const selectTriggerClass =
		'form-control-touch flex w-full items-center rounded-md border border-input bg-background px-3 font-medium shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 data-placeholder:text-muted-foreground [&_svg]:self-center [&_svg:not([class*=\'size-\'])]:size-4';
</script>

<form
	method="POST"
	use:form.enhance
	class="space-y-6 [&_[data-slot=form-label]]:text-base sm:[&_[data-slot=form-label]]:text-sm [&_[data-slot=input]]:form-control-touch"
>
	<Field.FieldGroup>
		<section class="form-section-card space-y-6">
			<header class="flex items-center gap-2 border-b border-border/60 pb-3">
				<User class="size-5 text-primary" />
				<h2 class="text-base font-bold text-foreground">{t.sections.identity}</h2>
			</header>

			<div class="flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-6">
				<div class="shrink-0 space-y-2 sm:w-36">
					<p class="text-sm font-medium text-foreground">{t.photo.label}</p>
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
						class="block min-h-36 w-full cursor-pointer rounded-xl border border-dashed border-muted-foreground/30 bg-muted/20 p-3 text-center transition-all hover:border-primary/50 hover:bg-muted/30 sm:min-h-36 sm:w-36"
					>
						{#if facePhotoUrl}
							<div class="relative mx-auto aspect-square w-full max-w-32">
								<img
									src={facePhotoUrl}
									alt="Face"
									class="aspect-square w-full rounded-lg object-cover {uploadingPhoto
										? 'opacity-50'
										: ''}"
								/>
								{#if uploadingPhoto}
									<div class="absolute inset-0 flex items-center justify-center">
										<Loader2 class="h-8 w-8 animate-spin text-primary" />
									</div>
								{/if}
							</div>
						{:else}
							<div class="flex aspect-square max-w-32 flex-col items-center justify-center sm:mx-auto">
								<Camera class="mb-2 h-8 w-8 text-muted-foreground" />
								<span class="text-xs text-muted-foreground">{t.photo.add}</span>
							</div>
						{/if}
					</label>
				</div>

				<div class="min-w-0 flex-1 space-y-5">
					<div class="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-4">
						<Form.Field {form} name="person_id.cardType">
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label>{t.cardType.label}</Form.Label>
									<Select.Root type="single" bind:value={$formData.person_id.cardType}>
										<Select.Trigger {...props} class={selectTriggerClass}>
											{cardTypeOptions.find((o) => o.value === $formData.person_id.cardType)
												?.label ?? t.cardType.selectPlaceholder}
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
					</div>

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
			</div>

			<div class="grid grid-cols-1 gap-5 border-t border-border/60 pt-5 sm:grid-cols-3 sm:gap-4">
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
								<Select.Trigger {...props} class={selectTriggerClass}>
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
			</div>

			<div class="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-4">
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
								class="form-control-touch rounded-md"
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
								<Select.Trigger {...props} class={selectTriggerClass}>
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

			<div class="form-section-muted overflow-hidden">
				<div class="border-b border-border px-4 py-3 sm:px-5">
					<h3 class="flex items-center gap-2 text-base font-bold text-foreground">
						<Phone class="size-5 text-primary" />
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
									class="form-control-touch bg-card"
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
									class="form-control-touch bg-card"
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
		</section>

		<!-- Back + Submit row -->
		<div
			class="flex w-full flex-col gap-3 border-t border-border pt-6 sm:flex-row-reverse sm:items-center sm:justify-between"
		>
			<Form.Button
				disabled={$submitting || pending}
				class="touch-target h-auto w-full px-6 py-3 text-base font-semibold sm:w-auto sm:text-sm"
			>
				{t.actions.next}
			</Form.Button>
			<Button
				type="button"
				variant="outline"
				onclick={handleBack}
				class="touch-target h-auto w-full px-6 py-3 text-base font-medium sm:w-auto sm:text-sm"
			>
				{t.actions.back}
			</Button>
		</div>
	</Field.FieldGroup>
</form>
