<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as RadioGroup from '$lib/components/ui/radio-group/index.js';
	import SearchSelect from '$lib/components/search-select.svelte';
	import { countriesForLanguage } from '$lib/utils/country';
	import {
		cardNumberMaxLength,
		clampCardNumber,
		type CardType,
		type Gender,
		type Religion
	} from '$lib/features/people';
	import { sanitizePhoneTyping } from '$lib/db/model';
	import {
		ageFromBirthYearBE,
		birthYearDisplayProblem,
		birthYearDisplayRange,
		currentYearBE,
		defaultBirthCalendar,
		toDisplayBirthYear,
		toPersistBirthYearBE,
		type BirthCalendar
	} from '$lib/features/people/domain/birth-calendar';
	import {
		RELIGION_UI_VALUES,
		normalizeReligionForUi
	} from '$lib/features/people/domain/religion-ui';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_BOOKING_FORM_I18N } from '$lib/constants/i18n';

	let {
		first_name = $bindable(''),
		last_name = $bindable(''),
		nickname = $bindable(),
		person_id = $bindable<{ cardType?: CardType; number?: string }>({
			cardType: 'national_id',
			number: ''
		}),
		phone = $bindable<string | null | undefined>(),
		no_phone = $bindable(false),
		birth_year = $bindable<number | string | undefined>(),
		age = $bindable<number | string | undefined>(),
		gender = $bindable<Gender | null>(null),
		religion = $bindable<Religion>('unknown'),
		/** Free text when religion is「อื่นๆ」 (CR-148). */
		religion_other = $bindable<string | null | undefined>(null),
		country = $bindable('THAILAND'),
		disabled = false,
		/** Hide「ไม่มีเบอร์」— public primary contact must enter a phone. */
		hideNoPhone = false,
		/** Public pre-register omits nickname; onsite keeps it. */
		showNickname = true,
		phoneOptional = false,
		phoneHelperText = '',
		idPrefix = '',
		errors
	}: {
		first_name?: string;
		last_name?: string;
		nickname?: string;
		person_id?: { cardType?: CardType; number?: string };
		phone?: string | null;
		no_phone?: boolean;
		birth_year?: number | string | undefined;
		age?: number | string | undefined;
		gender?: Gender | null;
		religion?: Religion;
		religion_other?: string | null;
		country?: string;
		disabled?: boolean;
		hideNoPhone?: boolean;
		showNickname?: boolean;
		phoneOptional?: boolean;
		phoneHelperText?: string;
		idPrefix?: string;
		errors?: Record<string, string | undefined>;
	} = $props();

	const t = $derived(getTranslation(PUBLIC_BOOKING_FORM_I18N, langState.current));
	const countryOptions = $derived(countriesForLanguage(langState.current));

	const errClass =
		'border-destructive focus-visible:border-destructive focus-visible:ring-destructive/20';

	function fid(name: string): string {
		return idPrefix ? `${idPrefix}-${name}` : name;
	}

	const cardTypeOptions = $derived([
		{ value: 'national_id' as const, label: t.cardTypeNationalId },
		{ value: 'passport' as const, label: t.cardTypePassport },
		{ value: 'pink_card' as const, label: t.cardTypePinkCard },
		{ value: 'other' as const, label: t.cardTypeOther },
		{ value: 'anonymous' as const, label: t.cardTypeAnonymous }
	]);

	const activeCardType = $derived(person_id.cardType ?? 'national_id');
	const cardNumberMax = $derived(cardNumberMaxLength(activeCardType));
	const isAnonymousCard = $derived(activeCardType === 'anonymous');

	/** UI options only — schema still allows `other` for legacy docs. */
	const religionOptions = $derived(
		RELIGION_UI_VALUES.map((value) => ({
			value,
			label:
				value === 'buddhist'
					? t.religionBuddhist
					: value === 'muslim'
						? t.religionMuslim
						: value === 'christian'
							? t.religionChristian
							: value === 'other'
								? t.religionOther
								: t.religionUnknown
		}))
	);

	const religionSelectValue = $derived(normalizeReligionForUi(religion));

	let calendarOverride = $state<BirthCalendar | null>(null);
	const calendar = $derived(calendarOverride ?? defaultBirthCalendar(langState.current));

	$effect(() => {
		if (hideNoPhone && no_phone) {
			no_phone = false;
		}
	});

	const beYearParsed = $derived.by(() => {
		const raw = birth_year;
		const parsed =
			typeof raw === 'string'
				? Number.parseInt(raw, 10)
				: typeof raw === 'number'
					? raw
					: Number.NaN;
		return Number.isFinite(parsed) ? parsed : null;
	});

	const displayBirthYear = $derived(
		beYearParsed == null ? '' : String(toDisplayBirthYear(beYearParsed, calendar))
	);

	// CR-148 FR-07: speak in the calendar the user is typing in, not always พ.ศ.
	const birthYearError = $derived.by(() => {
		const schemaError = errors?.birthYear ?? errors?.birth_year;
		if (!schemaError) return '';
		const problem = birthYearDisplayProblem(displayBirthYear, calendar);
		if (problem === 'digits') return t.birthYearDigitsError;
		if (problem === 'range') {
			const { min, max } = birthYearDisplayRange(calendar);
			return (calendar === 'BE' ? t.birthYearRangeErrorBE : t.birthYearRangeErrorCE)
				.replace('{min}', String(min))
				.replace('{max}', String(max));
		}
		return schemaError;
	});

	function digits(value: string): string {
		return value.replace(/\D/g, '');
	}

	function setCalendar(next: BirthCalendar) {
		calendarOverride = next;
	}

	function updateAge(value: string) {
		const clean = digits(value).slice(0, 3);
		age = clean;
		const parsed = Number.parseInt(clean, 10);
		if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 150) {
			birth_year = String(currentYearBE() - parsed);
		}
	}

	function updateBirthYearDisplay(value: string) {
		const clean = digits(value).slice(0, 4);
		if (!clean) {
			birth_year = '';
			return;
		}
		const display = Number.parseInt(clean, 10);
		if (!Number.isFinite(display)) {
			birth_year = clean;
			return;
		}
		const be = toPersistBirthYearBE(display, calendar);
		birth_year = String(be);
		if (be <= currentYearBE()) {
			const calculatedAge = ageFromBirthYearBE(be);
			if (calculatedAge >= 0 && calculatedAge <= 150) {
				age = String(calculatedAge);
			}
		}
	}

	function onCardNumberInput(e: Event) {
		const target = e.currentTarget as HTMLInputElement;
		person_id.number = clampCardNumber(activeCardType, target.value);
	}

	function onPhoneInput(e: Event) {
		const target = e.currentTarget as HTMLInputElement;
		phone = sanitizePhoneTyping(target.value);
	}

	const showMononymHint = $derived(
		country !== 'THAILAND' || (person_id.cardType != null && person_id.cardType !== 'national_id')
	);

	/**
	 * Radio sentinel for `gender: null` (ไม่ระบุเพศ). Legacy `'other'` also renders as selected
	 * ไม่ระบุ but is NOT rewritten — `gender` only changes on the user's own pick (decision sync
	 * 2026-10-09).
	 */
	const GENDER_UNSPECIFIED = 'unspecified';
	const genderRadioValue = $derived(
		gender === 'male' || gender === 'female' ? gender : GENDER_UNSPECIFIED
	);
