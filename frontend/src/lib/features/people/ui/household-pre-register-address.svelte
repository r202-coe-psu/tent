<script lang="ts">
	import SearchSelect from '$lib/components/ui/search-select/search-select.svelte';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Combobox } from '$lib/components/ui/combobox/index.js';
	import {
		useProvinces,
		useDistricts,
		useSubdistricts
	} from '$lib/features/shelters/application/queries';
	import { toast } from 'svelte-sonner';

	interface AddressFormState {
		addressNo: string;
		villageNo: string;
		subdistrict: string;
		district: string;
		province: string;
		postalCode: string;
		municipalityZone: string;
		community: string;
	}

	let {
		form = $bindable(),
		householdLabel = '',
		municipalityZoneItems = [],
		communityItems = [],
		onBack,
		onNext
	}: {
		form: AddressFormState;
		householdLabel?: string;
		municipalityZoneItems?: { value: string; label: string }[];
		communityItems?: { value: string; label: string }[];
		onBack: () => void;
		onNext: () => void;
	} = $props();

	const provincesQuery = useProvinces();
	const districtsQuery = useDistricts(() => form.province || null);
	const subdistrictsQuery = useSubdistricts(
		() => form.province || null,
		() => form.district || null
	);

	const provinceItems = $derived((provincesQuery.data ?? []).map((p) => ({ value: p, label: p })));
	const districtItems = $derived((districtsQuery.data ?? []).map((d) => ({ value: d, label: d })));
	const subdistrictItems = $derived(
		(subdistrictsQuery.data ?? []).map((s) => ({ value: s.subdistrict, label: s.subdistrict }))
	);

	function selectProvince(value: string | null) {
		form.province = value ?? '';
		form.district = '';
		form.subdistrict = '';
		form.postalCode = '';
	}

	function selectDistrict(value: string | null) {
		form.district = value ?? '';
		form.subdistrict = '';
		form.postalCode = '';
	}

	function selectSubdistrict(value: string | null) {
		form.subdistrict = value ?? '';
		const match = (subdistrictsQuery.data ?? []).find((s) => s.subdistrict === value);
		form.postalCode = match ? String(match.zipcode) : '';
	}

	function handleNext() {
		if (
			!form.addressNo.trim() ||
			!form.subdistrict.trim() ||
			!form.district.trim() ||
			!form.province.trim()
		) {
			toast.error('กรุณากรอกข้อมูลที่อยู่ให้ครบถ้วน (บ้านเลขที่, ตำบล, อำเภอ, จังหวัด)');
			return;
		}
		onNext();
	}
</script>

<div class="mx-auto w-full max-w-5xl space-y-6">
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
				<div class="space-y-2">
					<Label>เขตการปกครอง</Label>
					<SearchSelect
						items={municipalityZoneItems}
						bind:value={form.municipalityZone}
						placeholder="เลือกเขตการปกครอง..."
						emptyText="ไม่พบเขตการปกครอง"
					/>
				</div>
				<div class="space-y-2">
					<Label>ชุมชน</Label>
					<SearchSelect
						items={communityItems}
						bind:value={form.community}
						placeholder="เลือกชุมชน..."
						emptyText="ไม่พบชุมชน"
					/>
				</div>
			</div>
		</div>
	</div>

	<!-- ที่อยู่ครัวเรือนเดิม -->
	<div class="rounded-2xl border border-border bg-card p-6 shadow-sm">
		<h3 class="mb-4 text-base font-bold text-slate-800 dark:text-slate-200">
			ที่อยู่ครัวเรือนเดิม (ก่อนอพยพ)
		</h3>
		<div class="grid grid-cols-2 gap-4">
			<div class="space-y-2">
				<Label for="addr-no">บ้านเลขที่ <span class="text-destructive">*</span></Label>
				<Input id="addr-no" placeholder="เช่น 12/3" bind:value={form.addressNo} required />
			</div>
			<div class="space-y-2">
				<Label for="village-no">หมู่ที่ / ซอย / ถนน</Label>
				<Input id="village-no" placeholder="เช่น หมู่ 2" bind:value={form.villageNo} />
			</div>

			<div class="space-y-2">
				<Label>จังหวัด <span class="text-destructive">*</span></Label>
				<Combobox
					items={provinceItems}
					bind:value={() => form.province, selectProvince}
					placeholder={provincesQuery.isLoading ? 'กำลังโหลด...' : 'เลือกจังหวัด...'}
					searchPlaceholder="ค้นหาจังหวัด..."
					emptyText="ไม่พบจังหวัด"
					disabled={provincesQuery.isLoading}
				/>
			</div>
			<div class="space-y-2">
				<Label>อำเภอ / เขต <span class="text-destructive">*</span></Label>
				<Combobox
					items={districtItems}
					bind:value={() => form.district, selectDistrict}
					placeholder={!form.province
						? 'เลือกจังหวัดก่อน'
						: districtsQuery.isLoading
							? 'กำลังโหลด...'
							: 'เลือกอำเภอ...'}
					searchPlaceholder="ค้นหาอำเภอ..."
					emptyText="ไม่พบอำเภอ"
					disabled={!form.province || districtsQuery.isLoading}
				/>
			</div>
			<div class="space-y-2">
				<Label>ตำบล / แขวง <span class="text-destructive">*</span></Label>
				<Combobox
					items={subdistrictItems}
					bind:value={() => form.subdistrict, selectSubdistrict}
					placeholder={!form.district
						? 'เลือกอำเภอก่อน'
						: subdistrictsQuery.isLoading
							? 'กำลังโหลด...'
							: 'เลือกตำบล...'}
					searchPlaceholder="ค้นหาตำบล..."
					emptyText="ไม่พบตำบล"
					disabled={!form.district || subdistrictsQuery.isLoading}
				/>
			</div>
			<div class="space-y-2">
				<Label for="postal-code">รหัสไปรษณีย์</Label>
				<Input
					id="postal-code"
					placeholder={!form.subdistrict ? 'เลือกตำบลก่อน' : 'เช่น 90110'}
					disabled={!form.subdistrict}
					bind:value={form.postalCode}
				/>
			</div>
		</div>
	</div>

	<!-- Navigation -->
	<div class="mt-8 flex justify-between border-t border-border pt-4">
		<Button variant="outline" onclick={onBack} class="h-11 px-8 font-semibold">ย้อนกลับ</Button>
		<Button
			onclick={handleNext}
			disabled={!form.addressNo.trim() ||
				!form.subdistrict.trim() ||
				!form.district.trim() ||
				!form.province.trim()}
			class="h-11 bg-[#0d2240] px-8 font-semibold text-white hover:bg-[#1a3a5c]"
		>
			ถัดไป (ทรัพย์สินและสัตว์เลี้ยง) →
		</Button>
	</div>
</div>
