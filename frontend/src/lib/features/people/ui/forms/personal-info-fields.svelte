<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import SearchSelect from '$lib/components/search-select.svelte';
	import { COUNTRIES } from '$lib/utils/country';
	import type { CardType, Gender, Religion } from '$lib/features/people';

	let {
		first_name = $bindable(''),
		last_name = $bindable(''),
		nickname = $bindable(''),
		person_id = $bindable<{ cardType?: CardType; number?: string }>({
			cardType: 'national_id',
			number: ''
		}),
		phone = $bindable<string | null | undefined>(''),
		no_phone = $bindable(false),
		birth_year = $bindable<number | string | undefined>(''),
		age = $bindable<number | string | undefined>(''),
		gender = $bindable<Gender>('other'),
		religion = $bindable<Religion>('unknown'),
		country = $bindable('THAILAND'),
		disabled = false,
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
		gender?: Gender;
		religion?: Religion;
		country?: string;
		disabled?: boolean;
		errors?: Record<string, string | undefined>;
	} = $props();

	const errClass =
		'border-destructive focus-visible:border-destructive focus-visible:ring-destructive/20';

	const cardTypeOptions: { value: CardType; label: string }[] = [
		{ value: 'national_id', label: 'เลขประจำตัวประชาชน' },
		{ value: 'passport', label: 'หนังสือเดินทาง' },
		{ value: 'pink_card', label: 'บัตรประจำตัวคนซึ่งไม่มีสัญชาติไทย' },
		{ value: 'other', label: 'บัตรประเภทอื่น' }
	];

	const genderOptions: { value: Gender; label: string }[] = [
		{ value: 'male', label: 'ชาย' },
		{ value: 'female', label: 'หญิง' },
		{ value: 'other', label: 'อื่นๆ' }
	];

	const religionOptions: { value: Religion; label: string }[] = [
		{ value: 'buddhist', label: 'พุทธ' },
		{ value: 'muslim', label: 'อิสลาม' },
		{ value: 'christian', label: 'คริสต์' },
		{ value: 'other', label: 'อื่นๆ' },
		{ value: 'unknown', label: 'ไม่ระบุ' }
	];

	const currentYearBE = new Date().getFullYear() + 543;

	function digits(value: string): string {
		return value.replace(/\D/g, '');
	}

	function updateAge(value: string) {
		const clean = digits(value).slice(0, 3);
		age = clean;
		const parsed = Number.parseInt(clean, 10);
		if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 150) {
			birth_year = String(currentYearBE - parsed);
		}
	}

	function updateBirthYear(value: string) {
		const clean = digits(value).slice(0, 4);
		birth_year = clean;
		const parsed = Number.parseInt(clean, 10);
		if (Number.isFinite(parsed) && parsed <= currentYearBE) {
			const calculatedAge = currentYearBE - parsed;
			if (calculatedAge >= 0 && calculatedAge <= 150) {
				age = String(calculatedAge);
			}
		}
	}

	function onCardNumberInput(e: Event) {
		const target = e.currentTarget as HTMLInputElement;
		if (person_id.cardType === 'national_id') {
			person_id.number = digits(target.value).slice(0, 13);
		} else {
			person_id.number = target.value;
		}
	}

	function onPhoneInput(e: Event) {
		const target = e.currentTarget as HTMLInputElement;
		phone = digits(target.value).slice(0, 10);
	}

	const showMononymHint = $derived(
		country !== 'THAILAND' || (person_id.cardType != null && person_id.cardType !== 'national_id')
	);
</script>