</script>

<div class="space-y-4">
	<!-- Name & Surname — stack full-width on mobile (M10) -->
	<div class="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3">
		<div class="space-y-1.5">
			<Label for={fid('first-name')} class="text-xs font-semibold text-foreground">
				{t.firstNameLabel} <span class="text-destructive">*</span>
			</Label>
			<Input
				id={fid('first-name')}
				bind:value={first_name}
				{disabled}
				autocomplete="given-name"
				placeholder={showMononymHint ? t.firstNamePlaceholderFull : t.firstNamePlaceholderGiven}
				aria-invalid={!!(errors?.first_name || errors?.firstName)}
				aria-describedby={errors?.first_name || errors?.firstName
					? fid('first-name-error')
					: undefined}
				class="h-11 min-h-11 sm:h-9 sm:min-h-9 {errors?.first_name || errors?.firstName
					? errClass
					: ''}"
			/>
			{#if errors?.first_name || errors?.firstName}
				<p id={fid('first-name-error')} class="text-2xs text-destructive">
					{errors?.first_name ?? errors?.firstName}
				</p>
			{/if}
		</div>

		<div class="space-y-1.5">
			<Label for={fid('last-name')} class="text-xs font-semibold text-foreground"
				>{t.lastNameLabel}</Label
			>
			<Input
				id={fid('last-name')}
				bind:value={last_name}
				{disabled}
				autocomplete="family-name"
				placeholder={showMononymHint ? t.lastNamePlaceholderOptional : t.lastNamePlaceholder}
				aria-invalid={!!(errors?.last_name || errors?.lastName)}
				aria-describedby={errors?.last_name || errors?.lastName
					? fid('last-name-error')
					: undefined}
				class="h-11 min-h-11 sm:h-9 sm:min-h-9 {errors?.last_name || errors?.lastName
					? errClass
					: ''}"
			/>
			{#if errors?.last_name || errors?.lastName}
				<p id={fid('last-name-error')} class="text-2xs text-destructive">
					{errors?.last_name ?? errors?.lastName}
				</p>
			{/if}
		</div>
	</div>
	{#if showMononymHint}
		<p class="text-2xs text-muted-foreground">{t.mononymHint}</p>
	{/if}

	{#if showNickname}
		<!-- Nickname -->
		<div class="space-y-1.5">
			<Label for={fid('nickname')} class="text-xs font-semibold text-foreground"
				>{t.nicknameLabel}</Label
			>
			<Input
				id={fid('nickname')}
				bind:value={nickname}
				{disabled}
				placeholder={t.nicknamePlaceholder}
				aria-invalid={!!errors?.nickname}
				aria-describedby={errors?.nickname ? fid('nickname-error') : undefined}
				class="h-11 min-h-11 sm:h-9 sm:min-h-9 {errors?.nickname ? errClass : ''}"
			/>
			{#if errors?.nickname}
				<p id={fid('nickname-error')} class="text-2xs text-destructive">{errors.nickname}</p>
			{/if}
		</div>
	{/if}

	<!-- Identity Document -->
	<div class="grid gap-3 sm:grid-cols-2">
		<div class="space-y-1.5">
			<Label class="text-xs font-semibold text-foreground">{t.cardTypeLabel}</Label>
			<Select.Root
				type="single"
				value={activeCardType}
				onValueChange={(val) => {
					if (
						val === 'national_id' ||
						val === 'passport' ||
						val === 'pink_card' ||
						val === 'other' ||
						val === 'anonymous'
					) {
						person_id.cardType = val;
						if (val === 'anonymous') {
							person_id.number = '';
						} else if (person_id.number) {
							person_id.number = clampCardNumber(val, person_id.number);
						}
					}
				}}
				{disabled}
			>
				<Select.Trigger class="!h-11 w-full rounded-md text-sm sm:!h-9">
					{cardTypeOptions.find((o) => o.value === activeCardType)?.label ?? t.cardTypeNationalId}
				</Select.Trigger>
				<Select.Content>
					{#each cardTypeOptions as opt (opt.value)}
						<Select.Item value={opt.value} label={opt.label} />
					{/each}
				</Select.Content>
			</Select.Root>
		</div>

		<div class="space-y-1.5">
			<Label for={fid('card-number')} class="text-xs font-semibold text-foreground"
				>{t.cardNumberLabel}</Label
			>
			{#if isAnonymousCard}
				<p
					id={fid('card-number')}
					class="flex h-11 min-h-11 items-center rounded-md border border-dashed border-border bg-muted/40 px-3 text-sm text-muted-foreground sm:h-9 sm:min-h-9"
				>
					{t.cardNumberAnonymousHint}
				</p>
			{:else}
				<Input
					id={fid('card-number')}
					value={person_id.number ?? ''}
					oninput={onCardNumberInput}
					{disabled}
					maxlength={cardNumberMax}
					inputmode={activeCardType === 'national_id' ? 'numeric' : 'text'}
					placeholder={activeCardType === 'national_id'
						? t.cardNumberPlaceholderNational
						: t.cardNumberPlaceholderOther}
					aria-invalid={!!(errors?.cardNumber || errors?.number || errors?.person_id)}
					aria-describedby={errors?.cardNumber || errors?.number || errors?.person_id
						? fid('card-number-error')
						: undefined}
					class="h-11 min-h-11 sm:h-9 sm:min-h-9 {errors?.cardNumber ||
					errors?.number ||
					errors?.person_id
						? errClass
						: ''}"
				/>
			{/if}
			{#if errors?.cardNumber || errors?.number || errors?.person_id}
				<p id={fid('card-number-error')} class="text-2xs text-destructive">
					{errors.cardNumber ?? errors.number ?? errors.person_id}
				</p>
			{/if}
		</div>
	</div>

	<!-- Birth Year & Age stack on mobile (M10); Gender full-row ≥44px (M2) -->
	<div class="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
		<div class="flex flex-col gap-1.5">
			<div class="flex min-h-7 items-center justify-between gap-1 sm:gap-2">
				<Label for={fid('birth-year')} class="truncate text-xs font-semibold text-foreground">
					{calendar === 'BE' ? t.birthYearLabelBE : t.birthYearLabelCE}
				</Label>
				<div
					class="inline-flex shrink-0 rounded-md border border-border p-0.5"
					role="group"
					aria-label={t.calendarToggleAria}
				>
					<button
						type="button"
						{disabled}
						class="rounded px-1.5 py-0.5 text-xs font-semibold transition-colors sm:px-2 {calendar ===
						'BE'
							? 'bg-primary text-primary-foreground'
							: 'text-muted-foreground hover:text-foreground'}"
						aria-pressed={calendar === 'BE'}
						onclick={() => setCalendar('BE')}
					>
						{t.calendarBE}
					</button>
					<button
						type="button"
						{disabled}
						class="rounded px-1.5 py-0.5 text-xs font-semibold transition-colors sm:px-2 {calendar ===
						'CE'
							? 'bg-primary text-primary-foreground'
							: 'text-muted-foreground hover:text-foreground'}"
						aria-pressed={calendar === 'CE'}
						onclick={() => setCalendar('CE')}
					>
						{t.calendarCE}
					</button>
				</div>
			</div>
			<Input
				id={fid('birth-year')}
				value={displayBirthYear}
				oninput={(e) => updateBirthYearDisplay((e.currentTarget as HTMLInputElement).value)}
				{disabled}
				inputmode="numeric"
				maxlength={4}
				placeholder={calendar === 'BE' ? t.birthYearPlaceholderBE : t.birthYearPlaceholderCE}
				aria-invalid={!!birthYearError}
				aria-describedby={birthYearError ? fid('birth-year-error') : undefined}
				class="h-11 min-h-11 sm:h-9 sm:min-h-9 {birthYearError ? errClass : ''}"
			/>
			{#if birthYearError}
				<p id={fid('birth-year-error')} class="text-2xs text-destructive">{birthYearError}</p>
			{/if}
		</div>

		<div class="flex flex-col gap-1.5">
			<div class="flex min-h-7 items-center">
				<Label for={fid('age')} class="text-xs font-semibold text-foreground">{t.ageLabel}</Label>
			</div>
			<Input
				id={fid('age')}
				value={age ?? ''}
				oninput={(e) => updateAge((e.currentTarget as HTMLInputElement).value)}
				{disabled}
				inputmode="numeric"
				placeholder={t.agePlaceholder}
				aria-invalid={!!errors?.age}
				aria-describedby={errors?.age ? fid('age-error') : undefined}
				class="h-11 min-h-11 sm:h-9 sm:min-h-9 {errors?.age ? errClass : ''}"
			/>
			{#if errors?.age}
				<p id={fid('age-error')} class="text-2xs text-destructive">{errors.age}</p>
			{/if}
		</div>

		<div class="flex flex-col gap-1.5">
			<div class="flex min-h-7 items-center">
				<Label class="text-xs font-semibold text-foreground" id={fid('gender-label')}>
					{t.genderLabel}
				</Label>
			</div>
			<RadioGroup.Root
				value={genderRadioValue}
				onValueChange={(val) => {
					if (val === 'male' || val === 'female') {
						gender = val;
					} else {
						gender = null;
					}
				}}
				{disabled}
				aria-labelledby={fid('gender-label')}
				aria-invalid={!!errors?.gender}
				aria-describedby={errors?.gender ? fid('gender-error') : undefined}
				class="grid grid-cols-3 gap-2"
			>
				<label
					class="flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-md border border-border px-2 py-2 text-sm sm:px-3 {genderRadioValue ===
					'male'
						? 'border-primary bg-primary/5 font-semibold'
						: ''} {disabled ? 'pointer-events-none opacity-60' : ''}"
					for={fid('gender-male')}
				>
					<RadioGroup.Item value="male" id={fid('gender-male')} class="size-4 shrink-0" />
					{t.genderMale}
				</label>
				<label
					class="flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-md border border-border px-2 py-2 text-sm sm:px-3 {genderRadioValue ===
					'female'
						? 'border-primary bg-primary/5 font-semibold'
						: ''} {disabled ? 'pointer-events-none opacity-60' : ''}"
					for={fid('gender-female')}
				>
					<RadioGroup.Item value="female" id={fid('gender-female')} class="size-4 shrink-0" />
					{t.genderFemale}
				</label>
				<label
					class="flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-md border border-border px-2 py-2 text-sm sm:px-3 {genderRadioValue ===
					GENDER_UNSPECIFIED
						? 'border-primary bg-primary/5 font-semibold'
						: ''} {disabled ? 'pointer-events-none opacity-60' : ''}"
					for={fid('gender-unspecified')}
				>
					<RadioGroup.Item
						value={GENDER_UNSPECIFIED}
						id={fid('gender-unspecified')}
						class="size-4 shrink-0"
					/>
					<span class="leading-tight">{t.genderUnspecified}</span>
				</label>
			</RadioGroup.Root>
			{#if errors?.gender}
				<p id={fid('gender-error')} class="text-2xs text-destructive">{errors.gender}</p>
			{/if}
		</div>
	</div>

	<!-- Nationality & Religion -->
	<div class="grid gap-3 sm:grid-cols-2">
		<div class="space-y-1.5">
			<Label for={fid('country')} class="text-xs font-semibold text-foreground">
				{t.countryLabel} <span class="text-destructive">*</span>
			</Label>
			<SearchSelect
				name={fid('country')}
				options={countryOptions}
				bind:value={country}
				placeholder={t.countryPlaceholder}
				searchPlaceholder={t.countrySearch}
				emptyText={t.countryEmpty}
				{disabled}
				class="!h-11 rounded-md text-sm sm:!h-9 {errors?.country ? errClass : ''}"
				controlProps={{
					id: fid('country'),
					'aria-invalid': !!errors?.country,
					'aria-describedby': errors?.country ? fid('country-error') : undefined
				}}
			/>
			{#if errors?.country}
				<p id={fid('country-error')} class="text-2xs text-destructive">{errors.country}</p>
			{/if}
		</div>

		<div class="space-y-1.5">
			<Label class="text-xs font-semibold text-foreground">{t.religionLabel}</Label>
			<Select.Root
				type="single"
				value={religionSelectValue}
				onValueChange={(val) => {
					if ((RELIGION_UI_VALUES as readonly string[]).includes(val)) {
						religion = val as (typeof RELIGION_UI_VALUES)[number];
						if (val !== 'other') religion_other = null;
					}
				}}
				{disabled}
			>
				<Select.Trigger class="!h-11 w-full rounded-md text-sm sm:!h-9">
					{religionOptions.find((o) => o.value === religionSelectValue)?.label ?? t.religionUnknown}
				</Select.Trigger>
				<Select.Content>
					{#each religionOptions as opt (opt.value)}
						<Select.Item value={opt.value} label={opt.label} />
					{/each}
				</Select.Content>
			</Select.Root>
			{#if religionSelectValue === 'other'}
				<Label for={fid('religion-other')} class="sr-only">{t.religionOtherLabel}</Label>
				<Input
					id={fid('religion-other')}
					value={religion_other ?? ''}
					oninput={(e) => (religion_other = (e.currentTarget as HTMLInputElement).value)}
					{disabled}
					maxlength={60}
					placeholder={t.religionOtherPlaceholder}
					aria-invalid={!!errors?.religion_other}
					aria-describedby={errors?.religion_other ? fid('religion-other-error') : undefined}
					class="h-11 min-h-11 sm:h-9 sm:min-h-9 {errors?.religion_other ? errClass : ''}"
				/>
				{#if errors?.religion_other}
					<p id={fid('religion-other-error')} class="text-2xs text-destructive">
						{errors.religion_other}
					</p>
				{/if}
			{/if}
		</div>
	</div>

	<!-- Phone -->
	<div class="space-y-2">
		<div class="space-y-1.5">
			<Label for={fid('phone')} class="text-xs font-semibold text-foreground">
				{t.phoneFieldLabel}
				{#if phoneOptional}
					<span class="text-2xs font-normal text-muted-foreground">(ทางเลือก)</span>
				{:else if !no_phone || hideNoPhone}
					<span class="text-destructive">*</span>
				{/if}
			</Label>
			<Input
				id={fid('phone')}
				value={phone}
				oninput={onPhoneInput}
				disabled={disabled || (!hideNoPhone && no_phone)}
				inputmode="tel"
				maxlength={15}
				autocomplete="tel"
				placeholder={t.phonePlaceholder}
				aria-invalid={!!errors?.phone}
				aria-describedby={errors?.phone ? fid('phone-error') : undefined}
				class="h-11 min-h-11 sm:h-9 sm:min-h-9 {errors?.phone ? errClass : ''}"
			/>
			{#if phoneHelperText}
				<p class="text-2xs text-muted-foreground">{phoneHelperText}</p>
			{:else if !no_phone}
				<p class="text-2xs text-muted-foreground">{t.phoneIntlHint}</p>
			{/if}
			{#if errors?.phone}
				<p id={fid('phone-error')} class="text-2xs text-destructive">{errors.phone}</p>
			{/if}
		</div>

		{#if !hideNoPhone}
			<div class="flex items-center gap-2">
				<Checkbox
					id={fid('no-phone')}
					checked={no_phone}
					onCheckedChange={(checked) => {
						no_phone = !!checked;
						if (no_phone) phone = '';
					}}
					{disabled}
				/>
				<Label
					for={fid('no-phone')}
					class="cursor-pointer text-xs font-medium text-muted-foreground"
				>
					{t.noPhone}
				</Label>
			</div>
		{/if}
	</div>
</div>
