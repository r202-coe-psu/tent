<script lang="ts">
	import type { Household, Evacuee, HouseholdInput } from '../domain/people';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import Search from '@lucide/svelte/icons/search';
	import X from '@lucide/svelte/icons/x';
	import Plus from '@lucide/svelte/icons/plus';

	let {
		allEvacuees = [],
		households = [],
		onsubmit,
		onselect,
		pending = false
	}: {
		allEvacuees?: Evacuee[];
		households?: Household[];
		onsubmit?: (input: Partial<HouseholdInput>) => void;
		onselect?: (household: Household) => void;
		pending?: boolean;
	} = $props();

	let searchMode: 'exact' | 'fuzzy' = $state('exact');
	let searchQuery = $state('');

	let searchState: 'idle' | 'found' | 'not_found' = $state('idle');
	let showNewHouseholdForm = $state(false);

	let foundHousehold = $state<Household | null>(null);
	let foundEvacuee = $state<Evacuee | null>(null);

	let formData = $state({
		address_no: '',
		village_no: '',
		subdistrict: '',
		district: '',
		province: '',
		postal_code: ''
	});

	function doSearch() {
		if (!searchQuery.trim()) {
			searchState = 'idle';
			return;
		}
		const query = searchQuery.trim().toLowerCase();

		if (searchMode === 'exact') {
			const evacuee = allEvacuees.find(e => 
				(e.phone && e.phone.toLowerCase().includes(query)) || 
				(e.person_id?.number && e.person_id.number.toLowerCase().includes(query))
			);
			if (evacuee && evacuee.household_id) {
				const hh = households.find(h => h._id === evacuee.household_id);
				if (hh) {
					foundEvacuee = evacuee;
					foundHousehold = hh;
					searchState = 'found';
					showNewHouseholdForm = false;
					return;
				}
			}
		} else {
			const hh = households.find(h => {
				const addr = `${h.address_no || ''} ${h.village_no || ''} ${h.subdistrict || ''} ${h.district || ''} ${h.province || ''}`.toLowerCase();
				return addr.includes(query);
			});
			if (hh) {
				foundHousehold = hh;
				foundEvacuee = null;
				searchState = 'found';
				showNewHouseholdForm = false;
				return;
			}
		}

		searchState = 'not_found';
		foundHousehold = null;
		foundEvacuee = null;
		showNewHouseholdForm = false;
	}

	function handleNewHouseholdSubmit(e: Event) {
		e.preventDefault();
		if (onsubmit) {
			onsubmit(formData);
		}
	}
</script>

