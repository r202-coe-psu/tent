<script lang="ts">
	import { onMount } from 'svelte';
	import Heart from '@lucide/svelte/icons/heart';
	import Compass from '@lucide/svelte/icons/compass';
	import Search from '@lucide/svelte/icons/search';
	import { donationStore } from '../../routes/public/donations/donation.svelte';
</script>

<div class="rounded-3xl border border-border bg-card p-6 md:p-8 shadow-xs">
	<div class="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border/60 pb-6 mb-6">
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
				class="w-full rounded-xl border border-border bg-muted/20 px-3 py-2 pl-9 text-xs outline-hidden focus:ring-1 focus:ring-primary focus:border-primary text-foreground"
			/>
			<Search class="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
		</div>
	</div>

	<!-- Categories -->
	<div class="flex flex-wrap gap-2 mb-6">
		<button
			onclick={() => filterType = 'all'}
			class="rounded-full px-4 py-2 text-xs font-bold transition-all cursor-pointer {filterType === 'all' ? 'bg-[#1d1d1f] text-white shadow-sm' : 'bg-[#f5f5f7] text-[#1d1d1f] hover:bg-[#e8e8ed]'}"
		>
			ทั้งหมด
		</button>
		<button
			onclick={() => filterType = 'urgent'}
			class="rounded-full px-4 py-2 text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 {filterType === 'urgent' ? 'bg-red-50 text-red-700 border border-red-200 shadow-sm' : 'bg-[#f5f5f7] text-[#1d1d1f] hover:bg-[#e8e8ed]'}"
		>
			<span class="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>
			ด่วนพิเศษ
		</button>
		<button
			onclick={() => filterType = 'food'}
			class="rounded-full px-4 py-2 text-xs font-bold transition-all cursor-pointer {filterType === 'food' ? 'bg-[#0071e3] text-white shadow-sm' : 'bg-[#f5f5f7] text-[#1d1d1f] hover:bg-[#e8e8ed]'}"
		>
			อาหาร & น้ำ
		</button>
		<button
			onclick={() => filterType = 'medical'}
			class="rounded-full px-4 py-2 text-xs font-bold transition-all cursor-pointer {filterType === 'medical' ? 'bg-[#10b981] text-white shadow-sm' : 'bg-[#f5f5f7] text-[#1d1d1f] hover:bg-[#e8e8ed]'}"
		>
			ยารักษาโรค
		</button>
	</div>

	<!-- Shelter list -->
	<div class="flex flex-col gap-6">
		{#if isLoading}
			<div class="text-center py-8 text-xs text-muted-foreground">กำลังโหลดข้อมูล...</div>
		{:else if filteredShelters.length === 0}
			<div class="text-center py-8 text-xs text-muted-foreground">ไม่พบข้อมูลความต้องการที่ตรงกับการค้นหา</div>
		{:else}
			{#each filteredShelters as shelter (shelter.code)}
				{@const nameParts = splitShelterName(shelter.name)}
				<div class="bg-white rounded-[24px] border border-black/[0.04] p-5 md:p-6 shadow-xs flex flex-col md:flex-row gap-6 hover:shadow-md transition-all">
					<!-- Left: Shelter & Needs info -->
					<div class="flex-1 space-y-4">
						<div class="flex items-center justify-between md:justify-start gap-3">
							<div class="font-bold text-[#1d1d1f] text-base flex items-center gap-2">
								<Building class="text-[#0071e3] shrink-0" size={18} />
								<div>
									<span class="block text-[#1d1d1f] text-base font-bold">{nameParts.title}</span>
									{#if nameParts.subtext}
										<span class="block text-[11px] text-[#86868b] font-medium">{nameParts.subtext}</span>
									{/if}
								</div>
							</div>
							<div class="text-[10px] font-bold text-[#0071e3] bg-[#0071e3]/10 border border-[#0071e3]/20 px-2 py-0.5 rounded-full uppercase tracking-wider shrink-0">
								เปิดรับบริจาค
							</div>
						</div>

						<!-- Needs list inside shelter -->
						<div class="flex flex-col gap-2">
							{#each shelter.needs as need}
								{@const isUrgent = need.qty_needed >= 250 || need.name.includes('น้ำ') || need.name.includes('ยา')}
								{#if isUrgent}
									<!-- รายการด่วนพิเศษ (ด่วน!) -->
									<button
										type="button"
										onclick={() => selectShelterAndItem(shelter.code, need.name, formatUnit(need.unit, need.name), need.item_id)}
										class="flex w-full items-center justify-between rounded-xl bg-red-50 border border-red-100 px-3.5 py-2.5 text-xs transition-colors hover:bg-red-100/50 cursor-pointer select-none text-left"
									>
										<span class="text-red-700 text-sm font-bold flex items-center gap-2">
											<span class="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>
											ด่วน! {need.name}
										</span>
										<span class="text-xs font-black text-slate-700 bg-white px-2 py-1 rounded shadow-sm border border-slate-100">
											ขาด {need.qty_needed} {formatUnit(need.unit, need.name)}
										</span>
									</button>
								{:else}
									<!-- รายการปกติ -->
									<button
										type="button"
										onclick={() => selectShelterAndItem(shelter.code, need.name, formatUnit(need.unit, need.name), need.item_id)}
										class="flex w-full items-center justify-between rounded-xl bg-[#f5f5f7] border border-black/[0.04] px-3.5 py-2.5 text-xs transition-colors hover:bg-[#e8e8ed]/70 cursor-pointer select-none text-left"
									>
										<span class="text-[#1d1d1f] text-sm font-bold flex items-center gap-2">
											{#if need.name.includes('ข้าว')}🍚{:else if need.name.includes('สบู่')}🧼{:else}📦{/if} {need.name}
										</span>
										<span class="text-[12px] font-bold text-[#86868b] bg-white px-2 py-1 rounded border border-black/[0.04] shadow-sm">
											ขาด {need.qty_needed} {formatUnit(need.unit, need.name)}
										</span>
									</button>
								{/if}
							{/each}

							<!-- สถานะการรับบริจาคเสื้อผ้า (งดรับ - ต้นสต๊อก 120%) -->
							{#if filterType === 'all'}
								<div class="flex w-full items-center justify-between rounded-xl bg-[#f5f5f7] border border-black/[0.04] px-3.5 py-2.5 text-xs opacity-60 grayscale line-through text-[#86868b] select-none">
									<span class="text-sm font-bold">
										งดรับเสื้อผ้ามือสอง
									</span>
									<span class="text-[12px] font-bold bg-white px-2 py-1 rounded border border-black/[0.04] shadow-sm no-underline inline-block">
										ต้นสต๊อก 120%
									</span>
								</div>
							{/if}
						</div>
					</div>

					<!-- Right: Actions -->
					<div class="md:w-48 shrink-0 flex flex-col justify-end pt-4 md:pt-0 border-t md:border-t-0 md:border-l border-black/[0.04] md:pl-6">
						<button
							onclick={() => selectShelterAndItem(shelter.code)}
							class="bg-[#0071e3] text-white px-4 py-3 rounded-xl font-bold shadow-sm hover:bg-[#1557b0] transition-colors w-full text-center active:scale-[0.98] text-[13px] sm:text-sm flex items-center justify-center gap-2 cursor-pointer"
						>
							จองคิวบริจาค
							<span>→</span>
						</button>
						<p class="text-[10px] text-center text-[#86868b] mt-3 font-medium hidden md:block">ช่วยลดความแออัดหน้าศูนย์</p>
					</div>
				</div>
			{/each}
		{/if}
	</div>
</div>
