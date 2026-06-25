<script lang="ts">
	import Search from '@lucide/svelte/icons/search';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import Check from '@lucide/svelte/icons/check';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { useEvacuees } from '$lib/features/people';
	import type { Evacuee } from '$lib/features/people';

	let { onNext }: { onNext: () => void } = $props();

	let query = $state('');
	let hasSearched = $state(false);
	let searchResult = $state<Evacuee | null>(null);

	const evacueesQuery = useEvacuees();

	function doSearch() {
		if (!query.trim()) {
			hasSearched = false;
			searchResult = null;
			return;
		}

		const q = query.trim().toLowerCase();
		const data = evacueesQuery.data || [];

		const found = data.find(e => {
			if (e.person_id?.number && e.person_id.number.replace(/\D/g, '').includes(q.replace(/\D/g, ''))) return true;
			if (e.phone && e.phone.replace(/\D/g, '').includes(q.replace(/\D/g, ''))) return true;
			if (e.first_name.toLowerCase().includes(q)) return true;
			if (e.last_name.toLowerCase().includes(q)) return true;
			const fullName = `${e.first_name} ${e.last_name}`.toLowerCase();
			if (fullName.includes(q)) return true;
			return false;
		});

		searchResult = found || null;
		hasSearched = true;
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			doSearch();
		}
	}
</script>

<div class="mx-auto w-full max-w-3xl space-y-8 pt-4">
	<div class="space-y-2">
		<h2 class="flex items-center gap-2 text-xl font-bold text-foreground">
			<Search class="h-6 w-6" />
			ตรวจสอบประวัติการลงทะเบียน
		</h2>
		<p class="text-sm text-muted-foreground">
			กรุณากรอกเลขบัตรประชาชน, เบอร์โทรศัพท์ หรือชื่อ-นามสกุล เพื่อตรวจสอบว่าเคยลงทะเบียนในระบบหรือไม่
		</p>
	</div>

	<div class="rounded-xl border border-border bg-card p-6 shadow-sm">
		<div class="space-y-4">
			<div class="relative">
				<Search class="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
				<Input
					type="text"
					placeholder="เลขบัตรประชาชน / เบอร์โทร / ชื่อ-นามสกุล"
					bind:value={query}
					onkeydown={handleKeyDown}
					class="h-12 pl-10 bg-muted/50 border-transparent focus-visible:border-primary"
				/>
			</div>

			<Button type="button" class="w-full h-12 bg-[#0C2D4E] hover:bg-[#0A2647] text-white text-base font-medium" onclick={doSearch}>
				ตรวจสอบข้อมูล
			</Button>
		</div>
	</div>

	{#if hasSearched}
		{#if searchResult}
			<!-- พบข้อมูล -->
			<div class="flex items-start gap-4 rounded-xl border border-green-200 bg-[#F0FDF4] p-6">
				<div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-600">
					<Check class="h-6 w-6" />
				</div>
				<div class="space-y-4 w-full">
					<div>
						<h3 class="text-lg font-bold text-green-800">พบข้อมูลในระบบแล้ว</h3>
						<p class="text-sm font-medium text-green-700">ชื่อ: {searchResult.first_name} {searchResult.last_name} (สถานะ: {searchResult.current_stay.status})</p>
					</div>
					<div class="flex gap-4">
						<Button type="button" class="flex-1 bg-[#10b981] hover:bg-[#059669] text-white font-semibold h-11 rounded-lg">
							ดู / แก้ไขข้อมูล
						</Button>
						<Button type="button" variant="outline" class="flex-1 bg-white hover:bg-green-50 text-green-700 border border-green-200 font-semibold h-11 rounded-lg" onclick={onNext}>
							ลงทะเบียนใหม่แทน
						</Button>
					</div>
				</div>
			</div>
		{:else}
			<!-- ไม่พบข้อมูล -->
			<div class="flex items-start gap-4 rounded-xl border border-blue-100 bg-[#F4F8FA] p-6">
				<div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[#0C2D4E]">
					<UserPlus class="h-6 w-6" />
				</div>
				<div class="space-y-3">
					<div>
						<h3 class="text-lg font-bold text-[#0C2D4E]">ไม่พบข้อมูลในระบบ</h3>
						<p class="text-sm text-[#0C2D4E]/80">ผู้ลี้ภัยรายนี้ยังไม่เคยลงทะเบียน กรุณาดำเนินการลงทะเบียนใหม่</p>
					</div>
					<Button type="button" class="bg-[#0C2D4E] hover:bg-[#0A2647] text-white" onclick={onNext}>
						ลงทะเบียนใหม่
					</Button>
				</div>
			</div>
		{/if}
	{/if}
</div>
