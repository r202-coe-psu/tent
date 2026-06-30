<script lang="ts">
	import { onMount } from 'svelte';
	import Heart from '@lucide/svelte/icons/heart';
	import Compass from '@lucide/svelte/icons/compass';
	import Search from '@lucide/svelte/icons/search';
	import Building from '@lucide/svelte/icons/building';
	import { donationStore } from '../../routes/public/donations/donation.svelte';

	let searchTerm = $state('');
	let filterType = $state('all');
	let isLoading = $state(false);

	// mock data until API is integrated
	let shelters = $state([
		{
			code: 'SH001',
			name: 'ศูนย์พักพิง เทศบาลนครเชียงใหม่',
			needs: [
				{ item_id: '1', name: 'น้ำดื่ม', qty_needed: 300, unit: 'แพ็ค' },
				{ item_id: '2', name: 'ข้าวกล่อง', qty_needed: 150, unit: 'กล่อง' }
			]
		}
	]);

	let filteredShelters = $derived(
		shelters.filter((s) => {
			if (searchTerm && !s.name.includes(searchTerm)) return false;
			if (filterType !== 'all') {
				// simple mock filter
				if (
					filterType === 'food' &&
					!s.needs.some((n) => n.name.includes('น้ำ') || n.name.includes('ข้าว'))
				)
					return false;
				if (filterType === 'medical' && !s.needs.some((n) => n.name.includes('ยา'))) return false;
				if (filterType === 'urgent' && !s.needs.some((n) => n.qty_needed >= 250)) return false;
			}
			return true;
		})
	);

	function splitShelterName(name: string) {
		const parts = name.split(' ');
		return { title: parts[0], subtext: parts.slice(1).join(' ') };
	}

	function formatUnit(unit: string, name: string) {
		return unit;
	}

	function selectShelterAndItem(
		shelterCode: string,
		itemName?: string,
		unit?: string,
		itemId?: string
	) {
		// implement navigation or logic here
	}
</script>