<div class="space-y-6">
	<!-- Search Section -->
	<form class="rounded-2xl border border-border bg-card p-6 shadow-sm" onsubmit={(e) => { e.preventDefault(); doSearch(); }}>
		<!-- Search Mode Toggle -->
		<div class="mb-6 flex overflow-hidden rounded-xl bg-muted/50 p-1">
			<button
				type="button"
				class="flex-1 rounded-lg py-2.5 text-sm font-semibold transition-colors {searchMode === 'exact' ? 'bg-white text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}"
				onclick={() => { searchMode = 'exact'; searchQuery = ''; searchState = 'idle'; showNewHouseholdForm = false; }}
			>
				<span class="mr-2 {searchMode === 'exact' ? 'text-primary' : 'text-muted-foreground'}">◉</span> ค้นหาด้วยบุคคล (Exact Match)
			</button>
			<button
				type="button"
				class="flex-1 rounded-lg py-2.5 text-sm font-semibold transition-colors {searchMode === 'fuzzy' ? 'bg-white text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}"
				onclick={() => { searchMode = 'fuzzy'; searchQuery = ''; searchState = 'idle'; showNewHouseholdForm = false; }}
			>
				<span class="mr-2 {searchMode === 'fuzzy' ? 'text-primary' : 'text-muted-foreground'}">◎</span> ค้นหาด้วยที่อยู่ (Fuzzy Match)
			</button>
		</div>

		<div class="space-y-3">
			<Label class="text-sm font-medium">
				{searchMode === 'exact' ? 'เบอร์โทรศัพท์ หรือ เลขบัตรประจำตัวประชาชน' : 'ที่อยู่, ถนน, ตำบล, หรืออำเภอ'}
			</Label>
			<div class="flex gap-3">
				<div class="relative flex-1">
					<Search class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						bind:value={searchQuery}
						placeholder={searchMode === 'exact' ? '089-999-9999' : 'เช่น บ้านพรุ หาดใหญ่'}
						class="h-11 pl-9 bg-muted/20"
					/>
				</div>
				<Button type="submit" class="h-11 px-6 bg-[#003B71] hover:bg-[#002a50]">
					<Search class="mr-2 h-4 w-4" /> ค้นหาครอบครัว
				</Button>
			</div>

			<p class="text-xs text-muted-foreground mt-2">
				{#if searchMode === 'exact'}
					💡 ข้อดี: ค้นหาได้รวดเร็ว จับคู่ข้อมูลแบบ 1-to-1 แม่นยำ
				{:else}
					💡 ข้อดี: ใช้เมื่อไม่ทราบข้อมูลส่วนบุคคลที่แน่ชัด
				{/if}
			</p>
		</div>
	</form>

	<!-- Found Alert -->
	{#if searchState === 'found' && foundHousehold}
		<div class="rounded-3xl border border-green-200 bg-green-50 p-6 flex flex-col items-center justify-center gap-4 text-center shadow-sm">
			<div class="flex flex-col items-center gap-2 text-green-700">
				<div class="font-bold text-lg">พบข้อมูลครอบครัว: {foundHousehold.label || 'ครอบครัวไม่มีชื่อ'}</div>
				<div class="text-sm">ที่อยู่: {foundHousehold.address_no || '-'} {foundHousehold.village_no || ''} {foundHousehold.subdistrict || ''} {foundHousehold.district || ''} {foundHousehold.province || ''}</div>
				{#if foundEvacuee}
					<div class="text-sm bg-green-100 px-3 py-1 rounded-full mt-2 font-medium">สมาชิกที่ค้นพบ: {foundEvacuee.first_name} {foundEvacuee.last_name}</div>
				{/if}
			</div>
			<Button class="bg-green-700 hover:bg-green-800 px-6 h-10 rounded-xl" onclick={() => onselect?.(foundHousehold!)}>
				ยืนยันเข้าร่วมครอบครัวนี้
			</Button>
		</div>
	{/if}

	<!-- Not Found Alert -->
	{#if searchState === 'not_found' && !showNewHouseholdForm}
		<div class="rounded-3xl border border-amber-200 bg-[#fffdf5] py-10 px-6 flex flex-col items-center justify-center gap-5 text-center shadow-sm">
			<div class="flex items-center gap-2 text-red-600 font-bold text-lg">
				<X class="h-6 w-6 stroke-[3]" /> ไม่พบครอบครัวลงทะเบียนด้วยข้อมูลนี้ในระบบ
			</div>
			<Button type="button" class="bg-[#003B71] hover:bg-[#002a50] px-6 h-10 rounded-xl" onclick={() => showNewHouseholdForm = true}>
				<Plus class="mr-2 h-4 w-4" /> ลงทะเบียนเป็นครอบครัวใหม่ที่อยู่นี้
			</Button>
		</div>
	{/if}

	<!-- New Household Form -->
	{#if showNewHouseholdForm}
		<form class="rounded-3xl border border-border bg-card p-6 md:p-8 shadow-sm" onsubmit={handleNewHouseholdSubmit}>
			<div class="mb-6">
				<h3 class="text-lg font-bold flex items-center gap-2">
					🏡 กรอกข้อมูลที่อยู่ (สร้างครอบครัวใหม่)
				</h3>
				<p class="text-xs text-muted-foreground mt-1">
					ที่อยู่นี้จะถูกใช้สร้างฐานข้อมูลกลุ่มครอบครัวใหม่ และคุณจะเป็นหัวหน้าครอบครัวโดยอัตโนมัติ
				</p>
			</div>

			<div class="grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-6">
				<div class="space-y-3">
					<Label class="font-semibold">บ้านเลขที่</Label>
					<Input bind:value={formData.address_no} placeholder="เช่น 12/3" class="bg-background h-11" required />
				</div>
				<div class="space-y-3">
					<Label class="font-semibold">หมู่ที่ / ตรอก / ซอย / ถนน</Label>
					<Input bind:value={formData.village_no} placeholder="เช่น หมู่ 2" class="bg-background h-11" />
				</div>
				<div class="space-y-3">
					<Label class="font-semibold">ตำบล / แขวง</Label>
					<Input bind:value={formData.subdistrict} placeholder="เช่น บ้านพรุ" class="bg-background h-11" required />
				</div>
				<div class="space-y-3">
					<Label class="font-semibold">อำเภอ / เขต</Label>
					<Input bind:value={formData.district} placeholder="เช่น หาดใหญ่" class="bg-background h-11" required />
				</div>
				<div class="space-y-3">
					<Label class="font-semibold">จังหวัด</Label>
					<Input bind:value={formData.province} placeholder="เช่น สงขลา" class="bg-background h-11" required />
				</div>
				<div class="space-y-3">
					<Label class="font-semibold">รหัสไปรษณีย์</Label>
					<Input bind:value={formData.postal_code} placeholder="เช่น 90250" class="bg-background h-11" required />
				</div>
			</div>

			<div class="mt-8 flex justify-end gap-3">
				<Button type="button" variant="outline" onclick={() => showNewHouseholdForm = false}>ยกเลิก</Button>
				<Button type="submit" disabled={pending} class="bg-[#003B71] hover:bg-[#002a50]">บันทึกครอบครัวใหม่</Button>
			</div>

			<div class="mt-8 rounded-xl border border-orange-200 bg-orange-50/50 p-4">
				<p class="text-sm font-medium text-orange-800 flex items-start gap-2">
					<span class="text-base mt-0.5">👑</span> 
					<span class="leading-relaxed">
						คุณได้รับการตั้งค่าเป็น <span class="font-bold">หัวหน้าครอบครัว (Family Head)</span> 
						ของที่อยู่นี้โดยอัตโนมัติ สมาชิกครอบครัวคนอื่นที่ลงทะเบียนด้วยที่อยู่นี้จะสามารถเข้าร่วมกลุ่มภายหลังได้
					</span>
				</p>
			</div>
		</form>
	{/if}
</div>
