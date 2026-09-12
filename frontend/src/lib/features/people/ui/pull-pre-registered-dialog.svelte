<script lang="ts">
	import CreditCard from '@lucide/svelte/icons/credit-card';
	import Globe from '@lucide/svelte/icons/globe';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import Search from '@lucide/svelte/icons/search';
	import UserCheck from '@lucide/svelte/icons/user-check';
	import UserSearch from '@lucide/svelte/icons/user-search';
	import X from '@lucide/svelte/icons/x';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import {
		useEvacuees,
		formatPersonName,
		maskNationalId,
		matchesEvacueeSearch,
		type Evacuee
	} from '$lib/features/people';
	import EvacueePhoto from './evacuee-photo.svelte';
	import RegisteredViaBadge from './registered-via-badge.svelte';

	let {
		open = $bindable(false),
		excludeIds = [],
		onselect
	}: {
		open?: boolean;
		excludeIds?: string[];
		onselect: (evacuee: Evacuee) => void;
	} = $props();

	let searchQuery = $state('');
	let channelFilter = $state<'all' | 'kiosk' | 'web'>('all');

	const evacueesQuery = useEvacuees();
	const allEvacuees = $derived(evacueesQuery.data ?? []);

	const preRegisteredList = $derived.by(() => {
		const excluded = new Set(excludeIds.filter(Boolean));
		return allEvacuees.filter(
			(e) => e.current_stay?.status === 'pre_registered' && !excluded.has(e._id)
		);
	});

	const kioskCount = $derived(
		preRegisteredList.filter((e) => e.registered_via === 'kiosk' || !!e.card_snapshot).length
	);
	const webCount = $derived(
		preRegisteredList.filter((e) => e.registered_via === 'web' && !e.card_snapshot).length
	);

	const filteredList = $derived.by(() => {
		return preRegisteredList
			.filter((e) => {
				// Channel filter
				if (channelFilter === 'kiosk') {
					if (e.registered_via !== 'kiosk' && !e.card_snapshot) return false;
				} else if (channelFilter === 'web') {
					if (e.registered_via !== 'web' || !!e.card_snapshot) return false;
				}

				// Search query via unified helper
				return matchesEvacueeSearch(e, searchQuery);
			})
			.sort((a, b) => {
				const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
				const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
				return timeB - timeA;
			});
	});

	function handleSelect(evacuee: Evacuee) {
		onselect(evacuee);
		open = false;
		searchQuery = '';
	}

	function formatTime(iso?: string) {
		if (!iso) return '';
		try {
			const d = new Date(iso);
			return d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
		} catch {
			return '';
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content
		class="flex max-h-[85vh] w-full max-w-2xl flex-col gap-0 overflow-hidden rounded-2xl p-0"
	>
		<!-- Header -->
		<Dialog.Header class="border-b border-slate-200/80 px-5 py-4 text-left sm:px-6">
			<div class="flex items-center gap-2.5">
				<div
					class="flex size-9 items-center justify-center rounded-xl bg-blue-100 text-blue-700 shadow-xs"
				>
					<UserSearch class="size-5" />
				</div>
				<div>
					<Dialog.Title class="text-lg font-bold text-slate-900">
						ดึงข้อมูลจากคิวลงทะเบียนล่วงหน้า
					</Dialog.Title>
					<Dialog.Description class="text-xs text-slate-500">
						เลือกผู้ประสบภัยที่สแกนบัตร Kiosk หรือลงทะเบียนออนไลน์ล่วงหน้าไว้
						เพื่อดึงเข้าครอบครัวนี้
					</Dialog.Description>
				</div>
			</div>
		</Dialog.Header>

		<!-- Search Bar & Filters -->
		<div class="space-y-3 border-b border-slate-100 bg-slate-50/60 p-4 sm:px-6">
			<div class="relative">
				<Search
					class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400"
				/>
				<Input
					type="text"
					placeholder="ค้นหาด้วยชื่อ, นามสกุล, เลขบัตรประชาชน 13 หลัก, หรือเบอร์โทร..."
					bind:value={searchQuery}
					class="h-10 rounded-xl border-slate-200 bg-white pr-9 pl-9 text-sm shadow-2xs"
				/>
				{#if searchQuery}
					<button
						type="button"
						onclick={() => (searchQuery = '')}
						class="absolute top-1/2 right-2.5 -translate-y-1/2 text-slate-400 hover:text-slate-600"
						aria-label="ล้างคำค้นหา"
					>
						<X class="size-4" />
					</button>
				{/if}
			</div>

			<!-- Filter Pills -->
			<div class="flex flex-wrap items-center gap-1.5">
				<button
					type="button"
					onclick={() => (channelFilter = 'all')}
					class="rounded-full border px-3 py-1 text-xs font-semibold transition-colors {channelFilter ===
					'all'
						? 'border-blue-600 bg-blue-50 text-blue-700'
						: 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'}"
				>
					ทั้งหมด ({preRegisteredList.length})
				</button>
				<button
					type="button"
					onclick={() => (channelFilter = 'kiosk')}
					class="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold transition-colors {channelFilter ===
					'kiosk'
						? 'border-amber-400 bg-amber-50 text-amber-900 shadow-2xs'
						: 'border-amber-200 bg-white text-amber-800 hover:bg-amber-50'}"
				>
					<CreditCard class="size-3 text-amber-600" />
					<span>ตู้ Kiosk ({kioskCount})</span>
				</button>
				<button
					type="button"
					onclick={() => (channelFilter = 'web')}
					class="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold transition-colors {channelFilter ===
					'web'
						? 'border-sky-400 bg-sky-50 text-sky-900 shadow-2xs'
						: 'border-sky-200 bg-white text-sky-800 hover:bg-sky-50'}"
				>
					<Globe class="size-3 text-sky-600" />
					<span>ออนไลน์ Web ({webCount})</span>
				</button>
			</div>
		</div>

		<!-- List Container -->
		<div class="flex-1 overflow-y-auto p-4 sm:px-6">
			{#if evacueesQuery.isPending}
				<div class="flex flex-col items-center justify-center gap-2 py-12 text-slate-500">
					<Loader2 class="size-6 animate-spin text-blue-600" />
					<p class="text-xs font-medium">กำลังโหลดคิวลงทะเบียนล่วงหน้า...</p>
				</div>
			{:else if filteredList.length === 0}
				<div
					class="flex flex-col items-center justify-center gap-2 py-12 text-center text-slate-500"
				>
					<div
						class="flex size-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400"
					>
						<UserSearch class="size-6" />
					</div>
					<p class="text-sm font-semibold text-slate-700">ไม่พบรายชื่อในคิวลงทะเบียนล่วงหน้า</p>
					<p class="max-w-xs text-xs text-slate-400">
						{searchQuery || channelFilter !== 'all'
							? 'ไม่พบข้อมูลที่ตรงกับคำค้นหาหรือตัวกรองที่เลือก'
							: 'ไม่มีผู้ที่สแกนบัตรหรือจองออนไลน์ค้างอยู่ในระบบ'}
					</p>
				</div>
			{:else}
				<ul class="space-y-2.5">
					{#each filteredList as evacuee (evacuee._id)}
						{@const photoRef = evacuee.photo ?? evacuee.card_snapshot?.photo_base64}
						{@const timeStr = formatTime(evacuee.created_at)}
						<li
							class="flex flex-col gap-3 rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-2xs transition-colors hover:border-blue-300 hover:bg-blue-50/20 sm:flex-row sm:items-center sm:justify-between"
						>
							<div class="flex min-w-0 items-start gap-3">
								<EvacueePhoto photoId={photoRef} size="sm" class="shrink-0 rounded-xl" />
								<div class="min-w-0 space-y-1">
									<div class="flex flex-wrap items-center gap-1.5">
										<p class="truncate text-sm font-bold text-slate-900">
											{formatPersonName(evacuee)}
										</p>
										{#if evacuee.nickname}
											<span class="text-xs font-normal text-slate-500">
												({evacuee.nickname})
											</span>
										{/if}
										<RegisteredViaBadge
											via={evacuee.registered_via}
											hasCardSnapshot={!!evacuee.card_snapshot}
											size="sm"
										/>
									</div>
									<div class="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-500">
										{#if evacuee.person_id?.number}
											<span>เลขบัตร: {maskNationalId(evacuee.person_id.number)}</span>
										{/if}
										{#if evacuee.phone}
											<span>โทร: {evacuee.phone}</span>
										{/if}
										{#if timeStr}
											<span class="text-slate-400">เวลา {timeStr} น.</span>
										{/if}
									</div>
								</div>
							</div>
							<Button
								type="button"
								size="sm"
								class="h-9 w-full shrink-0 gap-1.5 rounded-xl bg-blue-600 font-semibold text-white shadow-2xs hover:bg-blue-700 sm:w-auto"
								onclick={() => handleSelect(evacuee)}
							>
								<UserCheck class="size-4" />
								<span>เลือกคนนี้</span>
							</Button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		<!-- Footer -->
		<div class="border-t border-slate-200/80 bg-slate-50 px-5 py-3 text-right sm:px-6">
			<Button
				type="button"
				variant="outline"
				size="sm"
				class="rounded-xl border-slate-200"
				onclick={() => (open = false)}
			>
				ยกเลิก
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>
