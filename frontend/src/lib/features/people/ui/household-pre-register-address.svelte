<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Combobox } from '$lib/components/ui/combobox/index.js';
	import { SearchSelect } from '$lib/components/ui/search-select/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import {
		useProvinces,
		useDistricts,
		useSubdistricts
	} from '$lib/features/shelters/application/queries';
	import {
		householdPreRegisterAddressFormSchema,
		type HouseholdAddressForm
	} from '../domain/people';

	let {
		initialData = null,
		householdLabel = '',
		municipalityZoneItems = [],
		communityItems = [],
		onBack,
		onNext
	}: {
		initialData?: Partial<HouseholdAddressForm> | null;
		householdLabel?: string;
		municipalityZoneItems?: { value: string; label: string }[];
		communityItems?: { value: string; label: string }[];
		onBack: () => void;
		onNext: (data: HouseholdAddressForm) => void;
	} = $props();

	const form = superForm(defaults(zod4(householdPreRegisterAddressFormSchema)), {
		SPA: true,
		validators: zod4(householdPreRegisterAddressFormSchema),
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

	const provincesQuery = useProvinces();
	const districtsQuery = useDistricts(() => $formData.province || null);
	const subdistrictsQuery = useSubdistricts(
		() => $formData.province || null,
		() => $formData.district || null
	);

	const provinceItems = $derived((provincesQuery.data ?? []).map((p) => ({ value: p, label: p })));
	const districtItems = $derived((districtsQuery.data ?? []).map((d) => ({ value: d, label: d })));
	const subdistrictItems = $derived(
		(subdistrictsQuery.data ?? []).map((s) => ({ value: s.subdistrict, label: s.subdistrict }))
	);

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

<form method="POST" use:form.enhance class="mx-auto w-full max-w-5xl space-y-6">
	<Field.FieldGroup>
		<!-- ข้อมูลครัวเรือนเบื้องต้น -->
		<div class="rounded-2xl border border-border bg-card p-6 shadow-sm">
			<h3 class="mb-4 text-base font-bold text-slate-800 dark:text-slate-200">
				ข้อมูลครัวเรือนเบื้องต้น
			</h3>
			<div class="space-y-4">
				<div class="space-y-2">
					<Label for="hh-label">ชื่อเรียกครัวเรือน</Label>
					<Input
						id="hh-label"
						value={householdLabel || 'กรุณากรอกชื่อและนามสกุลหัวหน้าครัวเรือน...'}
						disabled
						class="bg-muted text-muted-foreground"
					/>
				</div>

				<div class="grid grid-cols-2 gap-4">
					<Form.Field {form} name="municipalityZone">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>เขตการปกครอง <span class="text-destructive">*</span></Form.Label>
								<SearchSelect
									items={municipalityZoneItems}
									bind:value={$formData.municipalityZone}
									placeholder="เลือกเขตการปกครอง..."
									emptyText="ไม่พบเขตการปกครอง"
									controlProps={props}
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>
					<Form.Field {form} name="community">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>ชุมชน <span class="text-destructive">*</span></Form.Label>
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

		<!-- ที่อยู่ครัวเรือนเดิม -->
		<div class="rounded-2xl border border-border bg-card p-6 shadow-sm">
			<h3 class="mb-4 text-base font-bold text-slate-800 dark:text-slate-200">
				ที่อยู่ครัวเรือนเดิม (ก่อนอพยพ)
			</h3>
			<div class="grid grid-cols-2 gap-4">
				<Form.Field {form} name="addressNo">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>บ้านเลขที่ <span class="text-destructive">*</span></Form.Label>
							<Input {...props} placeholder="เช่น 12/3" bind:value={$formData.addressNo} />
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>
				<Form.Field {form} name="villageNo">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label
								>หมู่ที่ / ตรอก / ซอย / ถนน <span class="text-destructive">*</span></Form.Label
							>
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
							<Form.Label>รหัสไปรษณีย์ <span class="text-destructive">*</span></Form.Label>
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