<div class="space-y-4">
	<!-- Name & Surname -->
	<div class="grid gap-3 sm:grid-cols-2">
		<div class="space-y-1.5">
			<Label for="first-name" class="text-xs font-semibold text-foreground">
				ชื่อ <span class="text-destructive">*</span>
			</Label>
			<Input
				id="first-name"
				bind:value={first_name}
				{disabled}
				autocomplete="given-name"
				placeholder={showMononymHint ? 'ชื่อเต็มตามเอกสาร' : 'ชื่อจริง'}
				aria-invalid={!!(errors?.first_name || errors?.firstName)}
				class="h-9 {errors?.first_name || errors?.firstName ? errClass : ''}"
			/>
			{#if errors?.first_name || errors?.firstName}
				<p class="text-2xs text-destructive">{errors?.first_name ?? errors?.firstName}</p>
			{/if}
		</div>

		<div class="space-y-1.5">
			<Label for="last-name" class="text-xs font-semibold text-foreground">นามสกุล</Label>
			<Input
				id="last-name"
				bind:value={last_name}
				{disabled}
				autocomplete="family-name"
				placeholder={showMononymHint ? 'เว้นว่างได้ถ้าไม่มีนามสกุล' : 'นามสกุล'}
				aria-invalid={!!(errors?.last_name || errors?.lastName)}
				class="h-9 {errors?.last_name || errors?.lastName ? errClass : ''}"
			/>
			{#if errors?.last_name || errors?.lastName}
				<p class="text-2xs text-destructive">{errors?.last_name ?? errors?.lastName}</p>
			{/if}
		</div>
	</div>
	{#if showMononymHint}
		<p class="text-2xs text-muted-foreground">
			ถ้าไม่มีนามสกุล ใส่ชื่อเต็มในช่องชื่อ และเว้นนามสกุลได้
		</p>
	{/if}

	<!-- Nickname -->
	<div class="space-y-1.5">
		<Label for="nickname" class="text-xs font-semibold text-foreground">ชื่อเล่น</Label>
		<Input
			id="nickname"
			bind:value={nickname}
			{disabled}
			placeholder="ชื่อเล่น (ถ้ามี)"
			aria-invalid={!!errors?.nickname}
			class="h-9 {errors?.nickname ? errClass : ''}"
		/>
		{#if errors?.nickname}
			<p class="text-2xs text-destructive">{errors.nickname}</p>
		{/if}
	</div>

	<!-- Identity Document (Card Type and Number) -->
	<div class="grid gap-3 sm:grid-cols-2">
		<div class="space-y-1.5">
			<Label class="text-xs font-semibold text-foreground">ประเภทบัตรประจำตัว</Label>
			<Select.Root
				type="single"
				value={person_id.cardType ?? 'national_id'}
				onValueChange={(val) => {
					if (
						val === 'national_id' ||
						val === 'passport' ||
						val === 'pink_card' ||
						val === 'other'
					) {
						person_id.cardType = val;
					}
				}}
				{disabled}
			>
				<Select.Trigger class="!h-9 w-full rounded-md text-xs">
					{cardTypeOptions.find((o) => o.value === person_id.cardType)?.label ??
						'เลขประจำตัวประชาชน'}
				</Select.Trigger>
				<Select.Content>
					{#each cardTypeOptions as opt (opt.value)}
						<Select.Item value={opt.value} label={opt.label} />
					{/each}
				</Select.Content>
			</Select.Root>
		</div>

		<div class="space-y-1.5">
			<Label for="card-number" class="text-xs font-semibold text-foreground"
				>เลขที่บัตรประจำตัว</Label
			>
			<Input
				id="card-number"
				value={person_id.number ?? ''}
				oninput={onCardNumberInput}
				{disabled}
				inputmode={person_id.cardType === 'national_id' ? 'numeric' : 'text'}
				placeholder={person_id.cardType === 'national_id' ? 'เลข 13 หลัก' : 'เลขที่บัตรประจำตัว'}
				aria-invalid={!!(errors?.cardNumber || errors?.number)}
				class="h-9 {errors?.cardNumber || errors?.number ? errClass : ''}"
			/>
			{#if errors?.cardNumber || errors?.number}
				<p class="text-2xs text-destructive">{errors.cardNumber ?? errors.number}</p>
			{/if}
		</div>
	</div>

	<!-- Birth Year, Age, Gender -->
	<div class="grid gap-3 sm:grid-cols-3">
		<div class="space-y-1.5">
			<Label for="birth-year" class="text-xs font-semibold text-foreground">ปีเกิด (พ.ศ.)</Label>
			<Input
				id="birth-year"
				value={birth_year ?? ''}
				oninput={(e) => updateBirthYear((e.currentTarget as HTMLInputElement).value)}
				{disabled}
				inputmode="numeric"
				placeholder="เช่น 2535"
				aria-invalid={!!(errors?.birthYear || errors?.birth_year)}
				class="h-9 {errors?.birthYear || errors?.birth_year ? errClass : ''}"
			/>
			{#if errors?.birthYear || errors?.birth_year}
				<p class="text-2xs text-destructive">{errors.birthYear ?? errors.birth_year}</p>
			{/if}
		</div>

		<div class="space-y-1.5">
			<Label for="age" class="text-xs font-semibold text-foreground">อายุ (ปี)</Label>
			<Input
				id="age"
				value={age ?? ''}
				oninput={(e) => updateAge((e.currentTarget as HTMLInputElement).value)}
				{disabled}
				inputmode="numeric"
				placeholder="เช่น 35"
				aria-invalid={!!errors?.age}
				class="h-9 {errors?.age ? errClass : ''}"
			/>
			{#if errors?.age}
				<p class="text-2xs text-destructive">{errors.age}</p>
			{/if}
		</div>

		<div class="space-y-1.5">
			<Label class="text-xs font-semibold text-foreground">
				เพศ <span class="text-destructive">*</span>
			</Label>
			<Select.Root
				type="single"
				value={gender}
				onValueChange={(val) => {
					if (val === 'male' || val === 'female' || val === 'other') {
						gender = val;
					}
				}}
				{disabled}
			>
				<Select.Trigger
					aria-invalid={!!errors?.gender}
					class="!h-9 w-full rounded-md text-xs {errors?.gender ? errClass : ''}"
				>
					{genderOptions.find((o) => o.value === gender)?.label ?? 'เลือกเพศ'}
				</Select.Trigger>
				<Select.Content>
					{#each genderOptions as opt (opt.value)}
						<Select.Item value={opt.value} label={opt.label} />
					{/each}
				</Select.Content>
			</Select.Root>
			{#if errors?.gender}
				<p class="text-2xs text-destructive">{errors.gender}</p>
			{/if}
		</div>
	</div>

	<!-- Nationality & Religion -->
	<div class="grid gap-3 sm:grid-cols-2">
		<div class="space-y-1.5">
			<Label for="country" class="text-xs font-semibold text-foreground">
				สัญชาติ <span class="text-destructive">*</span>
			</Label>
			<SearchSelect
				name="country"
				options={COUNTRIES}
				bind:value={country}
				placeholder="เลือกสัญชาติ"
				searchPlaceholder="ค้นหาสัญชาติ..."
				emptyText="ไม่พบสัญชาติ"
				{disabled}
				class="!h-9 rounded-md text-xs {errors?.country ? errClass : ''}"
				controlProps={{ id: 'country', 'aria-invalid': !!errors?.country }}
			/>
			{#if errors?.country}
				<p class="text-2xs text-destructive">{errors.country}</p>
			{/if}
		</div>

		<div class="space-y-1.5">
			<Label class="text-xs font-semibold text-foreground">ศาสนา</Label>
			<Select.Root
				type="single"
				value={religion}
				onValueChange={(val) => {
					if (
						val === 'buddhist' ||
						val === 'muslim' ||
						val === 'christian' ||
						val === 'other' ||
						val === 'unknown'
					) {
						religion = val;
					}
				}}
				{disabled}
			>
				<Select.Trigger class="!h-9 w-full rounded-md text-xs">
					{religionOptions.find((o) => o.value === religion)?.label ?? 'ไม่ระบุ'}
				</Select.Trigger>
				<Select.Content>
					{#each religionOptions as opt (opt.value)}
						<Select.Item value={opt.value} label={opt.label} />
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
	</div>

	<!-- Phone & No Phone Checkbox -->
	<div class="space-y-2">
		<div class="space-y-1.5">
			<Label for="phone" class="text-xs font-semibold text-foreground">
				เบอร์โทรศัพท์ {#if !no_phone}<span class="text-destructive">*</span>{/if}
			</Label>
			<Input
				id="phone"
				value={phone}
				oninput={onPhoneInput}
				disabled={disabled || no_phone}
				inputmode="numeric"
				maxlength={10}
				autocomplete="tel"
				placeholder="เบอร์โทรศัพท์ 10 หลัก"
				aria-invalid={!!errors?.phone}
				class="h-9 {errors?.phone ? errClass : ''}"
			/>
			{#if errors?.phone}
				<p class="text-2xs text-destructive">{errors.phone}</p>
			{/if}
		</div>

		<div class="flex items-center gap-2">
			<Checkbox
				id="no-phone"
				checked={no_phone}
				onCheckedChange={(checked) => {
					no_phone = !!checked;
					if (no_phone) phone = '';
				}}
				{disabled}
			/>
			<Label for="no-phone" class="cursor-pointer text-xs text-muted-foreground">
				ไม่มีเบอร์โทรศัพท์
			</Label>
		</div>
	</div>
</div>
