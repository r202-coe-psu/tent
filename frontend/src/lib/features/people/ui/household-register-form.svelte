<script lang="ts">
	import type { Household, Evacuee, HouseholdInput } from '../domain/people';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import Search from '@lucide/svelte/icons/search';
	import X from '@lucide/svelte/icons/x';
	import Plus from '@lucide/svelte/icons/plus';
	import User from '@lucide/svelte/icons/user';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import CheckSquare from '@lucide/svelte/icons/check-square';
	import Check from '@lucide/svelte/icons/check';

	let {
		allEvacuees = [],
		households = [],
		onsubmit,
		onselect,
		pending = false,
		showNewHouseholdForm = $bindable(false)
	}: {
		allEvacuees?: Evacuee[];
		households?: Household[];
		onsubmit?: (input: Partial<HouseholdInput>) => void;
		onselect?: (household: Household) => void;
		pending?: boolean;
		showNewHouseholdForm?: boolean;
	} = $props();

	let searchMode: 'exact' | 'fuzzy' = $state('exact');
	let searchQuery = $state('');

	let searchState: 'idle' | 'found' | 'not_found' = $state('idle');

	let foundResults = $state<{ 
		household: Household; 
		evacuee: Evacuee | null; 
		count: number;
		members: Evacuee[];
		expanded: boolean;
	}[]>([]);

	let selectedHouseholdId = $state<string | null>(null);
	let selectedResult = $derived(foundResults.find(r => r.household._id === selectedHouseholdId));

	let formData = $state({
		address_no: '',
		village_no: '',
		subdistrict: '',
		district: '',
		province: '',
		postal_code: ''
	});

	function formatAddress(h: Household) {
		const parts = [];
		if (h.address_no) parts.push(h.address_no);
		else parts.push('-');
		
		if (h.village_no) {
			const v = h.village_no.replace(/^(ม\.|หมู่\s*)/, '');
			parts.push(`ม.${v}`);
		}
		if (h.subdistrict) {
			const s = h.subdistrict.replace(/^(ต\.|ตำบล\s*)/, '');
			parts.push(`ต.${s}`);
		}
		if (h.district) {
			const d = h.district.replace(/^(อ\.|อำเภอ\s*)/, '');
			parts.push(`อ.${d}`);
		}
		if (h.province) {
			const p = h.province.replace(/^(จ\.|จังหวัด\s*)/, '');
			parts.push(`จ.${p}`);
		}
		if (h.postal_code) parts.push(h.postal_code);
		
		return parts.join(' ');
	}

	function doSearch() {
		if (!searchQuery.trim()) {
			searchState = 'idle';
			return;
		}
		const query = searchQuery.trim().toLowerCase();

		if (searchMode === 'exact') {
			const hhList = households.filter(h => {
				if (!h.head_evacuee_id) return false;
				const head = allEvacuees.find(e => e._id === h.head_evacuee_id && !e.privacy?.search_excluded);
				if (!head) return false;
				return (
					(head.phone && head.phone.toLowerCase().includes(query)) ||
					(head.person_id?.number && head.person_id.number.toLowerCase().includes(query))
				);
			});
			if (hhList.length > 0) {
				foundResults = hhList.map(hh => {
					const members = allEvacuees.filter(e => e.household_id === hh._id);
					return {
						household: hh,
						evacuee: allEvacuees.find(e => e._id === hh.head_evacuee_id) || null,
						count: members.length,
						members,
						expanded: false
					};
				});
				searchState = 'found';
				showNewHouseholdForm = false;
				return;
			}
		} else {
			const hhList = households.filter(h => {
				const addr = `${h.address_no || ''} ${h.village_no || ''} ${h.subdistrict || ''} ${h.district || ''} ${h.province || ''}`.toLowerCase();
				return addr.includes(query);
			});
			if (hhList.length > 0) {
				foundResults = hhList.map(hh => {
					const members = allEvacuees.filter(e => e.household_id === hh._id);
					return {
						household: hh,
						evacuee: allEvacuees.find(e => e._id === hh.head_evacuee_id) || null,
						count: members.length,
						members,
						expanded: false
					};
				});
				searchState = 'found';
				showNewHouseholdForm = false;
				return;
			}
		}

		searchState = 'not_found';
		foundResults = [];
		selectedHouseholdId = null;
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
	{#if searchState === 'found' && foundResults.length > 0}
		<div class="space-y-4">
			<h3 class="text-lg font-bold flex items-center gap-2">
				🏡 พบ {foundResults.length} ครอบครัวที่ลงทะเบียนในระบบ
			</h3>
			
			<div class="space-y-3">
				{#each foundResults as result}
					{@const isSelected = selectedHouseholdId === result.household._id}
					<div class="rounded-xl border {isSelected ? 'border-green-300 bg-[#f0fdf4]' : 'border-border bg-white'} p-4 flex flex-col gap-4 shadow-sm transition-all">
						<div class="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
							<div class="space-y-2 flex-1">
								<div class="flex items-center gap-2 flex-wrap">
									<User class="h-5 w-5 text-[#003B71]" />
									<span class="font-bold text-[15px]">หัวหน้าครอบครัว: {result.evacuee ? `${result.evacuee.first_name} ${result.evacuee.last_name}` : result.household.label}</span>
									<button 
										type="button"
										class="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-md cursor-pointer transition-colors border select-none
											{result.expanded ? 'bg-white border-blue-600 text-blue-700' : 'bg-blue-50 border-transparent text-blue-700 hover:bg-blue-100'}"
										onclick={() => result.expanded = !result.expanded}
									>
										{result.count > 0 ? result.count : 1} คน (กดดูรายชื่อเพิ่มเติม)
										{#if result.expanded}
											<ChevronUp class="h-3 w-3" />
										{:else}
											<ChevronDown class="h-3 w-3" />
										{/if}
									</button>
								</div>
								<div class="flex items-start gap-2 text-sm text-muted-foreground ml-[2px]">
									<MapPin class="h-4 w-4 mt-0.5 shrink-0 text-red-500" />
									<span>ที่อยู่: {formatAddress(result.household)}</span>
								</div>
							</div>
							<Button 
								variant="outline" 
								class="shrink-0 rounded-xl font-medium px-4 h-10 {isSelected ? 'bg-[#00a86b] text-white hover:bg-[#00905a] border-transparent' : 'bg-gray-50 hover:bg-gray-100 border-border text-foreground'}" 
								onclick={() => {
									selectedHouseholdId = result.household._id;
									onselect?.(result.household);
								}}>
								{#if isSelected}
									<Check class="mr-2 h-4 w-4" /> เข้าร่วมแล้ว
								{:else}
									<span class="mr-2 h-3.5 w-3.5 rounded-full border-2 border-muted-foreground flex items-center justify-center">
										<span class="h-1.5 w-1.5 rounded-full bg-transparent"></span>
									</span>
									เลือกร่วมครอบครัวนี้
								{/if}
							</Button>
						</div>

						{#if result.expanded}
							<div class="border-t pt-4 mt-1">
								<h4 class="text-sm font-bold text-[#003B71] mb-3">รายชื่อสมาชิกในครอบครัว:</h4>
								
								{#if result.members.filter(m => m._id !== result.household.head_evacuee_id).length > 0}
									<ul class="space-y-2 text-sm text-muted-foreground pl-1">
										{#each result.members.filter(m => m._id !== result.household.head_evacuee_id) as member (member._id)}
											<li class="flex items-center gap-2">
												<span class="w-1.5 h-1.5 rounded-full bg-blue-300"></span>
												<span class="font-medium text-foreground">{member.first_name} {member.last_name}</span> 
												<span class="text-xs opacity-70">
													({member.person_id?.number ? member.person_id.number : (member.phone ? member.phone : 'ไม่มีข้อมูลระบุตัวตน')})
												</span>
											</li>
										{/each}
									</ul>
								{:else}
									<p class="text-sm text-muted-foreground italic">ยังไม่มีสมาชิกอื่นในครอบครัวนี้</p>
								{/if}
							</div>
						{/if}
					</div>
				{/each}
			</div>

			<button 
				type="button" 
				class="text-sm font-semibold text-[#003B71] hover:underline flex items-center gap-1 mt-4 ml-1"
				onclick={() => {
					showNewHouseholdForm = true;
					selectedHouseholdId = null;
				}}
			>
				<Plus class="h-4 w-4" /> หรือ ต้องการลงทะเบียนแยกเป็นครอบครัวใหม่ในที่อยู่นี้
			</button>
		</div>

		<!-- Selected Alert -->
		{#if selectedResult}
			<div class="mt-8 rounded-2xl border border-green-200 bg-[#ecfdf5] p-5 md:p-6 shadow-sm transition-all duration-300">
				<div class="flex items-start gap-3">
					<CheckSquare class="h-6 w-6 text-[#00a86b] shrink-0 mt-0.5" />
					<div class="space-y-1.5 text-green-900">
						<div class="font-bold text-[17px]">คุณเข้าร่วมครอบครัวเรียบร้อย!</div>
						<div class="text-[14px]">หัวหน้าครอบครัว: {selectedResult.evacuee ? `${selectedResult.evacuee.first_name} ${selectedResult.evacuee.last_name}` : selectedResult.household.label} ({selectedResult.count > 0 ? selectedResult.count : 1} คน)</div>
						<div class="text-[14px] mt-2"><strong>ที่อยู่ครอบครัว:</strong> {formatAddress(selectedResult.household)}</div>
					</div>
				</div>
			</div>
		{/if}
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



			<div class="mt-8 rounded-xl border border-orange-200 bg-orange-50/50 p-4">
				<p class="text-sm font-medium text-orange-800 flex items-start gap-2">
					<span class="text-base mt-0.5">👑</span> 
					<span class="leading-relaxed">
						คุณได้รับการตั้งค่าเป็น <span class="font-bold">หัวหน้าครอบครัว (Family Head)</span> 
						ของที่อยู่นี้โดยอัตโนมัติ สมาชิกครอบครัวคนอื่นที่ลงทะเบียนด้วยที่อยู่นี้จะสามารถเข้าร่วมกลุ่มภายหลังได้
					</span>
				</p>
			</div>

			<div class="mt-8 flex justify-end gap-3 border-t pt-6">
				<Button
					type="button"
					variant="outline"
					class="h-11 px-6"
					onclick={() => showNewHouseholdForm = false}
				>
					ยกเลิก
				</Button>
				<Button type="submit" disabled={pending} class="h-11 px-6 bg-[#003B71] hover:bg-[#002a50]">
					ถัดไป (ข้อมูลสัตว์เลี้ยง/ยานพาหนะ)
				</Button>
			</div>
		</form>
	{/if}
</div>
