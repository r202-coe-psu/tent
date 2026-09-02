<script lang="ts">
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import {
		evacueeInputSchema,
		currentBEYear,
		minBirthYearBE,
		MAX_AGE_YEARS,
		type EvacueeInput
	} from '../domain/people';
	import { useSaveImage } from '$lib/features/images';
	import { getShelterCode } from '$lib/db/shelter';
	import { authStore } from '$lib/stores/auth.svelte';
	import Camera from '@lucide/svelte/icons/camera';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import User from '@lucide/svelte/icons/user';
	import Phone from '@lucide/svelte/icons/phone';
	import HeartPulse from '@lucide/svelte/icons/heart-pulse';
	import { getTranslation } from '$lib/utils/i18n';
	import { languageStore, type LanguageCode } from '$lib/stores/language.svelte';
	import { EVACUEE_REGISTRATION_I18N } from './_constants/evacuee-registration.i18n';
	import { PersonalInfoFields, SpecialNeedsFields, EmergencyContactFields } from './forms/index.js';

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

	function safeQuery<T>(fn: () => T, fallback: T): T {
		try {
			return fn();
		} catch {
			return fallback;
		}
	}

	const activeLang = $derived(lang ?? languageStore.current);
	const t = $derived(getTranslation(EVACUEE_REGISTRATION_I18N, activeLang));

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
	const saveImage = safeQuery(() => useSaveImage(), {
		mutateAsync: async () => ({ id: 'img-1' }),
		isPending: false
	} as unknown as ReturnType<typeof useSaveImage>);

	let noPhone = $state(initial?.phone === null);

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
			if (initialInput.special_needs && initialInput.special_needs.length > 0) {
				if (!$formData.special_needs || $formData.special_needs.length === 0) {
					$formData.special_needs = [...initialInput.special_needs];
				}
			}
		}
	});

	const initialFormData: Partial<EvacueeInput> = {
		...initial,
		person_id: initial?.person_id ?? { cardType: 'national_id' as const, number: '' },
		special_needs: initial?.special_needs ?? [],
		emergency_contact: initial?.emergency_contact
	};

	const form = superForm(defaults(initialFormData as EvacueeInput, zod4(evacueeInputSchema)), {
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

			if ($formData.person_id?.cardType === 'national_id' && $formData.person_id?.number) {
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
			}

			// If emergency contact fields are blank, clear it so optional object validation succeeds
			if (
				!$formData.emergency_contact?.name?.trim() &&
				!$formData.emergency_contact?.phone?.trim()
			) {
				$formData.emergency_contact = undefined;
			}
		},
		onUpdate: ({ form: f }) => {
			if (f.valid) {
				ondraftchange?.(f.data);
				onsubmit(f.data);
			}
		}
	});

	const { form: formData, errors, enhance, submitting } = form;

	$effect(() => {
		const y = Number(birthYearBE);
		$formData.birth_year = !isNaN(y) && y > 0 ? y : undefined;
	});

	$effect(() => {
		const a = Number(age);
		$formData.age = !isNaN(a) && a >= 0 ? a : undefined;
	});

	const birthYearError = $derived.by(() => {
		if (!birthYearBE) return undefined;
		const y = Number(birthYearBE);
		if (isNaN(y)) return t.validation.birthYearNumeric;
		if (y <= minBirthYearBE()) return t.validation.birthYearMin(minBirthYearBE());
		if (y > currentBEYear()) return t.validation.birthYearFuture;
		return undefined;
	});

	const ageError = $derived.by(() => {
		if (!age) return undefined;
		const a = Number(age);
		if (isNaN(a)) return t.validation.ageNumeric;
		if (a > MAX_AGE_YEARS) return t.validation.ageMax(MAX_AGE_YEARS);
		return undefined;
	});

	function handleBack() {
		ondraftchange?.($formData);
		onBack();
	}

	async function handlePhotoCapture(file: File | null) {
		if (!file) return;
		uploadingPhoto = true;
		try {
			if (facePhotoUrl && facePhotoUrl.startsWith('blob:')) {
				URL.revokeObjectURL(facePhotoUrl);
			}
			facePhotoUrl = URL.createObjectURL(file);
			const ctx = { shelterCode: getShelterCode(), createdBy: authStore.user?.name ?? 'unknown' };
			const res = await saveImage.mutateAsync({ file, ctx });
			$formData.photo = res._id;
			toast.success(t.photo.toastSuccess);
		} catch (e) {
			console.error(e);
			toast.error(t.photo.toastFailed);
			if (facePhotoUrl && facePhotoUrl.startsWith('blob:')) {
				URL.revokeObjectURL(facePhotoUrl);
				facePhotoUrl = null;
			}
			$formData.photo = null;
		} finally {
			uploadingPhoto = false;
		}
	}

	function handleDeletePhoto() {
		if (facePhotoUrl && facePhotoUrl.startsWith('blob:')) {
			URL.revokeObjectURL(facePhotoUrl);
		}
		facePhotoUrl = null;
		$formData.photo = null;
	}
