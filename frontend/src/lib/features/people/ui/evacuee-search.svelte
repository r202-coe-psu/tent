<script lang="ts">
	import Search from '@lucide/svelte/icons/search';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import Check from '@lucide/svelte/icons/check';
	import Loader from '@lucide/svelte/icons/loader';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { useSearchEvacuees } from '$lib/features/people';
	import type { StayStatus } from '$lib/features/people';

	const STATUS_LABELS: Record<StayStatus, string> = {
		registered: 'ลงทะเบียนแล้ว',
		checked_in: 'เข้าพักแล้ว',
		checked_out: 'ออกไปแล้ว',
		transferred: 'ย้ายไปแล้ว'
	};

	let { onNext }: { onNext: () => void } = $props();

	let query = $state('');
	let debouncedQuery = $state('');

	let debounceTimer: ReturnType<typeof setTimeout>;

	$effect(() => {
		const q = query.trim();
		clearTimeout(debounceTimer);
		if (!q) {
			debouncedQuery = '';
			return;
		}
		debounceTimer = setTimeout(() => {
			debouncedQuery = q;
		}, 300);
		return () => clearTimeout(debounceTimer);
	});

	const searchQuery = useSearchEvacuees(
		() => debouncedQuery,
		() => !!debouncedQuery
	);

	const searchResults = $derived(searchQuery.data ?? []);
	const isSearching = $derived(searchQuery.isFetching && !!debouncedQuery);
	const hasSearched = $derived(
		!!debouncedQuery && !searchQuery.isFetching && searchQuery.data !== undefined
	);

	function viewEvacueeDetail(id: string) {
		goto(resolve(`/onsite/people/evacuee-profile-view/${id}`));
	}
</script>

<div class="w-full space-y-6 pt-4">
	<div class="mx-auto w-full max-w-3xl space-y-6">
		<div class="space-y-2">
			<h2 class="flex items-center gap-2 text-xl font-bold text-foreground">
				<Search class="h-6 w-6" />
				ตรวจสอบประวัติการลงทะเบียน
			</h2>
			<p class="text-sm text-muted-foreground">
				กรุณากรอกเลขบัตรประชาชน, เบอร์โทรศัพท์ หรือชื่อ-นามสกุล
				เพื่อตรวจสอบว่าเคยลงทะเบียนในระบบหรือไม่
			</p>
		</div>

		<div class="rounded-xl border border-border bg-card p-6 shadow-sm">
			<div class="space-y-4">
				<div class="relative">
					{#if isSearching}
						<Loader
							class="absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 animate-spin text-muted-foreground"
						/>
					{:else}
						<Search
							class="absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-muted-foreground"
						/>
					{/if}
					<Input
						type="text"
						placeholder="เลขบัตรประชาชน / เบอร์โทร / ชื่อ-นามสกุล"
						bind:value={query}
						class="h-12 border-transparent bg-muted/50 pl-10 focus-visible:border-primary"
					/>
				</div>

				<Button
					type="button"
					variant="outline"
					class="flex h-12 w-full items-center justify-center gap-2 border-[#0C2D4E] text-base font-medium text-[#0C2D4E] hover:bg-[#0C2D4E]/10"
					onclick={onNext}
				>
					<UserPlus class="h-5 w-5" />
					ลงทะเบียนใหม่
				</Button>
			</div>
		</div>

		{#if isSearching}
			<div class="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
				<Loader class="h-4 w-4 animate-spin" />
				กำลังค้นหา...
			</div>
		{:else if searchQuery.isError}
			<p
				class="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
			>
				เกิดข้อผิดพลาดในการค้นหา กรุณาลองใหม่อีกครั้ง
			</p>
		{:else if hasSearched}
			{#if searchResults.length > 0}
				<div class="space-y-3">
					<div class="flex items-center gap-2">
						<Check class="h-5 w-5 text-green-600" />
						<h3 class="font-bold text-green-800">
							พบข้อมูลในระบบ {searchResults.length} ราย
						</h3>
					</div>

					<div class="space-y-2">
						{#each searchResults as evacuee (evacuee._id)}
							<div
								class="flex items-center justify-between gap-4 rounded-lg border border-green-200 bg-[#F0FDF4] px-4 py-3"
							>
								<div class="min-w-0">
									<p class="truncate font-semibold text-green-900">
										{evacuee.first_name}
										{evacuee.last_name}
									</p>
									<p class="text-xs text-green-700">
										สถานะ: {STATUS_LABELS[evacuee.current_stay.status] ??
											evacuee.current_stay.status}
										{#if evacuee.phone}
											· {evacuee.phone}
										{/if}
									</p>
								</div>
								<Button
									type="button"
									size="sm"
									class="shrink-0 bg-[#10b981] font-semibold text-white hover:bg-[#059669]"
									onclick={() => viewEvacueeDetail(evacuee._id)}
								>
									ดู / แก้ไข
								</Button>
							</div>
						{/each}
					</div>

					<Button
						type="button"
						variant="outline"
						class="h-11 w-full rounded-lg border border-green-200 bg-white font-semibold text-green-700 hover:bg-green-50"
						onclick={onNext}
					>
						<UserPlus class="h-4 w-4" />
						ลงทะเบียนใหม่แทน
					</Button>
				</div>
			{:else}
				<div class="flex items-start gap-4 rounded-xl border border-blue-100 bg-[#F4F8FA] p-6">
					<div
						class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[#0C2D4E]"
					>
						<UserPlus class="h-6 w-6" />
					</div>
					<div class="space-y-3">
						<div>
							<h3 class="text-lg font-bold text-[#0C2D4E]">ไม่พบข้อมูลในระบบ</h3>
							<p class="text-sm text-[#0C2D4E]/80">
								ผู้ลี้ภัยรายนี้ยังไม่เคยลงทะเบียน กรุณาดำเนินการลงทะเบียนใหม่
							</p>
						</div>
						<Button
							type="button"
							class="bg-[#0C2D4E] text-white hover:bg-[#0A2647]"
							onclick={onNext}
						>
							ลงทะเบียนใหม่
						</Button>
					</div>
				</div>
			{/if}
		{/if}
	</div>
</div>
