<script lang="ts">
	import MapPin from '@lucide/svelte/icons/map-pin';
	import type { SuperForm } from 'sveltekit-superforms';
	import type { SuperFormData } from 'sveltekit-superforms/client';
	import {
		DEFAULT_SHELTER_FEATURE_FLAGS,
		SITE_KIND_LABELS,
		type Shelter,
		type ProjectLevel,
		type SiteKind
	} from '../domain/schema';
	import {
		applyAllowAssets,
		applyAllowPets,
		applyAllowVehicles,
		patchFeatureFlags
	} from '../domain/feature-flag-policy-sync';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import SearchSelect from '$lib/components/search-select.svelte';
	import { useMasterData } from '$lib/features/master-data';
	import { useProvinces, useDistricts, useSubdistricts } from '../application/queries';
	import LocationMapPicker from './location-map-picker.svelte';

	let {
		form,
		formData,
		disabled = false
	}: {
		form: SuperForm<Shelter>;
		formData: SuperFormData<Shelter>;
		disabled?: boolean;
	} = $props();

	const operationStatusOptions: { value: Shelter['operation_status']; label: string }[] = [
		{ value: 'standby', label: 'กำลังเตรียมการ (Preparing)' },
		{ value: 'active', label: 'เปิดรับผู้อพยพ (Active)' },
		{ value: 'full_capacity', label: 'เต็มความจุ (Full Capacity)' },
		{ value: 'closed', label: 'ปิดศูนย์ (Closed)' }
	];

	const siteKindOptions: { value: SiteKind; label: string }[] = [
		{ value: 'evacuation_center', label: SITE_KIND_LABELS.evacuation_center },
		{ value: 'host_house', label: SITE_KIND_LABELS.host_house }
	];

	const projectLevelOptions: { value: ProjectLevel; label: string }[] = [
		{ value: 'community', label: 'ระดับชุมชน (จุดพักพิงย่อย/บ้านพี่เลี้ยง)' },
		{ value: 'lao', label: 'ระดับ อปท. (ศูนย์พักพิงหลักของเทศบาล)' },
		{ value: 'provincial', label: 'ระดับเมือง/จังหวัด (ศูนย์บัญชาการขนาดใหญ่/จุดยุทธศาสตร์)' }
	];

	// Master data (live query) — shelter_type + structured address (CR-019/CR-011 pattern).
	const shelterTypeQuery = useMasterData(() => 'shelter_type');
	const municipalityZoneQuery = useMasterData(() => 'municipality_zone');
	const communityQuery = useMasterData(() => 'community');

	const shelterTypeItems = $derived(
		(shelterTypeQuery.data?.items ?? [])
			.filter((i) => i.status === 'active')
			.map((i) => ({ value: i.code, label: i.label }))
	);
	const municipalityZoneItems = $derived(
		(municipalityZoneQuery.data?.items ?? [])
			.filter((i) => i.status === 'active')
			.map((i) => ({ value: i.code, label: i.label }))
	);
	const communityItems = $derived(
		(communityQuery.data?.items ?? [])
			.filter((i) => i.status === 'active')
			.map((i) => ({ value: i.code, label: i.label }))
	);

	// Seed configured defaults (master_data `is_default`) when a field is untouched.
	// A new shelter starts empty → gets the default; an existing shelter already
	// has values (superForm initialises synchronously) so the once/only-when-empty
	// guard leaves them alone. (CR-049)
	let defaultsSeeded = false;
	$effect(() => {
		const stItems = shelterTypeQuery.data?.items;
		const mzItems = municipalityZoneQuery.data?.items;
		if (!stItems || !mzItems || defaultsSeeded) return;
		defaultsSeeded = true;
		if (!$formData.shelter_type) {
			const d = stItems.find((i) => i.is_default && i.status === 'active');
			if (d) $formData.shelter_type = d.code;
		}
		if (!$formData.municipality_zone) {
			const d = mzItems.find((i) => i.is_default && i.status === 'active');
			if (d) $formData.municipality_zone = d.code;
		}
	});

	const selectTriggerClass =
		"flex !h-9 w-full items-start rounded-md border border-input bg-background px-3 !pt-1.5 text-sm font-medium shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 data-placeholder:text-muted-foreground [&_svg]:self-center [&_svg:not([class*='size-'])]:size-4";

	function ensureKeyPersonnel() {
		if (!$formData.key_personnel) {
			$formData.key_personnel = { eoc_liaison: {}, medical_lead: {}, kitchen_lead: {} };
		}
	}

	const personnelRows: { key: 'eoc_liaison' | 'medical_lead' | 'kitchen_lead'; label: string }[] = [
		{ key: 'eoc_liaison', label: 'ผู้ประสานงาน EOC (EOC Liaison)' },
		{ key: 'medical_lead', label: 'หัวหน้าทีมแพทย์/พยาบาล (Medical Lead)' },
		{ key: 'kitchen_lead', label: 'หัวหน้าโรงครัว (Kitchen Lead)' }
	];

	type AddressFieldKey = 'address_no' | 'village_no';
	const addressFields: { key: AddressFieldKey; label: string; placeholder: string }[] = [
		{ key: 'address_no', label: 'บ้านเลขที่', placeholder: 'เช่น 99/1' },
		{ key: 'village_no', label: 'หมู่ที่', placeholder: 'เช่น 5' }
	];

	// Province → district → subdistrict cascade (each step filters/disables the
	// next). Subdistrict selection also auto-fills postal_code from the dataset.
	const provincesQuery = useProvinces();
	const districtsQuery = useDistricts(() => $formData.province ?? null);
	const subdistrictsQuery = useSubdistricts(
		() => $formData.province ?? null,
		() => $formData.district ?? null
	);

	// SearchSelect options — the raw lists are string[]/{ subdistrict, zipcode }[].
	const provinceItems = $derived((provincesQuery.data ?? []).map((p) => ({ value: p, label: p })));
	const districtItems = $derived((districtsQuery.data ?? []).map((d) => ({ value: d, label: d })));
	const subdistrictItems = $derived(
		(subdistrictsQuery.data ?? []).map((s) => ({ value: s.subdistrict, label: s.subdistrict }))
	);

	function selectProvince(value: string | null) {
		$formData.province = value;
		// Downstream choices no longer apply to the new province.
		$formData.district = null;
		$formData.subdistrict = null;
		$formData.postal_code = null;
	}

	function selectDistrict(value: string | null) {
		$formData.district = value;
		$formData.subdistrict = null;
		$formData.postal_code = null;
	}

	function selectSubdistrict(value: string | null) {
		$formData.subdistrict = value;
		const match = (subdistrictsQuery.data ?? []).find((s) => s.subdistrict === value);
		$formData.postal_code = match ? String(match.zipcode) : null;
	}

	function ensureFeatureFlags() {
		if (!$formData.feature_flags) {
			$formData.feature_flags = { ...DEFAULT_SHELTER_FEATURE_FLAGS };
		}
	}

	function setEnableMedicalScreening(checked: boolean) {
		ensureFeatureFlags();
		$formData.feature_flags = patchFeatureFlags($formData.feature_flags, {
			enable_medical_screening: checked
		});
	}

	/** Registration toggles — also mirror the related policy sections (pets / luggage / parking). */
	function setAllowPets(checked: boolean) {
		const next = applyAllowPets($formData, checked);
		$formData.feature_flags = next.feature_flags;
		$formData.admission_policy = next.admission_policy;
	}

	function setAllowAssets(checked: boolean) {
		const next = applyAllowAssets($formData, checked);
		$formData.feature_flags = next.feature_flags;
		$formData.luggage_policy = next.luggage_policy;
	}

	function setAllowVehicles(checked: boolean) {
		const next = applyAllowVehicles($formData, checked);
		$formData.feature_flags = next.feature_flags;
		$formData.parking_policy = next.parking_policy;
	}