</script>

<form method="POST" use:enhance class="space-y-6">
	<Field.FieldGroup class="space-y-6">
		<!-- Photo Upload Section -->
		<section class="form-section-card space-y-4">
			<div class="flex items-center gap-2 border-b border-border pb-3">
				<Camera class="size-5 text-primary" />
				<h3 class="text-base font-bold text-foreground">{t.photo.header}</h3>
			</div>

			<div class="flex flex-col items-center gap-4 sm:flex-row">
				<div
					class="relative flex size-28 shrink-0 items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-border bg-muted/30"
				>
					{#if uploadingPhoto}
						<Loader2 class="size-8 animate-spin text-primary" />
					{:else if facePhotoUrl}
						<img src={facePhotoUrl} alt={t.photo.previewAlt} class="size-full object-cover" />
					{:else}
						<User class="size-12 text-muted-foreground/40" />
					{/if}
				</div>

				<div class="space-y-2 text-center sm:text-left">
					<p class="text-xs text-muted-foreground">{t.photo.desc}</p>
					<div class="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
						<label
							class="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground shadow-xs transition-colors hover:bg-muted"
						>
							<Camera class="size-4 text-primary" />
							<span>{facePhotoUrl ? t.photo.btnChange : t.photo.btnTake}</span>
							<input
								type="file"
								accept="image/*"
								capture="user"
								class="sr-only"
								disabled={uploadingPhoto || pending}
								onchange={(e) => handlePhotoCapture(e.currentTarget.files?.[0] ?? null)}
							/>
						</label>

						{#if facePhotoUrl}
							<Button
								type="button"
								variant="ghost"
								size="sm"
								class="min-h-11 text-destructive hover:bg-destructive/10"
								onclick={handleDeletePhoto}
								disabled={uploadingPhoto || pending}
							>
								{t.photo.btnDelete}
							</Button>
						{/if}
					</div>
				</div>
			</div>
		</section>

		<!-- Personal Info Shared Sub-component (Issue #205, #206) -->
		<section class="form-section-card space-y-4">
			<div class="flex items-center gap-2 border-b border-border pb-3">
				<User class="size-5 text-primary" />
				<h3 class="text-base font-bold text-foreground">{t.personal.header}</h3>
			</div>

			<PersonalInfoFields
				bind:first_name={$formData.first_name}
				bind:last_name={$formData.last_name}
				bind:nickname={$formData.nickname}
				bind:person_id={$formData.person_id}
				bind:phone={$formData.phone}
				bind:no_phone={noPhone}
				bind:birth_year={birthYearBE}
				bind:age
				bind:gender={$formData.gender}
				bind:religion={$formData.religion}
				bind:country={$formData.country}
				disabled={$submitting || pending}
				errors={{
					first_name: $errors.first_name?.[0],
					last_name: $errors.last_name?.[0],
					nickname: $errors.nickname?.[0],
					cardNumber: ($errors.person_id as { number?: string[] } | undefined)?.number?.[0],
					birth_year: ($errors.birth_year as string[] | undefined)?.[0] || birthYearError,
					age: ($errors.age as string[] | undefined)?.[0] || ageError,
					country: $errors.country?.[0],
					phone: $errors.phone?.[0]
				}}
			/>
		</section>

		<!-- Special Needs Shared Sub-component (Issue #206 Station 1) -->
		<section class="form-section-card space-y-4">
			<div class="flex items-center gap-2 border-b border-border pb-3">
				<HeartPulse class="size-5 text-amber-600" />
				<h3 class="text-base font-bold text-foreground">
					กลุ่มเปราะบางและความต้องการพิเศษ (Special Needs)
				</h3>
			</div>

			<SpecialNeedsFields
				bind:special_needs={$formData.special_needs}
				disabled={$submitting || pending}
			/>
		</section>

		<!-- Emergency Contact Shared Sub-component -->
		<section class="form-section-muted overflow-hidden rounded-xl border border-border">
			<div class="border-b border-border px-4 py-3 sm:px-5">
				<h3 class="flex items-center gap-2 text-base font-bold text-foreground">
					<Phone class="size-5 text-primary" />
					{t.emergencyContact.header}
				</h3>
			</div>
			<div class="p-4 sm:p-6">
				{#if $formData.emergency_contact}
					<EmergencyContactFields
						bind:name={$formData.emergency_contact.name}
						bind:phone={$formData.emergency_contact.phone}
						bind:relation={$formData.emergency_contact.relation}
						disabled={$submitting || pending}
						errors={{
							name: $errors.emergency_contact?.name?.[0],
							phone: $errors.emergency_contact?.phone?.[0],
							relation: $errors.emergency_contact?.relation?.[0]
						}}
					/>
				{/if}
			</div>
		</section>

		<!-- Back + Submit actions -->
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
