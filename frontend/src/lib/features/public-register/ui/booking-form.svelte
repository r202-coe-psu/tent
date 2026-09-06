<script lang="ts">
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import Car from '@lucide/svelte/icons/car';
	import Info from '@lucide/svelte/icons/info';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Minus from '@lucide/svelte/icons/minus';
	import Package from '@lucide/svelte/icons/package';
	import PawPrint from '@lucide/svelte/icons/paw-print';
	import Plus from '@lucide/svelte/icons/plus';
	import QrCode from '@lucide/svelte/icons/qr-code';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Smartphone from '@lucide/svelte/icons/smartphone';
	import Users from '@lucide/svelte/icons/users';
	import X from '@lucide/svelte/icons/x';
	import { onMount, untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4, zod4Client } from 'sveltekit-superforms/adapters';
	import { env } from '$env/dynamic/public';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Form from '$lib/components/ui/form/index.js';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import SearchSelect from '$lib/components/search-select.svelte';
	import * as Select from '$lib/components/ui/select/index.js';
	import type { PublicShelterCardModel } from '$lib/features/public-portal';
	import {
		useBookingDistricts,
		useBookingProvinces,
		useBookingSubdistricts,
		useCreateBooking,
		usePetTypes,
		useShelterPolicy
	} from '../application/queries';
	import type { BookingTicket } from '../application/booking-store.svelte';
	import { getLatestStoredTicket, saveTicketToStorage } from '../data/ticket-storage';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_BOOKING_FORM_I18N } from '$lib/constants/i18n';
	import { buildDisclaimerGroups } from '$lib/features/people/domain/disclaimer';
	import { isCaptchaKeyConfigured, publicBookingInputSchema } from '../domain/booking';
	import type { ShelterSummary } from '$lib/features/shelters/index.js';

	interface Props {
		shelters: (PublicShelterCardModel & { available: number | null })[];
		vulnerableGroups: { code: string; label: string }[];
		lockedShelterCode?: string;
		onbooked: (ticket: BookingTicket) => void;
		onviewexistingticket?: () => void;
	}

	let {
		shelters,
		vulnerableGroups,
		lockedShelterCode = '',
		onbooked,
		onviewexistingticket
	}: Props = $props();

	let t = $derived(getTranslation(PUBLIC_BOOKING_FORM_I18N, langState.current));

	const createBooking = useCreateBooking();
	const siteKey = env.PUBLIC_RECAPTCHA_SITE_KEY || '';
	const captchaEnabled = isCaptchaKeyConfigured(siteKey);

	let GENDERS = $derived([
		{ value: 'male', label: t.genderMale },
		{ value: 'female', label: t.genderFemale },
		{ value: 'other', label: t.genderOther }
	]) as { value: string; label: string }[];

	function blankMember() {
		return {
			first_name: '',
			last_name: '',
			gender: 'male' as const,
			birth_year: undefined as number | undefined,
			age: undefined as number | undefined,
			special_needs: [] as string[]
		};
	}

	const currentCEYear = new Date().getFullYear();
	const currentBEYear = currentCEYear + 543;

	let memberEra = $state<('be' | 'ce')[]>(['be']);
	let memberYearInput = $state<string[]>(['']);
	let memberAgeInput = $state<string[]>(['']);

	let latestExistingTicket = $state<BookingTicket | null>(null);
	onMount(() => {
		latestExistingTicket = getLatestStoredTicket();
	});

	function handleYearInput(idx: number, raw: string) {
		const val = raw.replace(/\D/g, '').slice(0, 4);
		memberYearInput[idx] = val;
		if (val.length === 4) {
			const y = Number.parseInt(val, 10);
			const era = memberEra[idx] ?? 'be';
			const beYear = era === 'be' ? y : y + 543;
			const calculatedAge = currentBEYear - beYear;
			if (calculatedAge >= 0 && calculatedAge <= 150) {
				memberAgeInput[idx] = String(calculatedAge);
				$formData.members[idx].birth_year = beYear;
				$formData.members[idx].age = calculatedAge;
			}
		} else if (!val) {
			memberAgeInput[idx] = '';
			$formData.members[idx].birth_year = undefined;
			$formData.members[idx].age = undefined;
		}
	}

	function handleAgeInput(idx: number, raw: string) {
		const val = raw.replace(/\D/g, '').slice(0, 3);
		memberAgeInput[idx] = val;
		if (val) {
			const a = Number.parseInt(val, 10);
			if (a >= 0 && a <= 150) {
				const beYear = currentBEYear - a;
				const era = memberEra[idx] ?? 'be';
				memberYearInput[idx] = String(era === 'be' ? beYear : beYear - 543);
				$formData.members[idx].birth_year = beYear;
				$formData.members[idx].age = a;
			}
		} else {
			memberYearInput[idx] = '';
			$formData.members[idx].birth_year = undefined;
			$formData.members[idx].age = undefined;
		}
	}

	function switchEra(idx: number, nextEra: 'be' | 'ce') {
		const prevEra = memberEra[idx] ?? 'be';
		if (prevEra === nextEra) return;
		memberEra[idx] = nextEra;
		const currentYear = Number.parseInt(memberYearInput[idx] ?? '', 10);
		if (Number.isFinite(currentYear)) {
			memberYearInput[idx] = String(nextEra === 'ce' ? currentYear - 543 : currentYear + 543);
		}
	}

	// `dataType: 'json'` is required for the nested `members[]` / `pets[]` arrays —
	// same as the shelter wizard, which carries `zones[]` the same way.
	const form = superForm(defaults(zod4(publicBookingInputSchema)), {
		SPA: true,
		dataType: 'json',
		validators: zod4Client(publicBookingInputSchema),
		resetForm: false,
		onUpdate: async ({ form: validated }) => {
			if (!validated.valid) {
				toast.error(t.validationError);
				return;
			}
			await submit(validated.data);
		}
	});
	const { form: formData, submitting, enhance } = form;

	// Seed the shapes the schema requires before the first render — done at init
	// rather than in an $effect to avoid a read-then-write loop on $formData.
	$formData.shelter_code = untrack(() => lockedShelterCode);
	$formData.members = [blankMember()];
	$formData.address = {
		address_no: '',
		village_no: '',
		subdistrict: '',
		district: '',
		province: '',
		postal_code: ''
	};
	$formData.pets = [];
	$formData.vehicles = [];
	$formData.asset_description = '';

	let hasPets = $state(false);
	let hasAssets = $state(false);
	let hasVehicles = $state(false);
	let disclaimerAcknowledged = $state(false);
	let submitError = $state('');

	// `CLOSED` is the only hard block (FR-72) — a full shelter stays bookable and
	// warns instead, matching the warning-only occupancy guardrail of T-51.
	const bookable = $derived(shelters.filter((s) => s.status !== 'CLOSED'));
	const selected = $derived(shelters.find((s) => s.code === $formData.shelter_code) ?? null);

	const hasShelter = $derived(selected !== null);

	/**
	 * Feature flags and policy rules from the shelter master doc in CouchDB
	 * (`/api/public/v1/config/shelter-policy`).
	 */
	const shelterPolicyQuery = useShelterPolicy(() => selected?.code ?? '');
	const shelterPolicy = $derived(shelterPolicyQuery.data);

	const allowPets = $derived(hasShelter && (shelterPolicy?.feature_flags?.allow_pets ?? false));
	const allowAssets = $derived(hasShelter && (shelterPolicy?.feature_flags?.allow_assets ?? false));
	const allowVehicles = $derived(
		hasShelter && (shelterPolicy?.feature_flags?.allow_vehicles ?? false)
	);

	/**
	 * Reset choices if selected shelter changes or disables flags.
	 */
	let prevShelter = $state($formData.shelter_code);
	$effect(() => {
		if ($formData.shelter_code !== prevShelter) {
			prevShelter = $formData.shelter_code;
			disclaimerAcknowledged = false;
			if (!allowPets) {
				hasPets = false;
				$formData.pets = [];
			}
			if (!allowAssets) {
				hasAssets = false;
				$formData.asset_description = '';
			}
			if (!allowVehicles) {
				hasVehicles = false;
				$formData.vehicles = [];
			}
		}
	});

	/**
	 * Policy disclaimer groups (CR-016 / Station 1 standard).
	 */
	const disclaimerGroups = $derived(
		buildDisclaimerGroups({
			assetDescription: hasAssets ? ($formData.asset_description ?? '') : '',
			petCount: hasPets ? $formData.pets.length : 0,
			vehicleCount: hasVehicles ? $formData.vehicles.length : 0,
			shelter: shelterPolicy as unknown as ShelterSummary
		})
	);

	const disclaimerRequired = $derived(disclaimerGroups.length > 0);

	/**
	 * Which tags this shelter accepts. The shelter declares the vulnerable groups
	 * it can support (`admission_policy.supported_vulnerable_groups`), so the
	 * choices follow the selection above rather than being a fixed list.
	 */
	const availableTags = $derived.by(() => {
		const codes = (selected?.vulnerable_groups ?? []).filter((code) => code && code !== 'none');
		if (codes.length === 0) return [];
		const byCode = new Map(vulnerableGroups.map((g) => [g.code, g.label]));
		return codes.map((code) => byCode.get(code)?.trim() ?? '').filter((label) => label.length > 0);
	});

	/**
	 * Pet species this shelter accepts, from `master_data:pet_types` (global +
	 * shelter-local merge, CR-049) rather than a fixed list.
	 */
	const petTypesQuery = usePetTypes(() => selected?.code ?? '');
	const petTypes = $derived(petTypesQuery.data ?? []);

	const effectivePetSpecies = $derived(
		petTypes.length > 0
			? petTypes
			: [
					{ code: 'dog', label: 'สุนัข', is_default: true },
					{ code: 'cat', label: 'แมว', is_default: false },
					{ code: 'other', label: 'อื่น ๆ', is_default: false }
				]
	);

	/** Default species falling back to 'dog' or first available. */
	const defaultPetSpecies = $derived(
		petTypes.find((p) => p.is_default)?.code ?? effectivePetSpecies[0]?.code ?? 'dog'
	);

	const speciesCounts = $derived(
		$formData.pets.reduce(
			(acc, p) => {
				acc[p.species] = (acc[p.species] ?? 0) + 1;
				return acc;
			},
			{} as Record<string, number>
		)
	);

	function adjustSpeciesCount(species: string, delta: number) {
		if (delta > 0) {
			if ($formData.pets.length >= 20) return;
			$formData.pets = [
				...$formData.pets,
				{ species, name: '', condition: '', notes: '', has_cage: false }
			];
		} else if (delta < 0) {
			const idx = [...$formData.pets].reverse().findIndex((p) => p.species === species);
			if (idx === -1) return;
			const removeAt = $formData.pets.length - 1 - idx;
			$formData.pets = $formData.pets.filter((_, i) => i !== removeAt);
		}
	}

	function removePet(idx: number) {
		$formData.pets = $formData.pets.filter((_, i) => i !== idx);
		if ($formData.pets.length === 0) {
			hasPets = false;
		}
	}

	const vehicleTypeOptions = [
		{ value: 'car', label: 'รถยนต์' },
		{ value: 'motorcycle', label: 'รถจักรยานยนต์' },
		{ value: 'other', label: 'อื่น ๆ' }
	] as const;

	function addVehicle() {
		if ($formData.vehicles.length >= 10) return;
		$formData.vehicles = [...$formData.vehicles, { type: 'car', license_plate: '' }];
	}

	function removeVehicle(idx: number) {
		$formData.vehicles = $formData.vehicles.filter((_, i) => i !== idx);
		if ($formData.vehicles.length === 0) {
			hasVehicles = false;
		}
	}

	/**
	 * Domicile address cascade (CR-107) — จังหวัด → อำเภอ → ตำบล, each level
	 * fetched only once the one above is chosen, exactly like the staff
	 * pre-registration address step. Picking a level clears everything below it,
	 * so a half-changed address (new province, old ตำบล) can never be submitted;
	 * the postal code is filled from the chosen subdistrict rather than typed.
	 */
	const provincesQuery = useBookingProvinces();
	const districtsQuery = useBookingDistricts(() => $formData.address?.province ?? '');
	const subdistrictsQuery = useBookingSubdistricts(
		() => $formData.address?.province ?? '',
		() => $formData.address?.district ?? ''
	);

	const provinceItems = $derived((provincesQuery.data ?? []).map((p) => ({ value: p, label: p })));
	const districtItems = $derived((districtsQuery.data ?? []).map((d) => ({ value: d, label: d })));
	const subdistrictItems = $derived(
		(subdistrictsQuery.data ?? []).map((s) => ({ value: s.subdistrict, label: s.subdistrict }))
	);

	function selectProvince(province: string) {
		$formData.address = {
			...$formData.address,
			province,
			district: '',
			subdistrict: '',
			postal_code: ''
		};
	}

	function selectDistrict(district: string) {
		$formData.address = { ...$formData.address, district, subdistrict: '', postal_code: '' };
	}

	function selectSubdistrict(subdistrict: string) {
		const zipcode = (subdistrictsQuery.data ?? []).find(
			(s) => s.subdistrict === subdistrict
		)?.zipcode;
		$formData.address = {
			...$formData.address,
			subdistrict,
			postal_code: zipcode ? String(zipcode) : ''
		};
	}

	/** "ว่าง/ทั้งหมด" when vacancy is known, else just the total capacity. */
	function capacityLabel(shelter: { capacity: number; available: number | null }): string {
		return shelter.available === null
			? `${shelter.capacity} ${t.unitPlaces}`
			: `${shelter.available}/${shelter.capacity} ${t.unitPlaces}`;
	}

	function setMemberCount(next: number) {
		const target = Math.max(1, Math.min(20, next));
		const current = $formData.members;
		if (target > current.length) {
			const diff = target - current.length;
			$formData.members = [...current, ...Array.from({ length: diff }, blankMember)];
			memberEra = [...memberEra, ...Array.from({ length: diff }, () => 'be' as const)];
			memberYearInput = [...memberYearInput, ...Array.from({ length: diff }, () => '')];
			memberAgeInput = [...memberAgeInput, ...Array.from({ length: diff }, () => '')];
		} else if (target < current.length) {
			$formData.members = current.slice(0, target);
			memberEra = memberEra.slice(0, target);
			memberYearInput = memberYearInput.slice(0, target);
			memberAgeInput = memberAgeInput.slice(0, target);
		}
	}

	function toggleTag(idx: number, tag: string, checked: boolean) {
		const tags = $formData.members[idx].special_needs;
		$formData.members[idx].special_needs = checked ? [...tags, tag] : tags.filter((t) => t !== tag);
	}

	/** Resolve a reCAPTCHA token. `''` = not configured here, `null` = it failed. */
	async function captchaToken(): Promise<string | null> {
		// An injected token wins before we touch the network — that is the E2E hook.
		// Not a bypass: the BFF still verifies whatever token it receives.
		const injected = window.__captchaToken || '';
		if (injected) return injected;
		if (!captchaEnabled) return '';
		if (window.grecaptcha) {
			try {
				return await window.grecaptcha.execute(siteKey, { action: 'register' });
			} catch {
				return null;
			}
		}
		return null;
	}

	async function submit(data: typeof $formData) {
		submitError = '';
		if (disclaimerRequired && !disclaimerAcknowledged) {
			submitError = 'กรุณากดยืนยันการรับทราบเงื่อนไขและมาตรการด้านความปลอดภัยของศูนย์พักพิง';
			toast.error(submitError);
			return;
		}
		try {
			const token = await captchaToken();
			if (token === null) {
				submitError = t.recaptchaError;
				toast.error(submitError);
				return;
			}

			const ticket = await createBooking.mutateAsync({
				...data,
				pets: allowPets && hasPets ? data.pets : [],
				vehicles: allowVehicles && hasVehicles ? data.vehicles : [],
				asset_description: allowAssets && hasAssets ? data.asset_description : '',
				...(token ? { captchaToken: token } : {})
			});
			toast.success(t.bookingSuccess);
			// The surname is not in the response by design (see `BookingTicket`) —
			// carry over the one the contact just typed so the ticket can show a full name.
			const fullTicket = { ...ticket, last_name: data.members[0].last_name };
			saveTicketToStorage(fullTicket);
			onbooked(fullTicket);
		} catch (err) {
			submitError = err instanceof Error ? err.message : t.bookingErrorFallback;
			toast.error(submitError);
		}
	}