</script>

<section class="mt-6 mb-6 space-y-6 rounded-2xl border border-shelter-border p-6">
	<div class="flex items-center space-x-2 border-b border-shelter-border pb-3">
		<MapPin class="h-5 w-5 text-shelter-blue-text" />
		<span class="text-sm font-bold text-black">1.</span>
		<h2 class="text-base font-bold text-black">ข้อมูลพื้นฐานและที่ตั้ง</h2>
	</div>

	<h3 class="text-xs font-bold tracking-wider text-muted-foreground uppercase">ข้อมูลหลัก</h3>

	<Form.Field {form} name="name">
		<Form.Control>
			{#snippet children({ props })}
				<Form.Label>ชื่อศูนย์พักพิง<span class="text-destructive">*</span></Form.Label>
				<Input
					{...props}
					bind:value={$formData.name}
					{disabled}
					placeholder="เช่น โรงเรียนบ้านค่าย (ศูนย์พักพิงชั่วคราว)"
				/>
			{/snippet}
		</Form.Control>
		<Form.FieldErrors />
	</Form.Field>

	<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
		<Form.Field {form} name="site_kind">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>ชนิดสถานที่<span class="text-destructive">*</span></Form.Label>
					<Select.Root type="single" bind:value={$formData.site_kind} {disabled}>
						<Select.Trigger {...props} class={selectTriggerClass}>
							{siteKindOptions.find((o) => o.value === $formData.site_kind)?.label ??
								'— เลือกชนิดสถานที่ —'}
						</Select.Trigger>
						<Select.Content>
							{#each siteKindOptions as opt (opt.value)}
								<Select.Item value={opt.value} label={opt.label} />
							{/each}
						</Select.Content>
					</Select.Root>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="operation_status">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>สถานะการปฏิบัติการ (Operating Status)</Form.Label>
					<Select.Root type="single" bind:value={$formData.operation_status} {disabled}>
						<Select.Trigger {...props} class={selectTriggerClass}>
							{operationStatusOptions.find((o) => o.value === $formData.operation_status)?.label ??
								'— เลือกสถานะ —'}
						</Select.Trigger>
						<Select.Content>
							{#each operationStatusOptions as opt (opt.value)}
								<Select.Item value={opt.value} label={opt.label} />
							{/each}
						</Select.Content>
					</Select.Root>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="shelter_type">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>ประเภทสถานที่</Form.Label>
					<Select.Root
						type="single"
						bind:value={
							() => $formData.shelter_type ?? '', (v) => ($formData.shelter_type = v || null)
						}
						{disabled}
					>
						<Select.Trigger {...props} class={selectTriggerClass}>
							{shelterTypeItems.find((o) => o.value === $formData.shelter_type)?.label ??
								'— เลือกประเภท —'}
						</Select.Trigger>
						<Select.Content>
							{#each shelterTypeItems as opt (opt.value)}
								<Select.Item value={opt.value} label={opt.label} />
							{/each}
						</Select.Content>
					</Select.Root>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>
	</div>

	<Form.Field {form} name="project_level">
		<Form.Control>
			{#snippet children({ props })}
				<Form.Label>ระดับโครงการ (Project Level)</Form.Label>
				<Select.Root
					type="single"
					bind:value={
						() => $formData.project_level ?? '',
						(v) => ($formData.project_level = (v || null) as ProjectLevel | null)
					}
					{disabled}
				>
					<Select.Trigger {...props} class={selectTriggerClass}>
						{projectLevelOptions.find((o) => o.value === $formData.project_level)?.label ??
							'— เลือกระดับ —'}
					</Select.Trigger>
					<Select.Content>
						{#each projectLevelOptions as opt (opt.value)}
							<Select.Item value={opt.value} label={opt.label} />
						{/each}
					</Select.Content>
				</Select.Root>
			{/snippet}
		</Form.Control>
		<Form.FieldErrors />
	</Form.Field>

	<!-- Operational feature flags (CR-016 registration steps + CR-106 Station 2) -->
	<h3 class="text-xs font-bold tracking-wider text-muted-foreground uppercase">
		คุณสมบัติการปฏิบัติการ (Feature Flags)
	</h3>

	<div class="space-y-3">
		<div
			class="flex items-start justify-between gap-4 rounded-lg border border-shelter-border bg-background p-4"
		>
			<div class="min-w-0 flex-1 space-y-1">
				<label for="enable-medical-screening" class="text-sm font-medium text-card-foreground">
					เปิดคัดกรองการแพทย์ (Station 2)
				</label>
				<p class="text-xs text-muted-foreground">
					เปิด: ท่อลงทะเบียน S1→S2→S3 — แสดง Station 2 และ Handover Slip หลังลงทะเบียน · ปิด: S1→S3
					(ข้ามแพทย์) โดยยังแยกโต๊ะจัดโซนจากทะเบียน
				</p>
			</div>
			<Switch
				id="enable-medical-screening"
				checked={$formData.feature_flags?.enable_medical_screening ?? false}
				onCheckedChange={(v) => setEnableMedicalScreening(v === true)}
				{disabled}
				aria-label="เปิดคัดกรองการแพทย์ Station 2"
			/>
		</div>

		<div
			class="flex items-start justify-between gap-4 rounded-lg border border-shelter-border bg-background p-4"
		>
			<div class="min-w-0 flex-1 space-y-1">
				<label for="allow-pets" class="text-sm font-medium text-card-foreground">
					บันทึกสัตว์เลี้ยงตอนลงทะเบียน
				</label>
				<p class="text-xs text-muted-foreground">
					เปิด: แสดงส่วนสัตว์เลี้ยงในฟอร์มลงทะเบียน และตั้งนโยบายรับสัตว์เป็น “อนุญาตภายใต้เงื่อนไข”
					· ปิด: ซ่อนส่วนลงทะเบียน และตั้งเป็น “ไม่อนุญาตสัตว์เลี้ยง”
				</p>
			</div>
			<Switch
				id="allow-pets"
				checked={$formData.feature_flags?.allow_pets ?? false}
				onCheckedChange={(v) => setAllowPets(v === true)}
				{disabled}
				aria-label="บันทึกสัตว์เลี้ยงตอนลงทะเบียน"
			/>
		</div>

		<div
			class="flex items-start justify-between gap-4 rounded-lg border border-shelter-border bg-background p-4"
		>
			<div class="min-w-0 flex-1 space-y-1">
				<label for="allow-assets" class="text-sm font-medium text-card-foreground">
					บันทึกทรัพย์สิน / สัมภาระตอนลงทะเบียน
				</label>
				<p class="text-xs text-muted-foreground">
					เปิด: แสดงส่วนทรัพย์สินในฟอร์มลงทะเบียน และเปิดนโยบายสัมภาระ · ปิด: ซ่อนส่วนลงทะเบียน
					และล้างนโยบายสัมภาระ
				</p>
			</div>
			<Switch
				id="allow-assets"
				checked={$formData.feature_flags?.allow_assets ?? false}
				onCheckedChange={(v) => setAllowAssets(v === true)}
				{disabled}
				aria-label="บันทึกทรัพย์สินสัมภาระตอนลงทะเบียน"
			/>
		</div>

		<div
			class="flex items-start justify-between gap-4 rounded-lg border border-shelter-border bg-background p-4"
		>
			<div class="min-w-0 flex-1 space-y-1">
				<label for="allow-vehicles" class="text-sm font-medium text-card-foreground">
					บันทึกยานพาหนะตอนลงทะเบียน
				</label>
				<p class="text-xs text-muted-foreground">
					เปิด: แสดงส่วนยานพาหนะในฟอร์มลงทะเบียน และตั้งนโยบายจอดรถเป็น “มีพื้นที่จอด” · ปิด:
					ซ่อนส่วนลงทะเบียน และตั้งเป็น “ไม่มีที่จอด”
				</p>
			</div>
			<Switch
				id="allow-vehicles"
				checked={$formData.feature_flags?.allow_vehicles ?? false}
				onCheckedChange={(v) => setAllowVehicles(v === true)}
				{disabled}
				aria-label="บันทึกยานพาหนะตอนลงทะเบียน"
			/>
		</div>
	</div>

	<Form.Field {form} name="location.address">
		<Form.Control>
			{#snippet children({ props })}
				<Form.Label>ที่อยู่ตามเขตการปกครอง</Form.Label>
				<Input
					{...props}
					value={$formData.location?.address ?? ''}
					oninput={(e) => {
						if (!$formData.location) $formData.location = {};
						$formData.location.address = e.currentTarget.value;
					}}
					{disabled}
					placeholder="เช่น เทศบาลเมืองคอหงส์"
				/>
			{/snippet}
		</Form.Control>
		<Form.FieldErrors />
	</Form.Field>

	<Form.Field {form} name="location.lat">
		<Form.Control>
			<Form.Label>ตำแหน่งพิกัด (Location Pin)</Form.Label>
			<LocationMapPicker
				lat={$formData.location?.lat ?? null}
				lng={$formData.location?.lng ?? null}
				{disabled}
				onchange={(newLat, newLng) => {
					if (!$formData.location) $formData.location = {};
					$formData.location.lat = newLat;
					$formData.location.lng = newLng;
				}}
			/>
		</Form.Control>
		<Form.FieldErrors />
	</Form.Field>
	<Form.Field {form} name="location.lng">
		<Form.FieldErrors />
	</Form.Field>

	<!-- Structured address (CR-023 FR-23-0b/0c) -->
	<h3 class="text-xs font-bold tracking-wider text-muted-foreground uppercase">
		ที่อยู่ทางกายภาพ (Physical Address)
	</h3>

	<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
		<Form.Field {form} name="municipality_zone">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>โซนเทศบาล (Municipality Zone)</Form.Label>
					<Select.Root
						type="single"
						bind:value={
							() => $formData.municipality_zone ?? '',
							(v) => ($formData.municipality_zone = v || null)
						}
						{disabled}
					>
						<Select.Trigger {...props} class={selectTriggerClass}>
							{municipalityZoneItems.find((o) => o.value === $formData.municipality_zone)?.label ??
								'— เลือกโซน —'}
						</Select.Trigger>
						<Select.Content>
							{#each municipalityZoneItems as opt (opt.value)}
								<Select.Item value={opt.value} label={opt.label} />
							{/each}
						</Select.Content>
					</Select.Root>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="community">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>ชุมชน (Community)</Form.Label>
					<Select.Root
						type="single"
						bind:value={() => $formData.community ?? '', (v) => ($formData.community = v || null)}
						{disabled}
					>
						<Select.Trigger {...props} class={selectTriggerClass}>
							{communityItems.find((o) => o.value === $formData.community)?.label ??
								'— เลือกชุมชน —'}
						</Select.Trigger>
						<Select.Content>
							{#each communityItems as opt (opt.value)}
								<Select.Item value={opt.value} label={opt.label} />
							{/each}
						</Select.Content>
					</Select.Root>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>
	</div>

	<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
		{#each addressFields as field (field.key)}
			<Form.Field {form} name={field.key}>
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label>{field.label}</Form.Label>
						<Input
							{...props}
							value={$formData[field.key] ?? ''}
							oninput={(e) => ($formData[field.key] = e.currentTarget.value || null)}
							{disabled}
							placeholder={field.placeholder}
						/>
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>
		{/each}
	</div>

	<!-- Province → district → subdistrict cascade (largest to smallest; each
	     step is disabled until the previous one is chosen). -->
	<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
		<Form.Field {form} name="province">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>จังหวัด</Form.Label>
					<SearchSelect
						name="province"
						options={provinceItems}
						bind:value={() => $formData.province ?? '', (v) => selectProvince(v || null)}
						placeholder={provincesQuery.isLoading ? 'กำลังโหลด...' : 'เลือกจังหวัด...'}
						searchPlaceholder="ค้นหาจังหวัด..."
						emptyText="ไม่พบจังหวัด"
						disabled={disabled || provincesQuery.isLoading}
						controlProps={props}
						class="h-9 rounded-md"
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="district">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>อำเภอ/เขต</Form.Label>
					<SearchSelect
						name="district"
						options={districtItems}
						bind:value={() => $formData.district ?? '', (v) => selectDistrict(v || null)}
						placeholder={!$formData.province
							? 'เลือกจังหวัดก่อน'
							: districtsQuery.isLoading
								? 'กำลังโหลด...'
								: 'เลือกอำเภอ...'}
						searchPlaceholder="ค้นหาอำเภอ..."
						emptyText="ไม่พบอำเภอ"
						disabled={disabled || !$formData.province || districtsQuery.isLoading}
						controlProps={props}
						class="h-9 rounded-md"
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="subdistrict">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>ตำบล/แขวง</Form.Label>
					<SearchSelect
						name="subdistrict"
						options={subdistrictItems}
						bind:value={() => $formData.subdistrict ?? '', (v) => selectSubdistrict(v || null)}
						placeholder={!$formData.district
							? 'เลือกอำเภอก่อน'
							: subdistrictsQuery.isLoading
								? 'กำลังโหลด...'
								: 'เลือกตำบล...'}
						searchPlaceholder="ค้นหาตำบล..."
						emptyText="ไม่พบตำบล"
						disabled={disabled || !$formData.district || subdistrictsQuery.isLoading}
						controlProps={props}
						class="h-9 rounded-md"
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>
	</div>

	<Form.Field {form} name="postal_code">
		<Form.Control>
			{#snippet children({ props })}
				<Form.Label>รหัสไปรษณีย์</Form.Label>
				<Input
					{...props}
					value={$formData.postal_code ?? ''}
					oninput={(e) => ($formData.postal_code = e.currentTarget.value || null)}
					disabled={disabled || !$formData.subdistrict}
					placeholder={!$formData.subdistrict ? 'เลือกตำบลก่อน' : 'เช่น 90110'}
				/>
			{/snippet}
		</Form.Control>
		<Form.FieldErrors />
	</Form.Field>

	<!-- Center manager (contact) -->
	<h3 class="text-xs font-bold tracking-wider text-muted-foreground uppercase">
		ผู้ประสานงานหลัก (Contact)
	</h3>

	<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
		<Form.Field {form} name="contact.name">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>ผู้จัดการศูนย์</Form.Label>
					<Input
						{...props}
						bind:value={
							() => $formData.contact?.name ?? '',
							(value) => {
								if (!$formData.contact) $formData.contact = {};
								$formData.contact.name = value;
							}
						}
						{disabled}
						placeholder="เช่น นาย สมชาย ใจดี"
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="contact.phone">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>เบอร์โทร</Form.Label>
					<Input
						{...props}
						type="tel"
						value={$formData.contact?.phone ?? ''}
						oninput={(e) => {
							if (!$formData.contact) $formData.contact = {};
							$formData.contact.phone = e.currentTarget.value;
						}}
						{disabled}
						placeholder="เช่น 074-123456"
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>
	</div>

	<!-- Key personnel (CR-023 FR-23-2/3) -->
	<h3 class="text-xs font-bold tracking-wider text-muted-foreground uppercase">
		ข้อมูลบุคลากรหลัก (Key Personnel)
	</h3>

	<div class="space-y-3">
		{#each personnelRows as row (row.key)}
			<div class="grid grid-cols-1 items-end gap-3 md:grid-cols-[1fr_1fr]">
				<div class="space-y-1">
					<span class="text-sm font-medium">{row.label}</span>
					<Input
						bind:value={
							() => $formData.key_personnel?.[row.key]?.name ?? '',
							(value) => {
								ensureKeyPersonnel();
								$formData.key_personnel![row.key] = {
									...$formData.key_personnel![row.key],
									name: value || null
								};
							}
						}
						{disabled}
						placeholder="ชื่อ-สกุล"
					/>
				</div>
				<Input
					type="tel"
					value={$formData.key_personnel?.[row.key]?.phone ?? ''}
					oninput={(e) => {
						ensureKeyPersonnel();
						$formData.key_personnel![row.key] = {
							...$formData.key_personnel![row.key],
							phone: e.currentTarget.value || null
						};
					}}
					{disabled}
					placeholder="เบอร์โทร"
				/>
			</div>
		{/each}
	</div>
</section>
