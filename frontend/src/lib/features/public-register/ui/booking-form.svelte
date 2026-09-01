<script lang="ts">
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import Car from '@lucide/svelte/icons/car';
	import Info from '@lucide/svelte/icons/info';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Minus from '@lucide/svelte/icons/minus';
	import PawPrint from '@lucide/svelte/icons/paw-print';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Users from '@lucide/svelte/icons/users';
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4, zod4Client } from 'sveltekit-superforms/adapters';
	import { env } from '$env/dynamic/public';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Form from '$lib/components/ui/form/index.js';
	import { Input } from '$lib/components/ui/input';
	import SearchSelect from '$lib/components/search-select.svelte';
	import * as Select from '$lib/components/ui/select/index.js';
	import type { PublicShelterCardModel } from '$lib/features/public-portal';
	import {
		useBookingDistricts,
		useBookingProvinces,
		useBookingSubdistricts,
		useCreateBooking,
		usePetTypes
	} from '../application/queries';
	import { isCaptchaKeyConfigured, publicBookingInputSchema } from '../domain/booking';
	import type { BookingTicket } from '../application/booking-store.svelte';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_BOOKING_FORM_I18N } from '$lib/constants/i18n';

	interface VulnerableGroup {
		code: string;
		label: string;
	}

	interface Props {
		shelters: (PublicShelterCardModel & { available: number | null })[];
		vulnerableGroups: VulnerableGroup[];
		/** Preselect and lock the shelter (opened from a shelter detail page). */
		lockedShelterCode?: string;
		onbooked: (ticket: BookingTicket) => void;
	}

	const { shelters, vulnerableGroups, lockedShelterCode = '', onbooked }: Props = $props();

	let t = $derived(getTranslation(PUBLIC_BOOKING_FORM_I18N, langState.current));

	const createBooking = useCreateBooking();
	const siteKey = env.PUBLIC_RECAPTCHA_SITE_KEY || '';
	const captchaEnabled = isCaptchaKeyConfigured(siteKey);

	let GENDERS = $derived([
		{ value: 'male', label: t.genderMale },
		{ value: 'female', label: t.genderFemale },
		{ value: 'other', label: t.genderOther }
	]) as { value: string; label: string }[];

	/**
	 * Vehicle is a single three-way choice rather than the staff form's repeatable
	 * `vehicles[]` rows: a household evacuating arrives in one thing or nothing,
	 * and "no vehicle" is by far the common answer, so it is the default and the
	 * first option. `type` still uses the closed `household.vehicles[].type` set,
	 * with the staff Thai labels — `other` is simply not offered here, since a
	 * citizen picking "อื่น ๆ" on a phone tells the parking marshal nothing.
	 */
	let VEHICLE_CHOICES = $derived([
		{ value: 'none', label: t.vehicleNone },
		{ value: 'car', label: t.vehicleCar },
		{ value: 'motorcycle', label: t.vehicleMotorcycle }
	]) as { value: string; label: string }[];

	type VehicleChoice = 'none' | 'car' | 'motorcycle';

	function blankMember() {
		return {
			first_name: '',
			last_name: '',
			gender: 'male' as const,
			special_needs: [] as string[]
		};
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

	let bringsPets = $state(false);
	let vehicleChoice = $state<VehicleChoice>('none');
	let submitError = $state('');

	/**
	 * Keep `vehicles[]` — the wire shape, mirroring `household.vehicles[]` — in
	 * step with the single choice above. The plate survives a switch between car
	 * and motorcycle (mistapping the type should not wipe what was typed) and is
	 * dropped entirely on "ไม่มีพาหนะ".
	 */
	function setVehicleChoice(choice: VehicleChoice) {
		vehicleChoice = choice;
		if (choice === 'none') {
			$formData.vehicles = [];
			return;
		}
		$formData.vehicles = [
			{ type: choice, license_plate: $formData.vehicles[0]?.license_plate ?? '' }
		];
	}

	// `CLOSED` is the only hard block (FR-72) — a full shelter stays bookable and
	// warns instead, matching the warning-only occupancy guardrail of T-51.
	const bookable = $derived(shelters.filter((s) => s.status !== 'CLOSED'));
	const selected = $derived(shelters.find((s) => s.code === $formData.shelter_code) ?? null);

	/**
	 * Which tags this shelter accepts. The shelter declares the vulnerable groups
	 * it can support (`admission_policy.supported_vulnerable_groups`), so the
	 * choices follow the selection above rather than being a fixed list — there is
	 * no point offering "ผู้ป่วยติดเตียง" at a centre that cannot take one.
	 *
	 * FastAPI sends the literal sentinel `"none"` when a shelter has no groups to
	 * offer (see `public-shelter-card.svelte`, which filters the same sentinel) —
	 * without dropping it here it would render as a tag literally labeled "none".
	 *
	 * A code with no label is dropped rather than shown as its own raw id: the
	 * shelter payload (Mongo, via the sync worker) and the label lookup
	 * (`master_data`, CouchDB) are two different stores that can be out of step —
	 * right after a seed the projection carries codes whose master-data labels
	 * have not synced yet — and a checkbox reading `item_01M…` is worse than no
	 * checkbox at all.
	 */
	const availableTags = $derived.by(() => {
		const codes = (selected?.vulnerable_groups ?? []).filter((code) => code && code !== 'none');
		if (codes.length === 0) return [];
		const byCode = new Map(vulnerableGroups.map((g) => [g.code, g.label]));
		return codes.map((code) => byCode.get(code)?.trim() ?? '').filter((label) => label.length > 0);
	});

	/**
	 * Everything in sections 2 and 3 that is *offered by the shelter* — the
	 * vulnerable-group tags and the pet species — is unanswerable until one is
	 * picked. Rather than rendering empty pickers (which read as "this shelter
	 * supports nothing"), those blocks are replaced by a prompt to choose a
	 * shelter first. Fields the citizen owns — names, gender, vehicle — stay open.
	 */
	const hasShelter = $derived(selected !== null);
	const petsAllowed = $derived(hasShelter && (selected?.pet_policy ?? null) !== 'no_pets');
	/** Section 3 covers pets too — either the shelter takes them, or we do not know yet. */
	const sectionCoversPets = $derived(petsAllowed || !hasShelter);

	/**
	 * Pet species this shelter accepts, from `master_data:pet_types` (global +
	 * shelter-local merge, CR-049) rather than a fixed list — same reasoning as
	 * `availableTags` above, but the query itself has to be reactive: unlike the
	 * vulnerable groups (loaded once by the modal before this form even mounts),
	 * which shelter to ask for pet types is a choice the citizen makes *inside*
	 * this form. `usePetTypes` keys its cache by shelter code, so switching back
	 * to a shelter already queried this session is served from cache, not refetched.
	 */
	const petTypesQuery = usePetTypes(() => selected?.code ?? '');
	const petTypes = $derived(petTypesQuery.data ?? []);

	/** The shelter's configured default species (CR-049 `is_default`), falling
	 *  back to the first offered choice — a citizen adding a pet should not have
	 *  to make a choice the shelter already told us is the common case. */
	const defaultPetSpecies = $derived(
		petTypes.find((p) => p.is_default)?.code ?? petTypes[0]?.code ?? ''
	);

	/**
	 * Domicile address cascade (CR-105) — จังหวัด → อำเภอ → ตำบล, each level
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
			$formData.members = [
				...current,
				...Array.from({ length: target - current.length }, blankMember)
			];
		} else if (target < current.length) {
			$formData.members = current.slice(0, target);
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
		try {
			const token = await captchaToken();
			if (token === null) {
				submitError = t.recaptchaError;
				toast.error(submitError);
				return;
			}

			const ticket = await createBooking.mutateAsync({
				...data,
				pets: bringsPets ? data.pets : [],
				vehicles: vehicleChoice === 'none' ? [] : data.vehicles,
				...(token ? { captchaToken: token } : {})
			});
			toast.success(t.bookingSuccess);
			// The surname is not in the response by design (see `BookingTicket`) —
			// carry over the one the contact just typed so the ticket can show a full name.
			onbooked({ ...ticket, last_name: data.members[0].last_name });
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
			Domicile address of the household head (CR-105) — the place the household
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
								<Form.Label>{t.lastNameLabel} <span class="text-destructive">*</span></Form.Label>
								<Input
									{...props}
									bind:value={member.last_name}
									class="!h-11"
									placeholder={t.lastNamePlaceholder}
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

	<!-- ── 3. สัตว์เลี้ยงและยานพาหนะ ─────────────────────────────────── -->
	<!--
		One section, two optional add-ons the household brings with it. Vehicles sit
		here rather than behind `petsAllowed`: a shelter that refuses pets still has a
		car park, and the plate is what lets staff manage it.
	-->
	<section class="space-y-4 rounded-2xl border border-border bg-card p-5">
		<h3 class="flex items-center gap-2 text-base font-bold text-foreground">
			<span
				class="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground"
				>3</span
			>
			{sectionCoversPets ? t.step3PetsTitle : t.step3VehiclesTitle}
		</h3>

		{#if petsAllowed}
			<label
				for="brings-pets"
				class="flex cursor-pointer items-center gap-2 text-sm font-medium text-foreground"
			>
				<Checkbox
					id="brings-pets"
					checked={bringsPets}
					onCheckedChange={(v) => {
						bringsPets = v === true;
						if (bringsPets && $formData.pets.length === 0) {
							$formData.pets = [{ species: defaultPetSpecies, notes: '', has_cage: false }];
						}
					}}
				/>
				<PawPrint class="h-4 w-4 text-muted-foreground" />
				{t.bringPets}
			</label>

			{#if bringsPets}
				{#each $formData.pets as pet, idx (idx)}
					<div class="space-y-3 rounded-xl border border-warning/40 bg-warning/10 p-4">
						<div class="flex items-center justify-between">
							<p class="text-sm font-bold text-foreground">{t.petNum} {idx + 1}</p>
							<Button
								type="button"
								variant="outline"
								size="xs"
								onclick={() => ($formData.pets = $formData.pets.filter((_, i) => i !== idx))}
							>
								<Trash2 class="h-3.5 w-3.5" />
								{t.removeBtn}
							</Button>
						</div>

						<div class="grid gap-3 sm:grid-cols-2">
							<Form.Field {form} name={`pets[${idx}].species`} class="space-y-1.5">
								<Form.Control>
									{#snippet children({ props })}
										<Form.Label
											>{t.petSpeciesLabel} <span class="text-destructive">*</span></Form.Label
										>
										<Select.Root
											type="single"
											value={pet.species}
											onValueChange={(v) => ($formData.pets[idx].species = v)}
										>
											<Select.Trigger
												{...props}
												class="!h-11 w-full bg-background"
												aria-label="{t.petSpeciesAria} {idx + 1}"
											>
												{petTypesQuery.isPending
													? t.loadingPetSpecies
													: (petTypes.find((s) => s.code === pet.species)?.label ??
														t.selectPlaceholder)}
											</Select.Trigger>
											<Select.Content>
												{#each petTypes as option (option.code)}
													<Select.Item
														value={option.code}
														label={option.is_default
															? `${option.label} ${t.defaultSuffix}`
															: option.label}
													/>
												{/each}
											</Select.Content>
										</Select.Root>
									{/snippet}
								</Form.Control>
								<Form.FieldErrors />
							</Form.Field>

							<Form.Field {form} name={`pets[${idx}].notes`} class="space-y-1.5">
								<Form.Control>
									{#snippet children({ props })}
										<Form.Label>{t.petDetailsLabel}</Form.Label>
										<Input
											{...props}
											bind:value={pet.notes}
											class="!h-11"
											placeholder={t.petDetailsPlaceholder}
										/>
									{/snippet}
								</Form.Control>
								<Form.FieldErrors />
							</Form.Field>
						</div>

						<label
							for="pet-cage-{idx}"
							class="flex cursor-pointer items-center gap-2 text-sm text-foreground"
						>
							<Checkbox
								id="pet-cage-{idx}"
								checked={pet.has_cage}
								onCheckedChange={(v) => (pet.has_cage = v === true)}
							/>
							{t.bringCage}
						</label>
					</div>
				{/each}

				<Button
					type="button"
					variant="outline"
					class="w-full"
					disabled={$formData.pets.length >= 20}
					onclick={() =>
						($formData.pets = [
							...$formData.pets,
							{ species: defaultPetSpecies, notes: '', has_cage: false }
						])}
				>
					<Plus class="h-4 w-4" />
					{t.addNextPet}
				</Button>
			{/if}

			<hr class="border-border" />
		{:else if !hasShelter}
			{@render chooseShelterFirst(t.petsDependOnShelter)}

			<hr class="border-border" />
		{/if}

		<fieldset class="space-y-2" aria-label={t.vehiclesBrought}>
			{#if sectionCoversPets}
				<p class="flex items-center gap-2 text-sm font-medium text-foreground">
					<Car class="h-4 w-4 text-muted-foreground" />
					{t.vehiclesBrought}
				</p>
			{/if}
			<!--
				Three short options that all fit on one row are faster to tap than a
				dropdown, and the default answer ("ไม่มีพาหนะ") stays visible without
				opening anything. Built on real `<input type="radio">` behind a styled
				label rather than ARIA-tagged buttons, so arrow-key navigation, the
				single tab stop and the exclusivity all come from the browser.
			-->
			<div class="grid grid-cols-3 gap-2">
				{#each VEHICLE_CHOICES as choice (choice.value)}
					{@const active = vehicleChoice === choice.value}
					<label
						class="flex h-11 cursor-pointer items-center justify-center rounded-lg border px-2 text-center text-xs font-semibold transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 sm:text-sm {active
							? 'border-primary bg-primary text-primary-foreground'
							: 'border-border bg-background text-muted-foreground hover:border-primary/40 hover:bg-muted/50'}"
					>
						<input
							type="radio"
							name="vehicle-choice"
							value={choice.value}
							checked={active}
							onchange={() => setVehicleChoice(choice.value as VehicleChoice)}
							class="sr-only"
						/>
						{choice.label}
					</label>
				{/each}
			</div>
		</fieldset>

		{#if vehicleChoice !== 'none'}
			<Form.Field {form} name="vehicles[0].license_plate">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label>{t.licensePlateLabel}</Form.Label>
						<Input
							{...props}
							bind:value={$formData.vehicles[0].license_plate}
							class="!h-11"
							maxlength={20}
							placeholder={t.licensePlatePlaceholder}
							autocomplete="off"
						/>
					{/snippet}
				</Form.Control>
				<Form.Description>{t.licensePlateDesc}</Form.Description>
				<Form.FieldErrors />
			</Form.Field>
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

	<Form.Button class="w-full" size="lg" disabled={$submitting}>
		{$submitting ? t.submitting : t.submitConfirm}
	</Form.Button>
</form>
