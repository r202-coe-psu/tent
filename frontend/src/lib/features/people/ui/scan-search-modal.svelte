<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import Search from '@lucide/svelte/icons/search';
	import Loader from '@lucide/svelte/icons/loader';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import {
		useSearchEvacuees,
		maskNationalId,
		canCheckInEvacuee,
		canCheckOutEvacuee,
		type StayStatus
	} from '$lib/features/people';

	const STATUS_SHORT: Record<StayStatus, string> = {
		pre_registered: 'รอเช็คอิน',
		active: 'เช็คอิน',
		temporary_leave: 'ออกชั่วคราว',
		transferred: 'ย้ายศูนย์',
		checked_out: 'เช็คเอาท์',
		deceased: 'เสียชีวิต',
		cancelled: 'ยกเลิก'
	};

	let {
		show,
		onClose,
		onSelect
	}: {
		show: boolean;
		onClose: () => void;
		onSelect: (evacueeId: string) => void;
	} = $props();

	// Search states inside Search Modal
	let searchQueryText = $state('');
	let debouncedSearchQuery = $state('');
	let debounceTimer: ReturnType<typeof setTimeout>;

	$effect(() => {
		const q = searchQueryText.trim();
		clearTimeout(debounceTimer);
		if (!q) {
			debouncedSearchQuery = '';
			return;
		}
		debounceTimer = setTimeout(() => {
			debouncedSearchQuery = q;
		}, 300);
		return () => clearTimeout(debounceTimer);
	});

	$effect(() => {
		if (!show) {
			searchQueryText = '';
			debouncedSearchQuery = '';
		}
	});

	const searchEvacueesQuery = useSearchEvacuees(
		() => debouncedSearchQuery,
		() => !!debouncedSearchQuery
	);
	const searchResults = $derived(searchEvacueesQuery.data ?? []);
	const isSearching = $derived(searchEvacueesQuery.isFetching && !!debouncedSearchQuery);
</script>

<Dialog.Root
	open={show}
	onOpenChange={(open) => {
		if (!open) onClose();
	}}
>
	<Dialog.Content class="flex max-h-[85vh] w-full max-w-lg flex-col rounded-3xl p-6">
		<Dialog.Header class="border-b pb-4">
			<Dialog.Title class="flex items-center gap-2 text-base font-black">
				<Search class="size-5 text-emerald-500" />
				ค้นหาผู้พักพิงเพื่อเช็คอิน / เช็คเอาท์
			</Dialog.Title>
		</Dialog.Header>

		<div class="my-4">
			<div class="relative">
				<Search class="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
				<Input
					type="text"
					placeholder="พิมพ์ชื่อ นามสกุล หรือหมายเลขโทรศัพท์..."
					bind:value={searchQueryText}
					class="h-11 bg-slate-50 pl-9 text-sm dark:bg-slate-950"
				/>
			</div>
		</div>

		<div class="flex-1 space-y-2 overflow-y-auto pr-1">
			{#if isSearching}
				<div class="flex flex-col items-center justify-center gap-2 py-10">
					<Loader class="size-6 animate-spin text-emerald-500" />
					<span class="text-xs font-semibold text-slate-500">กำลังสืบค้น...</span>
				</div>
			{:else if searchQueryText && searchResults.length === 0}
				<p class="py-10 text-center text-xs font-semibold text-slate-500">
					ไม่พบรายชื่อที่ตรงกับคำค้นหา
				</p>
			{:else if !searchQueryText}
				<p class="py-10 text-center text-xs font-semibold text-slate-400">
					พิมพ์ข้อมูลเพื่อสืบค้นประวัติ
				</p>
			{:else}
				{#each searchResults as evacuee (evacuee._id)}
					<div
						class="flex items-center justify-between rounded-xl border border-slate-100 p-3 hover:border-emerald-300 dark:border-slate-800"
					>
						<div class="min-w-0 flex-1">
							<h4 class="text-sm font-bold text-slate-800 dark:text-slate-200">
								{evacuee.first_name}
								{evacuee.last_name}
							</h4>
							<p class="mt-0.5 text-[10px] font-semibold text-slate-400">
								เลขบัตร: {maskNationalId(evacuee.person_id?.number) || 'ไม่ระบุ'} • โทร: {evacuee.phone ||
									'ไม่ระบุ'}
							</p>
						</div>
						<div class="flex items-center gap-3">
							<span
								class="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold shadow-xs
								{canCheckOutEvacuee(evacuee)
									? 'bg-emerald-100 text-emerald-800'
									: canCheckInEvacuee(evacuee)
										? 'bg-amber-100 text-amber-800'
										: 'bg-slate-100 text-slate-800'}"
							>
								{STATUS_SHORT[evacuee.current_stay.status]}
							</span>
							<Button
								size="sm"
								class="h-8 bg-emerald-500 px-3 text-xs font-bold text-white hover:bg-emerald-600"
								onclick={() => onSelect(evacuee._id)}
							>
								เลือก
							</Button>
						</div>
					</div>
				{/each}
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
