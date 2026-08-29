<script lang="ts">
	import Search from '@lucide/svelte/icons/search';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import Check from '@lucide/svelte/icons/check';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import { useSearchEvacuees, STATUS_LABELS } from '$lib/features/people';

	import Sparkles from '@lucide/svelte/icons/sparkles';
	import Cpu from '@lucide/svelte/icons/cpu';
	import type { Evacuee } from '$lib/features/people';

	let {
		onNext,
		onSelectDraft
	}: {
		onNext: () => void;
		onSelectDraft?: (evacuee: Evacuee) => void;
	} = $props();

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

<div class="w-full space-y-4">
	<div class="space-y-3">
		<div class="relative">
			{#if isSearching}
				<Loader2
					class="absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 animate-spin text-muted-foreground"
				/>
			{:else}
				<Search class="absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
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

	{#if isSearching}
		<div class="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
			<Loader2 class="h-4 w-4 animate-spin" />
			กำลังค้นหา...
		</div>
	{:else if searchQuery.isError}
		<Alert.Root variant="destructive" class="border-destructive/40 bg-destructive/5">
			<CircleAlert class="size-4" />
			<Alert.Title class="font-semibold">ค้นหาไม่สำเร็จ</Alert.Title>
			<Alert.Description class="space-y-3">
				<p>เกิดข้อผิดพลาดในการค้นหา กรุณาลองใหม่อีกครั้ง</p>
				<Button type="button" variant="outline" size="sm" onclick={() => searchQuery.refetch()}>
					ลองใหม่
				</Button>
			</Alert.Description>
		</Alert.Root>
	{:else if hasSearched}
		{#if searchResults.length > 0}
			<div class="space-y-3">
				<div class="flex items-center gap-2">
					<Check class="h-5 w-5 text-green-600" />
					<h3 class="font-bold text-green-800">พบข้อมูลในระบบ {searchResults.length} ราย</h3>
				</div>

				<div class="space-y-2.5">
					{#each searchResults as evacuee (evacuee._id)}
						{@const isDraft = evacuee.current_stay.status === 'draft'}
						{@const isPreReg = evacuee.current_stay.status === 'pre_registered'}
						{@const hasCard = !!evacuee.card_snapshot}

						{#if isDraft}
							<!-- 🪪 Card Scanned Draft Card -->
							<div
								class="flex flex-col gap-3 rounded-xl border border-cyan-300 bg-cyan-50/70 p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between dark:border-cyan-800 dark:bg-cyan-950/30"
							>
								<div class="flex items-start gap-3">
									<div
										class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-600 text-white shadow-sm"
									>
										<Cpu class="h-5 w-5" />
									</div>
									<div class="min-w-0">
										<div class="flex flex-wrap items-center gap-2">
											<p class="font-bold text-cyan-950 dark:text-cyan-100">
												{evacuee.first_name}
												{evacuee.last_name}
											</p>
											<span
												class="inline-flex items-center gap-1 rounded-full bg-cyan-200/80 px-2.5 py-0.5 text-xs font-semibold text-cyan-800 dark:bg-cyan-900/60 dark:text-cyan-300"
											>
												<Sparkles class="h-3 w-3" />
												เสียบบัตรแล้ว (รอคัดกรอง)
											</span>
										</div>
										<p class="mt-0.5 font-mono text-xs text-cyan-800/80 dark:text-cyan-300/80">
											{#if evacuee.person_id?.number}
												เลขบัตร: {evacuee.person_id.number}
											{/if}
											{#if evacuee.card_snapshot?.station_name}
												· จุดสแกน: {evacuee.card_snapshot.station_name}
											{/if}
										</p>
									</div>
								</div>
								<Button
									type="button"
									class="h-11 w-full shrink-0 gap-1.5 bg-cyan-700 font-semibold text-white shadow hover:bg-cyan-800 sm:h-9 sm:w-auto"
									onclick={() => (onSelectDraft ? onSelectDraft(evacuee) : onNext())}
								>
									<span>ดำเนินการคัดกรองและลงทะเบียน (Step 1)</span>
								</Button>
							</div>
						{:else if isPreReg && hasCard}
							<!-- ⚡ Pre-registered + Card Verified Card -->
							<div
								class="flex flex-col gap-3 rounded-xl border border-purple-300 bg-purple-50/70 p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between dark:border-purple-800 dark:bg-purple-950/30"
							>
								<div class="flex items-start gap-3">
									<div
										class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-600 text-white shadow-sm"
									>
										<Sparkles class="h-5 w-5" />
									</div>
									<div class="min-w-0">
										<div class="flex flex-wrap items-center gap-2">
											<p class="font-bold text-purple-950 dark:text-purple-100">
												{evacuee.first_name}
												{evacuee.last_name}
											</p>
											<span
												class="inline-flex items-center gap-1 rounded-full bg-purple-200/80 px-2.5 py-0.5 text-xs font-semibold text-purple-800 dark:bg-purple-900/60 dark:text-purple-300"
											>
												⚡ จองล่วงหน้า + ยืนยันบัตรแล้ว
											</span>
										</div>
										<p class="mt-0.5 text-xs text-purple-800/80 dark:text-purple-300/80">
											{#if evacuee.phone}
												เบอร์โทร: {evacuee.phone} ·
											{/if}
											{#if evacuee.person_id?.number}
												เลขบัตร: {evacuee.person_id.number}
											{/if}
										</p>
									</div>
								</div>
								<Button
									type="button"
									class="h-11 w-full shrink-0 gap-1.5 bg-purple-700 font-semibold text-white shadow hover:bg-purple-800 sm:h-9 sm:w-auto"
									onclick={() =>
										onSelectDraft ? onSelectDraft(evacuee) : viewEvacueeDetail(evacuee._id)}
								>
									<span>ดำเนินการคัดกรองและเช็คอิน (Step 1)</span>
								</Button>
							</div>
						{:else}
							<!-- Regular Evacuee Card -->
							<div
								class="flex flex-col gap-3 rounded-lg border border-green-200 bg-[#F0FDF4] px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-green-800 dark:bg-green-950/20"
							>
								<div class="min-w-0">
									<p class="truncate font-semibold text-green-900 dark:text-green-100">
										{evacuee.first_name}
										{evacuee.last_name}
									</p>
									<p class="text-xs text-green-700 dark:text-green-300">
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
									class="h-11 w-full shrink-0 bg-[#10b981] font-semibold text-white hover:bg-[#059669] sm:h-9 sm:w-auto"
									onclick={() => viewEvacueeDetail(evacuee._id)}
								>
									ดู / แก้ไข
								</Button>
							</div>
						{/if}
					{/each}
				</div>

				<Button
					type="button"
					variant="outline"
					class="h-12 w-full rounded-lg border border-green-200 bg-white font-semibold text-green-700 hover:bg-green-50"
					onclick={onNext}
				>
					<UserPlus class="h-4 w-4" />
					ลงทะเบียนใหม่แทน
				</Button>
			</div>
		{:else}
			<div class="space-y-3 rounded-xl border border-blue-100 bg-[#F4F8FA] p-4">
				<h3 class="text-base font-bold text-[#0C2D4E]">ไม่พบข้อมูลในระบบ</h3>
				<p class="text-sm text-[#0C2D4E]/80">
					ผู้ลี้ภัยรายนี้ยังไม่เคยลงทะเบียน กรุณาดำเนินการลงทะเบียนใหม่
				</p>
				<Button
					type="button"
					class="h-12 w-full bg-[#0C2D4E] text-white hover:bg-[#0A2647]"
					onclick={onNext}
				>
					ลงทะเบียนใหม่
				</Button>
			</div>
		{/if}
	{/if}
</div>
