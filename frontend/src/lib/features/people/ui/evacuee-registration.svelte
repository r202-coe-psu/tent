<script lang="ts">
	import { tick, untrack, type Snippet } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import {
		station1EvacueeInputSchema,
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
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import { getTranslation } from '$lib/utils/i18n';
	import { languageStore, type LanguageCode } from '$lib/stores/language.svelte';
	import { EVACUEE_REGISTRATION_I18N } from './_constants/evacuee-registration.i18n';
	import { PersonalInfoFields, SpecialNeedsFields, EmergencyContactFields } from './forms/index.js';
	import { collectFormErrorMessages } from './forms/form-errors.js';

	const EMPTY_EMERGENCY_CONTACT = { name: '', phone: '', relation: '' };

	let {
		onsubmit,
		pending = false,
		onBack,
		initialInput = null,
		ondraftchange,
		facePhotoUrl = $bindable(null),
		lang,
		onvalidationerror,
		hideActions = false,
		formId = 'evacuee-registration-form',
		nextLabel,
		afterPersonal
	}: {
		onsubmit: (input: EvacueeInput) => void;
		pending?: boolean;
		onBack?: (() => void) | undefined;
		initialInput?: Partial<EvacueeInput> | null;
		ondraftchange?: (input: Partial<EvacueeInput>) => void;
		facePhotoUrl?: string | null;
		lang?: LanguageCode;
		onvalidationerror?: () => void;
		/** Station 1 shell: hide local Next — sticky save submits this form via `formId`. */
		hideActions?: boolean;
		formId?: string;
		nextLabel?: string;
		/** Shell injects household here so it sits between identity and emergency (no nested forms). */
		afterPersonal?: Snippet;
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
	let showValidationSummary = $state(false);
	let validationMessages = $state<string[]>([]);
	let formTopRef = $state<HTMLElement | null>(null);

	function ensureEmergencyContactShell() {
		if (!$formData.emergency_contact) {
			$formData.emergency_contact = { ...EMPTY_EMERGENCY_CONTACT };
		}
	}

	async function revealValidationIssues(formErrors: unknown, extraMessages: string[] = []) {
		const messages = [...collectFormErrorMessages(formErrors), ...extraMessages].filter(
			(msg, i, arr) => msg && arr.indexOf(msg) === i
		);
		showValidationSummary = true;
		validationMessages = messages.length > 0 ? messages : [t.validation.formIncomplete];

		onvalidationerror?.();
		await tick();
		requestAnimationFrame(() => {
			formTopRef?.scrollIntoView({ behavior: 'smooth', block: 'start' });
			const firstInvalid = formTopRef?.querySelector<HTMLElement>('[aria-invalid="true"]');
			firstInvalid?.focus({ preventScroll: true });
		});

		toast.error(t.validation.formIncomplete, {
			description: validationMessages.slice(0, 3).join('\n'),
			duration: 6000
		});
	}

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
		// Keep defined — Svelte 5 rejects bind:x={undefined} when $bindable has a fallback.
		first_name: initial?.first_name ?? '',
		last_name: initial?.last_name ?? '',
		nickname: initial?.nickname ?? '',
		gender: initial?.gender ?? 'other',
		phone: initial?.phone === null ? null : (initial?.phone ?? ''),
		person_id: initial?.person_id ?? { cardType: 'national_id' as const, number: '' },
		special_needs: initial?.special_needs ?? [],
		emergency_contact: initial?.emergency_contact ?? { ...EMPTY_EMERGENCY_CONTACT }
	};

	const form = superForm(
		defaults(initialFormData as EvacueeInput, zod4(station1EvacueeInputSchema)),
		{
			SPA: true,
			dataType: 'json',
			validators: zod4(station1EvacueeInputSchema),
			resetForm: false,
			onSubmit: ({ cancel }) => {
				const extra: string[] = [];
				if (birthYearError) extra.push(birthYearError);
				if (ageError) extra.push(ageError);

				if (extra.length > 0) {
					cancel();
					void revealValidationIssues($errors, extra);
					return;
				}

				if ($formData.person_id?.cardType === 'national_id' && $formData.person_id?.number) {
					const cleanId = $formData.person_id.number.replace(/\D/g, '');
					if (cleanId.length !== 13) {
						$errors.person_id = {
							...($errors.person_id || {}),
							number: [t.validation.nationalIdLength]
						};
						cancel();
						void revealValidationIssues($errors, [t.validation.nationalIdLength]);
						return;
					}
				}

				if (noPhone) {
					$formData.phone = null;
				}

				// Keep the emergency_contact UI shell so fields never unmount on error.
				ensureEmergencyContactShell();
			},
			onUpdate: ({ form: f }) => {
				ensureEmergencyContactShell();
				if (f.valid) {
					const data = structuredClone(f.data);
					showValidationSummary = false;
					validationMessages = [];
					ondraftchange?.(data);
					onsubmit(data);
				} else {
					void revealValidationIssues(f.errors);
				}
			}
		}
	);

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
		ensureEmergencyContactShell();
		ondraftchange?.(structuredClone($formData));
		onBack?.();
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

<div class="space-y-6" bind:this={formTopRef}>
	<form id={formId} method="POST" use:enhance class="space-y-6">
		{#if showValidationSummary && validationMessages.length > 0}
			<Alert.Root variant="destructive" class="border-destructive/40 bg-destructive/5" role="alert">
				<CircleAlert class="size-4" />
				<Alert.Title class="font-semibold">{t.validation.summaryTitle}</Alert.Title>
				<Alert.Description>
					<ul class="mt-2 list-disc space-y-1 pl-5">
						{#each validationMessages as msg (msg)}
							<li>{msg}</li>
						{/each}
					</ul>
				</Alert.Description>
			</Alert.Root>
		{/if}

		<Field.FieldGroup class="space-y-6">
			<section id="reg-section-photo" class="form-section-card scroll-mt-24 space-y-4">
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

			<section id="reg-section-personal" class="form-section-card scroll-mt-24 space-y-4">
				<div class="flex items-center gap-2 border-b border-border pb-3">
					<User class="size-5 text-primary" />
					<h3 class="text-base font-bold text-foreground">{t.personal.header}</h3>
				</div>

				<PersonalInfoFields
					bind:first_name={$formData.first_name}
					bind:last_name={$formData.last_name}
					bind:nickname={
						() => $formData.nickname ?? '',
						(v) => {
							$formData.nickname = v;
						}
					}
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
						gender: $errors.gender?.[0],
						country: $errors.country?.[0],
						phone: $errors.phone?.[0]
					}}
				/>
			</section>
		</Field.FieldGroup>
	</form>

	{@render afterPersonal?.()}

	<Field.FieldGroup class="space-y-6">
		<section id="reg-section-emergency" class="form-section-card scroll-mt-24 space-y-4">
			<div class="flex items-center gap-2 border-b border-border pb-3">
				<Phone class="size-5 text-primary" />
				<h3 class="text-base font-bold text-foreground">
					{t.emergencyContact.header}
				</h3>
			</div>

			<EmergencyContactFields
				bind:name={
					() => $formData.emergency_contact?.name ?? '',
					(v) => {
						ensureEmergencyContactShell();
						$formData.emergency_contact!.name = v;
					}
				}
				bind:phone={
					() => $formData.emergency_contact?.phone ?? '',
					(v) => {
						ensureEmergencyContactShell();
						$formData.emergency_contact!.phone = v;
					}
				}
				bind:relation={
					() => $formData.emergency_contact?.relation ?? '',
					(v) => {
						ensureEmergencyContactShell();
						$formData.emergency_contact!.relation = v;
					}
				}
				{formId}
				disabled={$submitting || pending}
				errors={{
					name: $errors.emergency_contact?.name?.[0],
					phone: $errors.emergency_contact?.phone?.[0],
					relation: $errors.emergency_contact?.relation?.[0]
				}}
			/>
		</section>

		<section id="reg-section-special" class="form-section-card scroll-mt-24 space-y-4">
			<div class="flex items-center gap-2 border-b border-border pb-3">
				<HeartPulse class="size-5 text-primary" />
				<h3 class="text-base font-bold text-foreground">{t.specialNeeds.header}</h3>
			</div>

			<SpecialNeedsFields
				bind:special_needs={$formData.special_needs}
				disabled={$submitting || pending}
				label=""
			/>
		</section>

		{#if !hideActions}
			<div
				class="flex w-full flex-col gap-3 border-t border-border pt-6 sm:flex-row-reverse sm:items-center sm:justify-between"
			>
				<Form.Button
					form={formId}
					disabled={$submitting || pending}
					class="touch-target h-auto w-full px-6 py-3 text-base font-semibold sm:w-auto sm:text-sm"
				>
					{nextLabel ?? t.actions.next}
				</Form.Button>
				{#if onBack}
					<Button
						type="button"
						variant="outline"
						onclick={handleBack}
						class="touch-target h-auto w-full px-6 py-3 text-base font-medium sm:w-auto sm:text-sm"
					>
						{t.actions.back}
					</Button>
				{/if}
			</div>
		{/if}
	</Field.FieldGroup>
</div>