</script>

<svelte:head>
	{#if captchaEnabled}
		<script src="https://www.google.com/recaptcha/api.js?render={siteKey}" async defer></script>
	{/if}
</svelte:head>

<!--
	Shown wherever a block's choices are defined by the shelter (vulnerable-group
	tags, pet species) and no shelter has been picked yet — an empty picker there
	would read as "this shelter offers nothing" rather than "answer step 1 first".
-->
{#snippet chooseShelterFirst(what: string)}
	<p
		class="flex items-start gap-2 rounded-xl border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground"
	>
		<Info class="mt-0.5 h-3.5 w-3.5 shrink-0" />
		<span>{t.selectShelterFirst} {what}</span>
	</p>
{/snippet}

<form method="POST" use:enhance class="space-y-5">
	<!-- Smartphone recommendation banner -->
	<div
		class="flex items-start gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-4 text-sm text-foreground"
	>
		<Smartphone class="mt-0.5 h-5 w-5 shrink-0 text-primary" />
		<div>
			<p class="font-bold text-primary">💡 แนะนำ: ดำเนินการผ่านสมาร์ตโฟน</p>
			<p class="mt-0.5 text-xs text-muted-foreground">
				ตั๋วการจองและ Person QR code จะถูกจัดเก็บบนมือถือเครื่องนี้อัตโนมัติ
				พร้อมสำหรับเปิดแสดงต่อเจ้าหน้าที่ทะเบียนเมื่อเดินทางถึงศูนย์พักพิง
			</p>
		</div>
	</div>

	<!-- Existing ticket notice (if any) -->
	{#if latestExistingTicket && onviewexistingticket}
		<div
			class="flex flex-col gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 sm:flex-row sm:items-center sm:justify-between"
		>
			<div class="flex items-center gap-3">
				<QrCode class="h-5 w-5 shrink-0 text-emerald-600" />
				<div>
					<p class="text-sm font-bold text-foreground">
						คุณมีตั๋วการจองในอุปกรณ์นี้แล้ว ({latestExistingTicket.code})
					</p>
					<p class="text-xs text-muted-foreground">
						{latestExistingTicket.shelter_name || latestExistingTicket.shelter_code} · {latestExistingTicket.first_name}
					</p>
				</div>
			</div>
			<Button
				type="button"
				variant="outline"
				size="sm"
				class="w-full font-semibold sm:w-auto"
				onclick={onviewexistingticket}
			>
				เปิดดูตั๋วเดิม
			</Button>
		</div>
	{/if}

	<!-- ── 1. ศูนย์พักพิงและผู้ติดต่อหลัก ───────────────────────────────── -->
	<section class="space-y-4 rounded-2xl border border-border bg-card p-5">
		<h3 class="flex items-center gap-2 text-base font-bold text-foreground">
			<span
				class="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground"
				>1</span
			>
			{t.step1Title}
		</h3>

		<Form.Field {form} name="shelter_code">
			<Form.Control>
				{#snippet children({ props })}
					<div class="flex items-center justify-between gap-2">
						<Form.Label>{t.shelterLabel} <span class="text-destructive">*</span></Form.Label>
						{#if selected && selected.capacity > 0}
							<span
								class="rounded-full border border-success/30 bg-success-muted/40 px-2 py-0.5 text-2xs font-bold text-success"
							>
								{capacityLabel(selected)}
							</span>
						{/if}
					</div>
					<Select.Root
						type="single"
						value={$formData.shelter_code}
						onValueChange={(v) => ($formData.shelter_code = v)}
						disabled={Boolean(lockedShelterCode)}
					>
						<Select.Trigger {...props} class="!h-11 w-full font-semibold">
							{selected?.name ?? t.selectShelterPlaceholder}
						</Select.Trigger>
						<Select.Content>
							{#each bookable as shelter (shelter.code)}
								<Select.Item
									value={shelter.code}
									label="{shelter.name}{shelter.status === 'FULL' ? t.shelterFullSuffix : ''}"
								>
									<span class="flex w-full items-center justify-between gap-2">
										<span class="truncate">
											{shelter.name}{shelter.status === 'FULL' ? t.shelterFullSuffix : ''}
										</span>
										{#if shelter.capacity > 0}
											<span
												class="shrink-0 rounded-full bg-success-muted px-2 py-0.5 text-2xs font-bold text-success"
											>
												{capacityLabel(shelter)}
											</span>
										{/if}
									</span>
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				{/snippet}
			</Form.Control>
			{#if selected}
				<Form.Description class="flex items-start gap-1">
					<MapPin class="mt-0.5 h-3 w-3 shrink-0" />
					<span>{selected.address}</span>
				</Form.Description>
			{/if}
			<Form.FieldErrors />
		</Form.Field>

		{#if selected?.status === 'FULL'}
			<p
				class="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-muted/40 p-2.5 text-xs text-danger"
			>
				<AlertTriangle class="mt-0.5 h-3.5 w-3.5 shrink-0" />
				<span>{t.shelterFullWarning}</span>
			</p>
		{/if}

		<Form.Field {form} name="phone">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>{t.phoneLabel} <span class="text-destructive">*</span></Form.Label>
					<Input
						{...props}
						bind:value={$formData.phone}
						class="!h-11"
						inputmode="numeric"
						maxlength={10}
						placeholder="08X-XXX-XXXX"
						autocomplete="tel"
					/>
				{/snippet}
			</Form.Control>
			<Form.Description>{t.phoneDesc}</Form.Description>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="national_id">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>{t.idCardLabel}</Form.Label>
					<Input
						{...props}
						bind:value={$formData.national_id}
						class="!h-11"
						inputmode="numeric"
						maxlength={13}
						placeholder="X-XXXX-XXXXX-XX-X"
						autocomplete="off"
					/>
				{/snippet}
			</Form.Control>
			<Form.Description>{t.idCardDesc}</Form.Description>
			<Form.FieldErrors />
		</Form.Field>

		<!--
			Domicile address of the household head (CR-107) — the place the household
			evacuated *from*, not the shelter. Required because the back office finds
			and groups households by ตำบล/อำเภอ/จังหวัด; those three are pickers over
			the national dataset rather than free text, so a web booking is searchable
			next to a counter registration with no normalisation step.
		-->
		<fieldset class="space-y-3 rounded-xl border border-border p-4">
			<legend class="px-1 text-sm font-bold text-foreground">
				{t.addressLegend} <span class="text-destructive">*</span>
			</legend>
			<p class="text-xs text-muted-foreground">{t.addressDesc}</p>

			<div class="grid gap-3 sm:grid-cols-2">
				<Form.Field {form} name="address.address_no" class="space-y-1.5">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>{t.addressNoLabel} <span class="text-destructive">*</span></Form.Label>
							<Input
								{...props}
								bind:value={$formData.address.address_no}
								class="!h-11"
								maxlength={100}
								placeholder={t.addressNoPlaceholder}
								autocomplete="address-line1"
							/>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>

				<Form.Field {form} name="address.village_no" class="space-y-1.5">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>{t.villageNoLabel}</Form.Label>
							<Input
								{...props}
								bind:value={$formData.address.village_no}
								class="!h-11"
								maxlength={100}
								placeholder={t.villageNoPlaceholder}
								autocomplete="address-line2"
							/>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>
			</div>

			<div class="grid gap-3 sm:grid-cols-3">
				<Form.Field {form} name="address.province" class="space-y-1.5">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>{t.provinceLabel} <span class="text-destructive">*</span></Form.Label>
							<SearchSelect
								name="address.province"
								controlProps={props}
								options={provinceItems}
								bind:value={() => $formData.address.province, (v) => selectProvince(v)}
								placeholder={t.provincePlaceholder}
								searchPlaceholder={t.provinceSearch}
								emptyText={t.locationEmpty}
								loadingText={t.locationLoading}
								loading={provincesQuery.isPending}
								class="!h-11"
							/>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>

				<Form.Field {form} name="address.district" class="space-y-1.5">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>{t.districtLabel} <span class="text-destructive">*</span></Form.Label>
							<SearchSelect
								name="address.district"
								controlProps={props}
								options={districtItems}
								bind:value={() => $formData.address.district, (v) => selectDistrict(v)}
								placeholder={$formData.address.province
									? t.districtPlaceholder
									: t.districtNeedsProvince}
								searchPlaceholder={t.districtSearch}
								emptyText={t.locationEmpty}
								loadingText={t.locationLoading}
								loading={Boolean($formData.address.province) && districtsQuery.isPending}
								disabled={!$formData.address.province}
								class="!h-11"
							/>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>

				<Form.Field {form} name="address.subdistrict" class="space-y-1.5">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>{t.subdistrictLabel} <span class="text-destructive">*</span></Form.Label>
							<SearchSelect
								name="address.subdistrict"
								controlProps={props}
								options={subdistrictItems}
								bind:value={() => $formData.address.subdistrict, (v) => selectSubdistrict(v)}
								placeholder={$formData.address.district
									? t.subdistrictPlaceholder
									: t.subdistrictNeedsDistrict}
								searchPlaceholder={t.subdistrictSearch}
								emptyText={t.locationEmpty}
								loadingText={t.locationLoading}
								loading={Boolean($formData.address.district) && subdistrictsQuery.isPending}
								disabled={!$formData.address.district}
								class="!h-11"
							/>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>
			</div>

			{#if $formData.address.postal_code}
				<p class="text-xs text-muted-foreground">
					{t.postalCodeLabel}:
					<span class="font-semibold text-foreground">{$formData.address.postal_code}</span>
				</p>
			{/if}
		</fieldset>
	</section>

	<!-- ── 2. สมาชิกครอบครัว ────────────────────────────────────────────── -->
	<section class="space-y-4 rounded-2xl border border-border bg-card p-5">
		<h3 class="flex items-center gap-2 text-base font-bold text-foreground">
			<span
				class="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground"
				>2</span
			>
			{t.step2Title}
		</h3>

		<div class="flex items-center justify-between gap-4 rounded-xl bg-muted/40 p-4">
			<div class="flex items-start gap-2">
				<Users class="mt-0.5 h-4 w-4 text-muted-foreground" />
				<div>
					<p class="text-sm font-bold text-foreground">{t.totalEvacuees}</p>
					<p class="text-xs text-muted-foreground">{t.totalEvacueesDesc}</p>
				</div>
			</div>
			<div class="flex items-center gap-1">
				<Button
					type="button"
					variant="outline"
					size="icon-sm"
					aria-label={t.decreaseAria}
					disabled={$formData.members.length <= 1}
					onclick={() => setMemberCount($formData.members.length - 1)}
				>
					<Minus class="h-4 w-4" />
				</Button>
				<div class="w-12 text-center">
					<span class="block text-lg font-bold text-foreground">{$formData.members.length}</span>
					<span class="block text-2xs text-muted-foreground">{t.peopleUnit}</span>
				</div>
				<Button
					type="button"
					variant="outline"
					size="icon-sm"
					aria-label={t.increaseAria}
					disabled={$formData.members.length >= 20}
					onclick={() => setMemberCount($formData.members.length + 1)}
				>
					<Plus class="h-4 w-4" />
				</Button>
			</div>
		</div>

		{#if !hasShelter}
			{@render chooseShelterFirst(t.needsDependOnShelter)}
		{/if}

		{#each $formData.members as member, idx (idx)}
			{@const who = idx === 0 ? t.mainContact : `${t.memberNum} ${idx + 1}`}
			<div class="space-y-3 rounded-xl border border-border p-4">
				<p class="flex items-center gap-2 text-sm font-bold text-foreground">
					<span
						class="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-2xs font-bold text-primary-foreground"
						>{idx + 1}</span
					>
					{who}
				</p>

				<div class="grid gap-3 sm:grid-cols-3">
					<Form.Field {form} name={`members[${idx}].first_name`} class="space-y-1.5">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>{t.firstNameLabel} <span class="text-destructive">*</span></Form.Label>
								<Input
									{...props}
									bind:value={member.first_name}
									class="!h-11"
									placeholder={t.firstNamePlaceholder}
									autocomplete="off"
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>

					<Form.Field {form} name={`members[${idx}].last_name`} class="space-y-1.5">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>
									{t.lastNameLabel}
									<span class="text-xs font-normal text-muted-foreground">(เว้นว่างได้)</span>
								</Form.Label>
								<Input
									{...props}
									bind:value={member.last_name}
									class="!h-11"
									placeholder="เว้นว่างได้ถ้าไม่มีนามสกุล"
									autocomplete="off"
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>

					<Form.Field {form} name={`members[${idx}].gender`} class="space-y-1.5">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>{t.genderLabel} <span class="text-destructive">*</span></Form.Label>
								<Select.Root
									type="single"
									value={member.gender}
									onValueChange={(v) => ($formData.members[idx].gender = v as typeof member.gender)}
								>
									<Select.Trigger
										{...props}
										class="!h-11 w-full"
										aria-label={`${t.genderAria} ${who}`}
									>
										{GENDERS.find((g) => g.value === member.gender)?.label ??
											t.selectGenderPlaceholder}
									</Select.Trigger>
									<Select.Content>
										{#each GENDERS as option (option.value)}
											<Select.Item value={option.value} label={option.label} />
										{/each}
									</Select.Content>
								</Select.Root>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>
				</div>

				<!-- Birth Year & Age with BE/CE Toggle -->
				<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
					<div class="space-y-1.5">
						<div class="flex items-center justify-between">
							<span class="text-sm font-medium text-foreground">
								ปีเกิด ({memberEra[idx] === 'be' ? 'พ.ศ.' : 'ค.ศ.'})
								<span class="text-xs font-normal text-muted-foreground">(ถ้าทราบ)</span>
							</span>
							<div class="inline-flex rounded-lg border border-border bg-muted/20 p-0.5 text-xs">
								<button
									type="button"
									class="rounded-md px-2 py-0.5 transition-colors {memberEra[idx] === 'be'
										? 'bg-primary font-semibold text-primary-foreground shadow-xs'
										: 'text-muted-foreground hover:text-foreground'}"
									onclick={() => switchEra(idx, 'be')}
								>
									พ.ศ.
								</button>
								<button
									type="button"
									class="rounded-md px-2 py-0.5 transition-colors {memberEra[idx] === 'ce'
										? 'bg-primary font-semibold text-primary-foreground shadow-xs'
										: 'text-muted-foreground hover:text-foreground'}"
									onclick={() => switchEra(idx, 'ce')}
								>
									ค.ศ.
								</button>
							</div>
						</div>
						<Input
							inputmode="numeric"
							maxlength={4}
							placeholder={memberEra[idx] === 'be' ? 'เช่น 2530' : 'เช่น 1987'}
							value={memberYearInput[idx] ?? ''}
							oninput={(e) => handleYearInput(idx, e.currentTarget.value)}
							class="!h-11"
						/>
					</div>

					<div class="space-y-1.5">
						<span class="text-sm font-medium text-foreground">
							อายุ (ปี) <span class="text-xs font-normal text-muted-foreground"
								>(คำนวณอัตโนมัติ)</span
							>
						</span>
						<Input
							inputmode="numeric"
							maxlength={3}
							placeholder="อายุ (ปี)"
							value={memberAgeInput[idx] ?? ''}
							oninput={(e) => handleAgeInput(idx, e.currentTarget.value)}
							class="!h-11"
						/>
					</div>
				</div>

				{#if availableTags.length > 0}
					<!-- A group of checkboxes is a fieldset, not a single control: `Form.Label`
					     only works inside `Form.Control`, and using it here throws in formsnap. -->
					<Form.Fieldset {form} name={`members[${idx}].special_needs`} class="space-y-1.5">
						<Form.Legend>{t.specialNeedsLegend}</Form.Legend>
						<div class="grid gap-2 sm:grid-cols-3">
							{#each availableTags as tag (tag)}
								{@const id = `m${idx}-${tag}`}
								<label
									for={id}
									class="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-muted/40"
								>
									<Checkbox
										{id}
										aria-label="{tag} — {who}"
										checked={member.special_needs.includes(tag)}
										onCheckedChange={(v) => toggleTag(idx, tag, v === true)}
									/>
									<span class="text-foreground">{tag}</span>
								</label>
							{/each}
						</div>
						<Form.FieldErrors />
					</Form.Fieldset>
				{/if}
			</div>
		{/each}
	</section>

	<!-- ── 3. สัตว์เลี้ยง ทรัพย์สิน และยานพาหนะ ───────────────────────────── -->
	<section class="space-y-6 rounded-2xl border border-border bg-card p-5">
		<h3 class="flex items-center gap-2 text-base font-bold text-foreground">
			<span
				class="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground"
				>3</span
			>
			สัตว์เลี้ยง ทรัพย์สินมีค่า และยานพาหนะ
		</h3>

		{#if !hasShelter}
			{@render chooseShelterFirst('เพื่อดูนโยบายสัตว์เลี้ยง ทรัพย์สิน และที่จอดรถ')}
		{:else}
			<!-- 3.1 สัตว์เลี้ยง -->
			<div class="space-y-4 rounded-xl border border-border bg-muted/10 p-4">
				<div class="flex items-center gap-2">
					<PawPrint class="h-5 w-5 text-primary" />
					<h4 class="text-sm font-bold text-foreground">สัตว์เลี้ยง</h4>
				</div>

				{#if !allowPets}
					<p
						class="rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground"
					>
						🚫 ศูนย์พักพิงนี้ไม่อนุญาตให้นำสัตว์เลี้ยงเข้าพัก (ปิดรับสัตว์เลี้ยงตามนโยบายศูนย์)
					</p>
				{:else}
					<div class="grid grid-cols-2 gap-3">
						<button
							type="button"
							class="rounded-xl border-2 px-3 py-3 text-sm font-medium transition-colors {!hasPets
								? 'border-primary bg-primary/10 font-bold text-foreground'
								: 'border-border bg-card text-muted-foreground hover:border-primary/40'}"
							onclick={() => {
								hasPets = false;
								$formData.pets = [];
							}}
						>
							ไม่มีสัตว์เลี้ยง
						</button>
						<button
							type="button"
							class="rounded-xl border-2 px-3 py-3 text-sm font-medium transition-colors {hasPets
								? 'border-primary bg-primary/10 font-bold text-foreground'
								: 'border-border bg-card text-muted-foreground hover:border-primary/40'}"
							onclick={() => {
								hasPets = true;
								if ($formData.pets.length === 0) {
									adjustSpeciesCount(defaultPetSpecies || 'dog', 1);
								}
							}}
						>
							มีสัตว์เลี้ยง
						</button>
					</div>

					{#if hasPets}
						<div class="space-y-3 border-t border-border pt-4">
							<p class="text-xs font-semibold text-muted-foreground">จำนวนสัตว์เลี้ยงแต่ละประเภท</p>
							<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
								{#each effectivePetSpecies as opt (opt.code)}
									{@const count = speciesCounts[opt.code] ?? 0}
									<div
										class="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/20 px-3 py-2"
									>
										<span class="text-sm font-medium">{opt.label}</span>
										<div class="flex items-center gap-2">
											<Button
												type="button"
												variant="outline"
												size="icon"
												class="size-9 shrink-0"
												disabled={count === 0}
												onclick={() => adjustSpeciesCount(opt.code, -1)}
											>
												<Minus class="size-4" />
											</Button>
											<span class="min-w-6 text-center font-mono text-base font-bold">{count}</span>
											<Button
												type="button"
												variant="outline"
												size="icon"
												class="size-9 shrink-0"
												disabled={$formData.pets.length >= 20}
												onclick={() => adjustSpeciesCount(opt.code, 1)}
											>
												<Plus class="size-4" />
											</Button>
										</div>
									</div>
								{/each}
							</div>

							{#if $formData.pets.length > 0}
								<p class="pt-2 text-xs font-semibold text-foreground">รายละเอียดสัตว์เลี้ยง</p>
								<div class="space-y-3">
									{#each $formData.pets as pet, pIdx (pIdx)}
										{@const speciesLabel =
											effectivePetSpecies.find((s) => s.code === pet.species)?.label ?? pet.species}
										<div class="space-y-3 rounded-xl border border-border bg-background p-3.5">
											<div class="flex items-center justify-between gap-2">
												<span class="text-sm font-bold text-foreground">
													{speciesLabel} — ตัวที่ {pIdx + 1}
												</span>
												<Button
													type="button"
													variant="ghost"
													size="icon"
													class="size-8 shrink-0"
													onclick={() => removePet(pIdx)}
												>
													<X class="size-4 text-muted-foreground" />
												</Button>
											</div>
											<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
												<div class="space-y-1.5">
													<Label class="text-xs">ชื่อสัตว์เลี้ยง</Label>
													<Input
														bind:value={pet.name}
														placeholder="เช่น โกโก้, ถุงทอง"
														class="!h-10"
													/>
												</div>
												<div class="space-y-1.5">
													<Label class="text-xs">อาการ / พฤติกรรม / สุขภาพ</Label>
													<Input
														bind:value={pet.condition}
														placeholder="เช่น สุขภาพดี, ขาเจ็บ, ทำหมันแล้ว"
														class="!h-10"
													/>
												</div>
											</div>
											<label
												class="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border bg-muted/20 px-3"
											>
												<Checkbox
													checked={pet.has_cage}
													onCheckedChange={(v) => (pet.has_cage = !!v)}
													class="size-5"
												/>
												<span class="text-xs sm:text-sm">นำกรง / สายจูง / ตะกร้าติดตัวมาด้วย</span>
											</label>
										</div>
									{/each}
								</div>
							{/if}
						</div>
					{/if}
				{/if}
			</div>

			<!-- 3.2 ทรัพย์สินมีค่าพิเศษ -->
			<div class="space-y-4 rounded-xl border border-border bg-muted/10 p-4">
				<div class="flex items-center gap-2">
					<Package class="h-5 w-5 text-primary" />
					<h4 class="text-sm font-bold text-foreground">ทรัพย์สินมีค่า / สัมภาระพิเศษ</h4>
				</div>

				{#if !allowAssets}
					<p
						class="rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground"
					>
						🚫 ศูนย์พักพิงนี้ไม่เปิดรับบันทึกทรัพย์สินมีค่าพิเศษ
					</p>
				{:else}
					<div class="grid grid-cols-2 gap-3">
						<button
							type="button"
							class="rounded-xl border-2 px-3 py-3 text-sm font-medium transition-colors {!hasAssets
								? 'border-primary bg-primary/10 font-bold text-foreground'
								: 'border-border bg-card text-muted-foreground hover:border-primary/40'}"
							onclick={() => {
								hasAssets = false;
								$formData.asset_description = '';
							}}
						>
							ไม่มีทรัพย์สินพิเศษ
						</button>
						<button
							type="button"
							class="rounded-xl border-2 px-3 py-3 text-sm font-medium transition-colors {hasAssets
								? 'border-primary bg-primary/10 font-bold text-foreground'
								: 'border-border bg-card text-muted-foreground hover:border-primary/40'}"
							onclick={() => (hasAssets = true)}
						>
							มีทรัพย์สินมีค่า
						</button>
					</div>

					{#if hasAssets}
						<div class="space-y-1.5 border-t border-border pt-4">
							<Label class="text-xs">รายการทรัพย์สินมีค่าที่นำติดตัวมา</Label>
							<Input
								bind:value={$formData.asset_description}
								placeholder="ระบุ เช่น ทองคำ, โน้ตบุ๊ก, เงินสด, สมุดบัญชีธนาคาร"
								class="!h-11"
							/>
							<p class="text-2xs text-muted-foreground">
								* ผู้ประสบภัยควรเก็บรักษาทรัพย์สินไว้กับตนเอง ศูนย์พักพิงไม่มีบริการตู้นิรภัยรับฝาก
							</p>
						</div>
					{/if}
				{/if}
			</div>

			<!-- 3.3 ยานพาหนะ -->
			<div class="space-y-4 rounded-xl border border-border bg-muted/10 p-4">
				<div class="flex items-center gap-2">
					<Car class="h-5 w-5 text-primary" />
					<h4 class="text-sm font-bold text-foreground">ยานพาหนะ</h4>
				</div>

				{#if !allowVehicles}
					<p
						class="rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground"
					>
						🚫 ศูนย์พักพิงนี้ไม่มีพื้นที่จอดรถ / ไม่อนุญาตให้นำยานพาหนะมาจอด
					</p>
				{:else}
					<div class="grid grid-cols-2 gap-3">
						<button
							type="button"
							class="rounded-xl border-2 px-3 py-3 text-sm font-medium transition-colors {!hasVehicles
								? 'border-primary bg-primary/10 font-bold text-foreground'
								: 'border-border bg-card text-muted-foreground hover:border-primary/40'}"
							onclick={() => {
								hasVehicles = false;
								$formData.vehicles = [];
							}}
						>
							ไม่มีพาหนะ
						</button>
						<button
							type="button"
							class="rounded-xl border-2 px-3 py-3 text-sm font-medium transition-colors {hasVehicles
								? 'border-primary bg-primary/10 font-bold text-foreground'
								: 'border-border bg-card text-muted-foreground hover:border-primary/40'}"
							onclick={() => {
								hasVehicles = true;
								if ($formData.vehicles.length === 0) {
									addVehicle();
								}
							}}
						>
							มีพาหนะ
						</button>
					</div>

					{#if hasVehicles}
						<div class="space-y-3 border-t border-border pt-4">
							{#each $formData.vehicles as vehicle, vIdx (vIdx)}
								<div
									class="flex items-center gap-2 rounded-xl border border-border bg-background p-3"
								>
									<div class="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
										<Select.Root
											type="single"
											value={vehicle.type}
											onValueChange={(v) => {
												if (v) vehicle.type = v as typeof vehicle.type;
											}}
										>
											<Select.Trigger class="!h-10 bg-background">
												{vehicleTypeOptions.find((o) => o.value === vehicle.type)?.label ??
													'เลือกประเภท'}
											</Select.Trigger>
											<Select.Content>
												{#each vehicleTypeOptions as opt (opt.value)}
													<Select.Item value={opt.value} label={opt.label} />
												{/each}
											</Select.Content>
										</Select.Root>
										<Input
											bind:value={vehicle.license_plate}
											placeholder="ทะเบียนรถ (เช่น 1กก 1234)"
											class="!h-10"
										/>
									</div>
									<Button
										type="button"
										variant="ghost"
										size="icon"
										class="size-8 shrink-0"
										onclick={() => removeVehicle(vIdx)}
									>
										<X class="size-4 text-muted-foreground" />
									</Button>
								</div>
							{/each}
							<Button
								type="button"
								variant="outline"
								class="w-full gap-2"
								disabled={$formData.vehicles.length >= 10}
								onclick={addVehicle}
							>
								<Plus class="size-4" />
								เพิ่มยานพาหนะ
							</Button>
						</div>
					{/if}
				{/if}
			</div>

			<!-- 3.4 ยืนยันเงื่อนไขและข้อกำหนดศูนย์ (Policy Disclaimer) -->
			{#if disclaimerRequired}
				<section class="space-y-3 rounded-xl border-2 border-amber-500/40 bg-amber-500/10 p-4">
					<div class="flex items-center gap-2">
						<ShieldAlert class="size-5 text-amber-600 dark:text-amber-400" />
						<h4 class="text-sm font-bold text-foreground">
							เงื่อนไขและมาตรการความปลอดภัยของศูนย์พักพิง
						</h4>
					</div>
					<div class="space-y-3">
						{#each disclaimerGroups as group (group.label)}
							<div>
								<h5 class="mb-1 text-xs font-semibold text-foreground">{group.label}</h5>
								<ul class="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
									{#each group.items as item, i (i)}
										<li>{item}</li>
									{/each}
								</ul>
							</div>
						{/each}
					</div>
					<label
						class="flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border-2 border-amber-500/30 bg-card p-3.5"
					>
						<Checkbox
							id="disclaimer-ack"
							checked={disclaimerAcknowledged}
							onCheckedChange={(v) => (disclaimerAcknowledged = v === true)}
							class="mt-0.5 size-5 shrink-0"
						/>
						<span class="text-xs leading-relaxed font-semibold select-none sm:text-sm">
							ข้าพเจ้ารับทราบและยินยอมปฏิบัติตามเงื่อนไขและมาตรการด้านความปลอดภัยของศูนย์พักพิงทุกประการ
						</span>
					</label>
				</section>
			{/if}
		{/if}
	</section>

	{#if submitError}
		<p
			class="rounded-xl border border-danger/30 bg-danger-muted/40 p-3 text-sm text-danger"
			role="alert"
		>
			{submitError}
		</p>
	{/if}

	<Form.Button
		class="w-full"
		size="lg"
		disabled={$submitting || (disclaimerRequired && !disclaimerAcknowledged)}
	>
		{$submitting ? t.submitting : t.submitConfirm}
	</Form.Button>
</form>
