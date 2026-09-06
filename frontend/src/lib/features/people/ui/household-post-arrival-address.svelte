<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Combobox } from '$lib/components/ui/combobox/index.js';
	import { SearchSelect } from '$lib/components/ui/search-select/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import {
		useProvinces,
		useDistricts,
		useSubdistricts
	} from '$lib/features/shelters/application/queries';
	import { useMasterData } from '$lib/features/master-data';
	import {
		householdPostArrivalAddressFormSchema,
		type HouseholdPostArrivalAddressForm
	} from '../domain/people';

	let {
		initialData = null,
		householdLabel = '',
		municipalityZoneItems = [],
		communityItems = [],
		defaultMunicipalityZone = '',
		defaultCommunity = '',
		onBack,
		onNext
	}: {
		initialData?: Partial<HouseholdPostArrivalAddressForm> | null;
		householdLabel?: string;
		municipalityZoneItems?: { value: string; label: string }[];
		communityItems?: { value: string; label: string }[];
		/** master_data `is_default` code — pre-selects the field on a fresh form. */
		defaultMunicipalityZone?: string;
		defaultCommunity?: string;
		onBack: () => void;
		onNext: (data: HouseholdPostArrivalAddressForm) => void;
	} = $props();

	const form = superForm(defaults(zod4(householdPostArrivalAddressFormSchema)), {
		SPA: true,
		validators: zod4(householdPostArrivalAddressFormSchema),
		resetForm: false,
		onUpdate: async ({ form }) => {
			if (!form.valid) return;
			onNext(form.data);
		}
	});

	const { form: formData, submitting } = form;

	let initialized = $state(false);
	$effect(() => {
		if (initialized || !initialData) return;
		initialized = true;
		$formData = { ...$formData, ...initialData };
	});

	// Seed the configured defaults once master data arrives — only while the
	// field is still empty, so stepping back into this form (initialData restores
	// the operator's own choice) never overwrites it. (CR-049)
	//
	// One flag per field: the two master queries resolve independently, and a
	// single shared flag would burn out on whichever arrives first and drop the
	// other default for good.
	let municipalityZoneSeeded = false;
	let communitySeeded = false;
	$effect(() => {
		if (!municipalityZoneSeeded && defaultMunicipalityZone) {
			municipalityZoneSeeded = true;
			if (!$formData.municipalityZone) $formData.municipalityZone = defaultMunicipalityZone;
		}
		if (!communitySeeded && defaultCommunity) {
			communitySeeded = true;
			if (!$formData.community) $formData.community = defaultCommunity;
		}
	});

	const provincesQuery = useProvinces();
	const districtsQuery = useDistricts(() => $formData.province || null);
	const subdistrictsQuery = useSubdistricts(
		() => $formData.province || null,
		() => $formData.district || null
	);
	const housingTypeQuery = useMasterData(() => 'housing_type');

	const provinceItems = $derived((provincesQuery.data ?? []).map((p) => ({ value: p, label: p })));
	const districtItems = $derived((districtsQuery.data ?? []).map((d) => ({ value: d, label: d })));
	const subdistrictItems = $derived(
		(subdistrictsQuery.data ?? []).map((s) => ({ value: s.subdistrict, label: s.subdistrict }))
	);
	const housingTypeItems = $derived(
		(housingTypeQuery.data?.items ?? [])
			.filter((i) => i.status === 'active')
			.map((i) => ({ value: i.code, label: i.label }))
	);
	const isHomeless = $derived($formData.housingType === 'homeless');

	const selectTriggerClass =
		"flex !h-9 w-full items-start rounded-md border border-input bg-background px-3 !pt-1.5 text-sm font-medium shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 data-placeholder:text-muted-foreground [&_svg]:self-center [&_svg:not([class*='size-'])]:size-4";

	function selectProvince(value: string | null) {
		$formData.province = value ?? '';
		$formData.district = '';
		$formData.subdistrict = '';
		$formData.postalCode = '';
	}

	function selectDistrict(value: string | null) {
		$formData.district = value ?? '';
		$formData.subdistrict = '';
		$formData.postalCode = '';
	}

	function selectSubdistrict(value: string | null) {
		$formData.subdistrict = value ?? '';
		const match = (subdistrictsQuery.data ?? []).find((s) => s.subdistrict === value);
		$formData.postalCode = match ? String(match.zipcode) : '';
	}
