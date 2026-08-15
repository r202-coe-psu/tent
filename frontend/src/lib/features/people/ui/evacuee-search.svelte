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
	import { useSearchEvacuees } from '$lib/features/people';

	const STATUS_LABELS: Record<string, string> = {
		pre_registered: 'ลงทะเบียนล่วงหน้า',
		active: 'เข้าพักแล้ว',
		temporary_leave: 'ออกชั่วคราว',
		transferred: 'ย้ายไปแล้ว',
		checked_out: 'ย้ายออก/กลับภูมิลำเนา',
		deceased: 'เสียชีวิต',
		cancelled: 'ยกเลิกการลงทะเบียนล่วงหน้า'
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

				<div class="space-y-2">
					{#each searchResults as evacuee (evacuee._id)}
						<div
							class="flex flex-col gap-3 rounded-lg border border-green-200 bg-[#F0FDF4] px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
						>
							<div class="min-w-0">
								<p class="truncate font-semibold text-green-900">
									{evacuee.first_name}
									{evacuee.last_name}
								</p>
								<p class="text-xs text-green-700">
									สถานะ: {STATUS_LABELS[evacuee.current_stay.status] ?? evacuee.current_stay.status}
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