<div class="rounded-3xl border border-border bg-card p-6 shadow-xs md:p-8">
	<div
		class="mb-6 flex flex-col justify-between gap-4 border-b border-border/60 pb-6 md:flex-row md:items-center"
	>
		<div>
			<h2 class="flex items-center gap-2 text-base font-bold text-foreground">
				<Heart class="h-5 w-5 text-primary" />
				กระดานความต้องการด่วน
			</h2>
			<p class="mt-1 text-xs text-muted-foreground">
				อัปเดตข้อมูลแบบเรียลไทม์จากทุกศูนย์พักพิง คุณสามารถช่วยเหลือเติมเต็มในส่วนที่ขาดแคลนได้ทันที
			</p>
		</div>
		<!-- Search -->
		<div class="relative w-full md:w-80">
			<input
				type="text"
				placeholder="ค้นหาสิ่งของที่ต้องการบริจาค เช่น น้ำดื่ม, ยาสามัญ..."
				bind:value={searchTerm}
				class="w-full rounded-xl border border-border bg-muted/20 px-3 py-2 pl-9 text-xs text-foreground outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
			/>
			<Search class="absolute top-2.5 left-3 h-3.5 w-3.5 text-muted-foreground" />
		</div>
	</div>

	<!-- Categories -->
	<div class="mb-6 flex flex-wrap gap-2">
		<button
			onclick={() => (filterType = 'all')}
			class="cursor-pointer rounded-full px-4 py-2 text-xs font-bold transition-all {filterType ===
			'all'
				? 'bg-[#1d1d1f] text-white shadow-sm'
				: 'bg-[#f5f5f7] text-[#1d1d1f] hover:bg-[#e8e8ed]'}"
		>
			ทั้งหมด
		</button>
		<button
			onclick={() => (filterType = 'urgent')}
			class="flex cursor-pointer items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold transition-all {filterType ===
			'urgent'
				? 'border border-red-200 bg-red-50 text-red-700 shadow-sm'
				: 'bg-[#f5f5f7] text-[#1d1d1f] hover:bg-[#e8e8ed]'}"
		>
			<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500"></span>
			ด่วนพิเศษ
		</button>
		<button
			onclick={() => (filterType = 'food')}
			class="cursor-pointer rounded-full px-4 py-2 text-xs font-bold transition-all {filterType ===
			'food'
				? 'bg-[#0071e3] text-white shadow-sm'
				: 'bg-[#f5f5f7] text-[#1d1d1f] hover:bg-[#e8e8ed]'}"
		>
			อาหาร & น้ำ
		</button>
		<button
			onclick={() => (filterType = 'medical')}
			class="cursor-pointer rounded-full px-4 py-2 text-xs font-bold transition-all {filterType ===
			'medical'
				? 'bg-[#10b981] text-white shadow-sm'
				: 'bg-[#f5f5f7] text-[#1d1d1f] hover:bg-[#e8e8ed]'}"
		>
			ยารักษาโรค
		</button>
	</div>

	<!-- Shelter list -->
	<div class="flex flex-col gap-6">
		{#if isLoading}
			<div class="py-8 text-center text-xs text-muted-foreground">กำลังโหลดข้อมูล...</div>
		{:else if filteredShelters.length === 0}
			<div class="py-8 text-center text-xs text-muted-foreground">
				ไม่พบข้อมูลความต้องการที่ตรงกับการค้นหา
			</div>
		{:else}
			{#each filteredShelters as shelter (shelter.code)}
				{@const nameParts = splitShelterName(shelter.name)}
				<div
					class="flex flex-col gap-6 rounded-[24px] border border-black/[0.04] bg-white p-5 shadow-xs transition-all hover:shadow-md md:flex-row md:p-6"
				>
					<!-- Left: Shelter & Needs info -->
					<div class="flex-1 space-y-4">
						<div class="flex items-center justify-between gap-3 md:justify-start">
							<div class="flex items-center gap-2 text-base font-bold text-[#1d1d1f]">
								<Building class="shrink-0 text-[#0071e3]" size={18} />
								<div>
									<span class="block text-base font-bold text-[#1d1d1f]">{nameParts.title}</span>
									{#if nameParts.subtext}
										<span class="block text-[11px] font-medium text-[#86868b]"
											>{nameParts.subtext}</span
										>
									{/if}
								</div>
							</div>
							<div
								class="shrink-0 rounded-full border border-[#0071e3]/20 bg-[#0071e3]/10 px-2 py-0.5 text-[10px] font-bold tracking-wider text-[#0071e3] uppercase"
							>
								เปิดรับบริจาค
							</div>
						</div>

						<!-- Needs list inside shelter -->
						<div class="flex flex-col gap-2">
							{#each shelter.needs as need}
								{@const isUrgent =
									need.qty_needed >= 250 || need.name.includes('น้ำ') || need.name.includes('ยา')}
								{#if isUrgent}
									<!-- รายการด่วนพิเศษ (ด่วน!) -->
									<button
										type="button"
										onclick={() =>
											selectShelterAndItem(
												shelter.code,
												need.name,
												formatUnit(need.unit, need.name),
												need.item_id
											)}
										class="flex w-full cursor-pointer items-center justify-between rounded-xl border border-red-100 bg-red-50 px-3.5 py-2.5 text-left text-xs transition-colors select-none hover:bg-red-100/50"
									>
										<span class="flex items-center gap-2 text-sm font-bold text-red-700">
											<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500"></span>
											ด่วน! {need.name}
										</span>
										<span
											class="rounded border border-slate-100 bg-white px-2 py-1 text-xs font-black text-slate-700 shadow-sm"
										>
											ขาด {need.qty_needed}
											{formatUnit(need.unit, need.name)}
										</span>
									</button>
								{:else}
									<!-- รายการปกติ -->
									<button
										type="button"
										onclick={() =>
											selectShelterAndItem(
												shelter.code,
												need.name,
												formatUnit(need.unit, need.name),
												need.item_id
											)}
										class="flex w-full cursor-pointer items-center justify-between rounded-xl border border-black/[0.04] bg-[#f5f5f7] px-3.5 py-2.5 text-left text-xs transition-colors select-none hover:bg-[#e8e8ed]/70"
									>
										<span class="flex items-center gap-2 text-sm font-bold text-[#1d1d1f]">
											{#if need.name.includes('ข้าว')}🍚{:else if need.name.includes('สบู่')}🧼{:else}📦{/if}
											{need.name}
										</span>
										<span
											class="rounded border border-black/[0.04] bg-white px-2 py-1 text-[12px] font-bold text-[#86868b] shadow-sm"
										>
											ขาด {need.qty_needed}
											{formatUnit(need.unit, need.name)}
										</span>
									</button>
								{/if}
							{/each}

							<!-- สถานะการรับบริจาคเสื้อผ้า (งดรับ - ต้นสต๊อก 120%) -->
							{#if filterType === 'all'}
								<div
									class="flex w-full items-center justify-between rounded-xl border border-black/[0.04] bg-[#f5f5f7] px-3.5 py-2.5 text-xs text-[#86868b] line-through opacity-60 grayscale select-none"
								>
									<span class="text-sm font-bold"> งดรับเสื้อผ้ามือสอง </span>
									<span
										class="inline-block rounded border border-black/[0.04] bg-white px-2 py-1 text-[12px] font-bold no-underline shadow-sm"
									>
										ต้นสต๊อก 120%
									</span>
								</div>
							{/if}
						</div>
					</div>

					<!-- Right: Actions -->
					<div
						class="flex shrink-0 flex-col justify-end border-t border-black/[0.04] pt-4 md:w-48 md:border-t-0 md:border-l md:pt-0 md:pl-6"
					>
						<button
							onclick={() => selectShelterAndItem(shelter.code)}
							class="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#0071e3] px-4 py-3 text-center text-[13px] font-bold text-white shadow-sm transition-colors hover:bg-[#1557b0] active:scale-[0.98] sm:text-sm"
						>
							จองคิวบริจาค
							<span>→</span>
						</button>
						<p class="mt-3 hidden text-center text-[10px] font-medium text-[#86868b] md:block">
							ช่วยลดความแออัดหน้าศูนย์
						</p>
					</div>
				</div>
			{/each}
		{/if}
	</div>
</div>
