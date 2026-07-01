<script lang="ts">
	import { onMount } from 'svelte';
	import Heart from '@lucide/svelte/icons/heart';
	import Compass from '@lucide/svelte/icons/compass';
	import Search from '@lucide/svelte/icons/search';
	import { getDonationStore } from '../../routes/public/donations/donation.svelte';
	import { Button } from '$lib/components/ui/button';

	const donationStore = getDonationStore();

	interface Need {
		item_id: string;
		name: string;
		qty_needed: number;
		unit: string;
		status: 'open' | 'closed';
	}
	interface ShelterNeeds {
		code: string;
		name: string;
		needs: Need[];
	}

	let shelters = $state<ShelterNeeds[]>([]);
	let isLoading = $state(true);
	let loadError = $state('');
	let search = $state('');

	onMount(async () => {
		try {
			const res = await fetch('/api/public/v1/needs');
			if (res.ok) {
				shelters = await res.json();
			} else {
				loadError = 'ไม่สามารถโหลดข้อมูลความต้องการได้ในขณะนี้';
			}
		} catch {
			loadError = 'เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์';
		} finally {
			isLoading = false;
		}
	});

	// กรองตามคำค้น (ชื่อไอเทม) — ซ่อนศูนย์ที่ไม่มีไอเทมตรงคำค้น
	const filteredShelters = $derived.by(() => {
		const q = search.trim().toLowerCase();
		if (!q) return shelters;
		return shelters
			.map((s) => ({ ...s, needs: s.needs.filter((n) => n.name.toLowerCase().includes(q)) }))
			.filter((s) => s.needs.length > 0);
	});

	// แปลงหน่วยจาก catalog (canonical อังกฤษ) → ไทยอ่านง่าย เฉพาะการแสดงผลบนกระดาน (ไม่แตะข้อมูลจริง)
	const UNIT_LABEL: Record<string, string> = {
		kg: 'กก.',
		bottle: 'ขวด',
		bar: 'ก้อน',
		piece: 'ชิ้น',
		tablet: 'เม็ด',
		box: 'กล่อง',
		pack: 'แพ็ค'
	};
	function formatUnit(unit: string): string {
		return UNIT_LABEL[unit] ?? unit;
	}

	// คลิกไอเทมที่ยังขาด → ตั้งศูนย์ปลายทาง (ล็อก) + pre-fill รายการ แล้วไปฟอร์ม
	function pickNeed(shelter: ShelterNeeds, need: Need) {
		if (need.status === 'closed') return;
		donationStore.selectedShelter = shelter.code;
		donationStore.selectedShelterName = shelter.name;
		donationStore.shelterCode = shelter.code;
		donationStore.shelterLocked = true;
		donationStore.items = [
			{
				id: crypto.randomUUID(),
				item_id: need.item_id,
				name: need.name,
				amount: 1,
				unit: formatUnit(need.unit),
				condition: '',
				remark: ''
			}
		];
		donationStore.activeTab = 'form';
		if (donationStore.reachedStep < 2) donationStore.reachedStep = 2;
	}

	// บริจาคให้ศูนย์นี้ (ไม่เจาะจงไอเทม) → ตั้งศูนย์ปลายทาง (ล็อก) แล้วไปฟอร์ม
	function pickShelter(shelter: ShelterNeeds) {
		donationStore.selectedShelter = shelter.code;
		donationStore.selectedShelterName = shelter.name;
		donationStore.shelterCode = shelter.code;
		donationStore.shelterLocked = true;
		donationStore.activeTab = 'form';
		if (donationStore.reachedStep < 2) donationStore.reachedStep = 2;
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
				อัปเดตข้อมูลจากทุกศูนย์พักพิง คุณสามารถช่วยเหลือเติมเต็มในส่วนที่ขาดแคลนได้ทันที
			</p>
		</div>
		<!-- Search -->
		<div class="relative w-full md:w-80">
			<input
				type="text"
				bind:value={search}
				placeholder="ค้นหาสิ่งของที่ต้องการบริจาค เช่น น้ำดื่ม, ยาสามัญ..."
				class="w-full rounded-xl border border-border bg-muted/20 px-3 py-2 pl-9 text-xs text-foreground outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
			/>
			<Search class="absolute top-2.5 left-3 h-3.5 w-3.5 text-muted-foreground" />
		</div>
	</div>

	<!-- Categories -->
	<div class="mb-6 flex flex-wrap gap-2">
		<Button class="rounded-full px-4 text-xs font-bold">ทั้งหมด</Button>
		<Button
			variant="outline"
			class="rounded-full border border-border px-4 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
			>ด่วนพิเศษ</Button
		>
		<Button
			variant="outline"
			class="rounded-full border border-border px-4 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
			>อาหาร & น้ำ</Button
		>
		<Button
			variant="outline"
			class="rounded-full border border-border px-4 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
			>ยารักษาโรค</Button
		>
	</div>

	{#if isLoading}
		<p class="py-10 text-center text-xs text-muted-foreground">กำลังโหลดข้อมูลความต้องการ...</p>
	{:else if loadError}
		<p class="py-10 text-center text-xs font-bold text-danger">{loadError}</p>
	{:else if filteredShelters.length === 0}
		<p class="py-10 text-center text-xs text-muted-foreground">
			{search.trim() ? 'ไม่พบสิ่งของที่ค้นหา' : 'ขณะนี้ยังไม่มีรายการความต้องการ'}
		</p>
	{:else}
		<div class="flex flex-col gap-6">
			{#each filteredShelters as shelter (shelter.code)}
				<div
					class="flex flex-col justify-between gap-6 rounded-2xl border border-border bg-muted/5 p-5 md:flex-row md:items-center"
				>
					<div class="flex-1">
						<div class="flex items-center gap-2.5">
							<span class="rounded-lg border border-blue-100 bg-blue-50 p-1 text-blue-600">
								<Compass class="h-4 w-4" />
							</span>
							<div>
								<h3 class="text-sm font-bold text-foreground">{shelter.name}</h3>
								<p class="text-xs text-muted-foreground">{shelter.code}</p>
							</div>
							<span
								class="ml-2 rounded-full bg-primary-muted px-2.5 py-0.5 text-xs font-bold text-primary"
							>
								เปิดรับบริจาค
							</span>
						</div>

						<!-- Needs list inside shelter -->
						<div class="mt-4 flex flex-col gap-2">
							{#if shelter.needs.length === 0}
								<p class="text-xs text-muted-foreground">ยังไม่มีรายการความต้องการเฉพาะ</p>
							{/if}
							{#each shelter.needs as need (need.item_id)}
								{#if need.status === 'closed'}
									<div
										class="flex items-center justify-between rounded-lg bg-muted/40 px-3.5 py-2 text-xs text-muted-foreground"
									>
										<span class="line-through">{need.name}</span>
										<span class="text-xs font-bold">งดรับ (ครบแล้ว)</span>
									</div>
								{:else}
									<button
										type="button"
										onclick={() => pickNeed(shelter, need)}
										class="flex cursor-pointer items-center justify-between rounded-lg border border-danger-border/30 bg-danger-muted/20 px-3.5 py-2 text-left text-xs transition-colors hover:bg-danger-muted/30"
									>
										<span class="font-bold text-danger">• ด่วน! {need.name}</span>
										<span
											class="rounded-md border border-danger/10 bg-white px-2 py-0.5 text-xs font-bold text-danger"
										>
											ขาด {need.qty_needed}
											{formatUnit(need.unit)}
										</span>
									</button>
								{/if}
							{/each}
						</div>
					</div>

					<div
						class="flex shrink-0 flex-col items-center justify-center pt-4 md:border-l md:border-border/60 md:pt-0 md:pl-6"
					>
						<Button
							onclick={() => pickShelter(shelter)}
							class="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-5 py-6 text-xs font-bold text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 md:w-auto"
						>
							จองคิวบริจาค
							<span>→</span>
						</Button>
						<span class="mt-2 text-center text-xs text-muted-foreground"
							>ช่วยลดความแออัดหน้าศูนย์</span
						>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