</script>

<form method="POST" use:form.enhance class="mx-auto w-full max-w-3xl space-y-6">
	<Field.FieldGroup>
		<div class="space-y-2">
			<h3 class="text-lg font-bold text-foreground">3. ระบุข้อมูลที่อยู่ครัวเรือน</h3>
			<p class="text-sm text-muted-foreground">
				กรอกข้อมูลที่อยู่หลักตามภูมิลำเนา และข้อมูลโซนหรือชุมชนในศูนย์ของครัวเรือนนี้
			</p>
		</div>

		<!-- ข้อมูลครัวเรือนเบื้องต้น -->
		<div class="space-y-4 rounded-xl border border-border bg-card p-6 shadow-xs">
			<h4 class="text-base font-bold text-slate-800">ข้อมูลครัวเรือนเบื้องต้น</h4>
			<div class="space-y-4">
				<div class="space-y-1.5">
					<Label for="hh-label">ชื่อเรียกครัวเรือน</Label>
					<Input
						id="hh-label"
						value={householdLabel}
						disabled
						class="bg-muted text-muted-foreground"
					/>
				</div>

				<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
					<Form.Field {form} name="municipalityZone">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>เขตเทศบาล (Zone)</Form.Label>
								<SearchSelect
									items={municipalityZoneItems}
									bind:value={$formData.municipalityZone}
									placeholder="เลือกเขตเทศบาล..."
									emptyText="ไม่พบเขตเทศบาล"
									controlProps={props}
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>
					<Form.Field {form} name="community">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>ชุมชนในศูนย์ (Community)</Form.Label>
								<SearchSelect
									items={communityItems}
									bind:value={$formData.community}
									placeholder="เลือกชุมชน..."
									emptyText="ไม่พบชุมชน"
									controlProps={props}
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>
				</div>
			</div>
		</div>

		<!-- ที่อยู่หลักตามภูมิลำเนา -->
		<div class="space-y-4 rounded-xl border border-border bg-card p-6 shadow-xs">
			<h4 class="text-base font-bold text-slate-800">ข้อมูลที่อยู่หลักตามภูมิลำเนา</h4>
			<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
				<Form.Field {form} name="housingType">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>ประเภทที่อยู่อาศัย</Form.Label>
							<Select.Root
								type="single"
								bind:value={
									() => $formData.housingType ?? '', (v) => ($formData.housingType = v || null)
								}
							>
								<Select.Trigger {...props} class={selectTriggerClass}>
									{housingTypeItems.find((o) => o.value === $formData.housingType)?.label ??
										'— เลือกประเภทที่อยู่อาศัย —'}
								</Select.Trigger>
								<Select.Content>
									{#each housingTypeItems as opt (opt.value)}
										<Select.Item value={opt.value} label={opt.label} />
									{/each}
								</Select.Content>
							</Select.Root>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>
				<Form.Field {form} name="residenceLandmark">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>
								จุดสังเกตที่อยู่
								{#if isHomeless}
									<span class="font-normal text-muted-foreground">(หรือบ้านเลขที่)</span>
								{/if}
							</Form.Label>
							<Input
								{...props}
								placeholder={isHomeless ? 'เช่น ริมคลองข้างตลาด' : 'เช่น ใกล้สะพาน / ปากซอย'}
								bind:value={$formData.residenceLandmark}
							/>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>
				<Form.Field {form} name="addressNo">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>
								บ้านเลขที่
								{#if !isHomeless}<span class="text-destructive">*</span>{/if}
								{#if isHomeless}
									<span class="font-normal text-muted-foreground">(ไม่บังคับถ้ามีจุดสังเกต)</span>
								{/if}
							</Form.Label>
							<Input {...props} placeholder="เช่น 12/3" bind:value={$formData.addressNo} />
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>
				<Form.Field {form} name="villageNo">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>หมู่ที่ / ตรอก / ซอย / ถนน</Form.Label>
							<Input {...props} placeholder="เช่น หมู่ 2" bind:value={$formData.villageNo} />
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>
				<Form.Field {form} name="province">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>จังหวัด <span class="text-destructive">*</span></Form.Label>
							<Combobox
								items={provinceItems}
								bind:value={() => $formData.province, selectProvince}
								placeholder={provincesQuery.isLoading ? 'กำลังโหลด...' : 'เลือกจังหวัด...'}
								searchPlaceholder="ค้นหาจังหวัด..."
								emptyText="ไม่พบจังหวัด"
								disabled={provincesQuery.isLoading}
								controlProps={props}
							/>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>
				<Form.Field {form} name="district">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>อำเภอ / เขต <span class="text-destructive">*</span></Form.Label>
							<Combobox
								items={districtItems}
								bind:value={() => $formData.district, selectDistrict}
								placeholder={!$formData.province
									? 'เลือกจังหวัดก่อน'
									: districtsQuery.isLoading
										? 'กำลังโหลด...'
										: 'เลือกอำเภอ...'}
								searchPlaceholder="ค้นหาอำเภอ..."
								emptyText="ไม่พบอำเภอ"
								disabled={!$formData.province || districtsQuery.isLoading}
								controlProps={props}
							/>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>
				<Form.Field {form} name="subdistrict">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>ตำบล / แขวง <span class="text-destructive">*</span></Form.Label>
							<Combobox
								items={subdistrictItems}
								bind:value={() => $formData.subdistrict, selectSubdistrict}
								placeholder={!$formData.district
									? 'เลือกอำเภอก่อน'
									: subdistrictsQuery.isLoading
										? 'กำลังโหลด...'
										: 'เลือกตำบล...'}
								searchPlaceholder="ค้นหาตำบล..."
								emptyText="ไม่พบตำบล"
								disabled={!$formData.district || subdistrictsQuery.isLoading}
								controlProps={props}
							/>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>
				<Form.Field {form} name="postalCode">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>รหัสไปรษณีย์</Form.Label>
							<Input
								{...props}
								placeholder={!$formData.subdistrict ? 'เลือกตำบลก่อน' : 'เช่น 90110'}
								disabled={!$formData.subdistrict}
								bind:value={$formData.postalCode}
							/>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>
			</div>
		</div>

		<!-- บันทึกเพิ่มเติม -->
		<div class="space-y-4 rounded-xl border border-border bg-card p-6 shadow-xs">
			<Form.Field {form} name="notes">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label class="text-base font-bold text-slate-800">บันทึกเพิ่มเติม</Form.Label>
						<Textarea
							{...props}
							placeholder="ระบุหมายเหตุ หรือรายละเอียดอื่นๆ..."
							bind:value={$formData.notes}
							class="min-h-[80px]"
						/>
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>
		</div>

		<!-- Navigation -->
		<div class="mt-8 flex justify-between border-t border-border pt-4">
			<Button type="button" variant="outline" onclick={onBack} class="h-11 px-8 font-semibold">
				ย้อนกลับ
			</Button>
			<Form.Button
				disabled={$submitting}
				class="h-11 bg-[#0d2240] px-8 font-semibold text-white hover:bg-[#1a3a5c]"
			>
				ถัดไป (ทรัพย์สินและสัตว์เลี้ยง) →
			</Form.Button>
		</div>
	</Field.FieldGroup>
</form>
