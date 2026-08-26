<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import Cpu from '@lucide/svelte/icons/cpu';
	import Clock from '@lucide/svelte/icons/clock';
	import User from '@lucide/svelte/icons/user';
	import Check from '@lucide/svelte/icons/check';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import { usePendingScannerDrafts } from '../application/queries';
	import type { ScannerDraft } from '../domain/scanner.schema';
	import { getShelterCode } from '$lib/db/shelter';

	let {
		open = $bindable(false),
		shelterCode = getShelterCode(),
		onselect
	}: {
		open?: boolean;
		shelterCode?: string;
		onselect: (draft: ScannerDraft) => void;
	} = $props();

	const draftsQuery = usePendingScannerDrafts(
		() => shelterCode,
		() => open
	);
	const drafts = $derived(draftsQuery.data ?? []);

	function formatTimeAgo(dateStr: string): string {
		const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
		if (diff < 10) return 'เมื่อสักครู่';
		if (diff < 60) return `${diff} วินาทีที่แล้ว`;
		if (diff < 3600) return `${Math.floor(diff / 60)} นาทีที่แล้ว`;
		return new Date(dateStr).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
	}

	function handleSelect(draft: ScannerDraft) {
		onselect(draft);
		open = false;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="flex max-h-[85vh] flex-col sm:max-w-[650px]">
		<Dialog.Header class="border-b border-border pb-3">
			<div class="flex items-center justify-between">
				<Dialog.Title class="flex items-center gap-2.5 text-xl font-bold">
					<div
						class="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-400"
					>
						<Cpu class="h-5 w-5" />
					</div>
					<span>รายการบัตรที่สแกนล่าสุด (Scanner Queue)</span>
				</Dialog.Title>
				<Button
					variant="ghost"
					size="sm"
					class="h-8 gap-1.5 text-xs text-muted-foreground"
					onclick={() => draftsQuery.refetch()}
				>
					<RefreshCw class="h-3.5 w-3.5 {draftsQuery.isFetching ? 'animate-spin' : ''}" />
					<span>รีเฟรช</span>
				</Button>
			</div>
			<Dialog.Description class="text-xs text-muted-foreground">
				เลือกรายการบัตรประชาชนที่เสียบสแกนจากเครื่องอ่านบัตรประจำศูนย์ <b>{shelterCode}</b> เพื่อนำข้อมูลและรูปถ่ายเข้าสู่ฟอร์มลงทะเบียนโดยอัตโนมัติ
			</Dialog.Description>
		</Dialog.Header>

		<div class="flex-1 space-y-2.5 overflow-y-auto py-3 pr-1">
			{#if draftsQuery.isLoading}
				<div class="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
					<div
						class="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"
					></div>
					<p class="text-sm">กำลังค้นหารายการสแกน...</p>
				</div>
			{:else if drafts.length === 0}
				<div
					class="rounded-xl border border-dashed border-border py-12 text-center text-muted-foreground"
				>
					<Cpu class="mx-auto mb-2 h-10 w-10 animate-pulse text-muted-foreground/40" />
					<p class="font-medium text-foreground">ยังไม่มีรายการสแกนบัตรใหม่</p>
					<p class="mt-1 text-xs text-muted-foreground">
						เมื่อมีผู้เสียบบัตรประชาชนที่เครื่องสแกน รายการจะปรากฏขึ้นที่นี่โดยอัตโนมัติ
					</p>
				</div>
			{:else}
				{#each drafts as draft (draft._id)}
					{@const card = draft.card_data}
					<div
						class="group flex items-start gap-4 rounded-xl border border-border/80 bg-card p-3.5 shadow-sm transition-all hover:border-primary/50 hover:bg-muted/30"
					>
						<!-- Photo Thumbnail -->
						<div
							class="relative flex h-20 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted shadow-inner"
						>
							{#if card.photo_base64}
								<img
									src={card.photo_base64}
									alt="รูปถ่ายผู้ประสบภัย"
									class="h-full w-full object-cover"
								/>
							{:else}
								<User class="h-8 w-8 text-muted-foreground/50" />
							{/if}
						</div>

						<!-- Card Details -->
						<div class="min-w-0 flex-1">
							<div class="flex items-center justify-between gap-2">
								<h4 class="truncate text-sm font-bold text-foreground">
									{card.full_name_th ||
										`${card.first_name_th} ${card.last_name_th}` ||
										'ไม่ระบุชื่อ'}
								</h4>
								<span
									class="inline-flex items-center gap-1 rounded-full bg-cyan-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-cyan-600 dark:text-cyan-400"
								>
									<Clock class="h-3 w-3" />
									{formatTimeAgo(draft.created_at)}
								</span>
							</div>

							<div
								class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-xs text-muted-foreground"
							>
								<span>เลขบัตร: <b class="text-foreground">{card.citizen_id}</b></span>
								{#if card.age}
									<span>อายุ: <b class="text-foreground">{card.age} ปี</b></span>
								{/if}
								<span
									>เพศ: <b class="text-foreground"
										>{card.gender === 'male' ? 'ชาย' : card.gender === 'female' ? 'หญิง' : '-'}</b
									></span
								>
							</div>

							{#if card.address_no || card.subdistrict || card.province}
								<div class="mt-1 flex items-center gap-1 truncate text-xs text-muted-foreground">
									<MapPin class="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
									<span class="truncate">
										{card.address_no ? `บ้านเลขที่ ${card.address_no}` : ''}
										{card.village_no ? ` ม.${card.village_no}` : ''}
										{card.subdistrict ? ` ต.${card.subdistrict}` : ''}
										{card.district ? ` อ.${card.district}` : ''}
										{card.province ? ` จ.${card.province}` : ''}
									</span>
								</div>
							{/if}

							<div class="mt-2 flex items-center justify-between border-t border-border/40 pt-1">
								<span class="text-[11px] text-muted-foreground">
									จุดสแกน: <span class="font-semibold text-foreground"
										>{draft.station_name || draft.device_id}</span
									>
								</span>
								<Button
									size="sm"
									class="h-7 gap-1 bg-primary px-3 text-xs text-primary-foreground shadow-sm hover:bg-primary/90"
									onclick={() => handleSelect(draft)}
								>
									<Check class="h-3.5 w-3.5" />
									<span>เลือกข้อมูลนี้</span>
								</Button>
							</div>
						</div>
					</div>
				{/each}
			{/if}
		</div>

		<Dialog.Footer class="border-t border-border pt-2">
			<Button variant="outline" size="sm" onclick={() => (open = false)}>ปิด</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
