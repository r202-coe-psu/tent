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
	import {
		ageFromBirthYearBE,
		currentYearBE,
		defaultBirthCalendar,
		toDisplayBirthYear,
		toPersistBirthYearBE,
		type BirthCalendar
	} from '$lib/features/people/domain/birth-calendar';
	import { RELIGION_UI_VALUES, normalizeReligionForUi } from '$lib/features/people/domain/religion-ui';
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
		gender = $bindable<Gender | ''>(''),
		religion = $bindable<Religion>('unknown'),
		country = $bindable('THAILAND'),
		disabled = false,
		/** Hide「ไม่มีเบอร์」— public primary contact must enter a phone. */
		hideNoPhone = false,
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
		gender?: Gender | '';
		religion?: Religion;
		country?: string;
		disabled?: boolean;
		hideNoPhone?: boolean;
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
		phone = digits(target.value).slice(0, 10);
	}

	const showMononymHint = $derived(
		country !== 'THAILAND' || (person_id.cardType != null && person_id.cardType !== 'national_id')
	);

	const genderRadioValue = $derived(gender === 'male' || gender === 'female' ? gender : '');
</script>

<div class="space-y-4">
	<!-- Name & Surname -->
	<div class="grid gap-3 sm:grid-cols-2">
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
				class="h-9 {errors?.first_name || errors?.firstName ? errClass : ''}"
			/>
			{#if errors?.first_name || errors?.firstName}
				<p class="text-2xs text-destructive">{errors?.first_name ?? errors?.firstName}</p>
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
				class="h-9 {errors?.last_name || errors?.lastName ? errClass : ''}"
			/>
			{#if errors?.last_name || errors?.lastName}
				<p class="text-2xs text-destructive">{errors?.last_name ?? errors?.lastName}</p>
			{/if}
		</div>
	</div>
	{#if showMononymHint}
		<p class="text-2xs text-muted-foreground">{t.mononymHint}</p>
	{/if}

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
			class="h-9 {errors?.nickname ? errClass : ''}"
		/>
		{#if errors?.nickname}
			<p class="text-2xs text-destructive">{errors.nickname}</p>
		{/if}
	</div>

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
				<Select.Trigger class="!h-9 w-full rounded-md text-xs">
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
					class="flex h-9 items-center rounded-md border border-dashed border-border bg-muted/40 px-3 text-xs text-muted-foreground"
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
					aria-invalid={!!(errors?.cardNumber || errors?.number)}
					class="h-9 {errors?.cardNumber || errors?.number ? errClass : ''}"
				/>
			{/if}
			{#if errors?.cardNumber || errors?.number}
				<p class="text-2xs text-destructive">{errors.cardNumber ?? errors.number}</p>
			{/if}
		</div>
	</div>

	<!-- Birth Year, Age, Gender -->
	<div class="grid gap-3 sm:grid-cols-3">
		<div class="space-y-1.5">
			<div class="flex items-center justify-between gap-2">
				<Label for={fid('birth-year')} class="text-xs font-semibold text-foreground">
					{calendar === 'BE' ? t.birthYearLabelBE : t.birthYearLabelCE}
				</Label>
				<div
					class="inline-flex rounded-md border border-border p-0.5"
					role="group"
					aria-label={t.calendarToggleAria}
				>
					<button
						type="button"
						disabled={disabled}
						class="rounded px-1.5 py-0.5 text-2xs font-semibold transition-colors {calendar ===
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
						disabled={disabled}
						class="rounded px-1.5 py-0.5 text-2xs font-semibold transition-colors {calendar ===
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
				placeholder={calendar === 'BE' ? t.birthYearPlaceholderBE : t.birthYearPlaceholderCE}
				aria-invalid={!!(errors?.birthYear || errors?.birth_year)}
				class="h-9 {errors?.birthYear || errors?.birth_year ? errClass : ''}"
			/>
			{#if errors?.birthYear || errors?.birth_year}
				<p class="text-2xs text-destructive">{errors.birthYear ?? errors.birth_year}</p>
			{/if}
		</div>

		<div class="space-y-1.5">
			<Label for={fid('age')} class="text-xs font-semibold text-foreground">{t.ageLabel}</Label>
			<Input
				id={fid('age')}
				value={age ?? ''}
				oninput={(e) => updateAge((e.currentTarget as HTMLInputElement).value)}
				{disabled}
				inputmode="numeric"
				placeholder={t.agePlaceholder}
				aria-invalid={!!errors?.age}
				class="h-9 {errors?.age ? errClass : ''}"
			/>
			{#if errors?.age}
				<p class="text-2xs text-destructive">{errors.age}</p>
			{/if}
		</div>

		<div class="space-y-1.5">
			<Label class="text-xs font-semibold text-foreground" id={fid('gender-label')}>
				{t.genderLabel} <span class="text-destructive">*</span>
			</Label>
			<RadioGroup.Root
				value={genderRadioValue}
				onValueChange={(val) => {
					if (val === 'male' || val === 'female') {
						gender = val;
					}
				}}
				{disabled}
				aria-labelledby={fid('gender-label')}
				aria-invalid={!!errors?.gender}
				class="flex flex-wrap gap-3 pt-1"
			>
				<label
					class="flex min-h-9 cursor-pointer items-center gap-2 rounded-md border border-border px-3 text-xs {genderRadioValue ===
					'male'
						? 'border-primary bg-primary/5 font-semibold'
						: ''} {disabled ? 'pointer-events-none opacity-60' : ''}"
					for={fid('gender-male')}
				>
					<RadioGroup.Item value="male" id={fid('gender-male')} class="size-4" />
					{t.genderMale}
				</label>
				<label
					class="flex min-h-9 cursor-pointer items-center gap-2 rounded-md border border-border px-3 text-xs {genderRadioValue ===
					'female'
						? 'border-primary bg-primary/5 font-semibold'
						: ''} {disabled ? 'pointer-events-none opacity-60' : ''}"
					for={fid('gender-female')}
				>
					<RadioGroup.Item value="female" id={fid('gender-female')} class="size-4" />
					{t.genderFemale}
				</label>
			</RadioGroup.Root>
			{#if errors?.gender}
				<p class="text-2xs text-destructive">{errors.gender}</p>
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
				class="!h-9 rounded-md text-xs {errors?.country ? errClass : ''}"
				controlProps={{ id: fid('country'), 'aria-invalid': !!errors?.country }}
			/>
			{#if errors?.country}
				<p class="text-2xs text-destructive">{errors.country}</p>
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
					}
				}}
				{disabled}
			>
				<Select.Trigger class="!h-9 w-full rounded-md text-xs">
					{religionOptions.find((o) => o.value === religionSelectValue)?.label ??
						t.religionUnknown}
				</Select.Trigger>
				<Select.Content>
					{#each religionOptions as opt (opt.value)}
						<Select.Item value={opt.value} label={opt.label} />
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
	</div>

	<!-- Phone -->
	<div class="space-y-2">
		<div class="space-y-1.5">
			<Label for={fid('phone')} class="text-xs font-semibold text-foreground">
				{t.phoneFieldLabel}
				{#if !no_phone || hideNoPhone}<span class="text-destructive">*</span>{/if}
			</Label>
			<Input
				id={fid('phone')}
				value={phone}
				oninput={onPhoneInput}
				disabled={disabled || (!hideNoPhone && no_phone)}
				inputmode="numeric"
				maxlength={10}
				autocomplete="tel"
				placeholder={t.phonePlaceholder}
				aria-invalid={!!errors?.phone}
				class="h-9 {errors?.phone ? errClass : ''}"
			/>
			{#if errors?.phone}
				<p class="text-2xs text-destructive">{errors.phone}</p>
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
				<Label for={fid('no-phone')} class="cursor-pointer text-xs text-muted-foreground">
					{t.noPhone}
				</Label>
			</div>
		{/if}
	</div>
</div>
