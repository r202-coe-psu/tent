<script lang="ts">
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import Images from '@lucide/svelte/icons/images';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import {
		KIOSK_SCREENS,
		screenTypeOf,
		type KioskScreenType
	} from '$lib/features/shared/domain/kiosk-screen';
	import {
		useDeleteKioskBanner,
		useSetKioskBannerStatus
	} from '../application/kiosk-banner.queries';
	import { kioskBannerRemoteRepository } from '../data/kiosk-banner.remote';
	import type { KioskBannerSummary, KioskBannerView } from '../data/kiosk-banner.repository';
	import { formatBannerWindow } from './kiosk-banner-window';

	/**
	 * Banner table with the「กำลังแสดง / รอแสดง」and「หมดอายุ」tabs (FR-KBR-25, FR-KBN-20/23). The
	 * parent owns the query and passes the rows of the selected `view`.
	 */
	let {
		banners,
		view = $bindable('current'),
		loading = false,
		errorMessage = null,
		screenFilter = 'all'
	}: {
		banners: KioskBannerSummary[];
		view?: KioskBannerView;
		loading?: boolean;
		errorMessage?: string | null;
		/** Only words the empty state; the parent has already filtered `banners`. */
		screenFilter?: KioskScreenType | 'all';
	} = $props();

	const emptyMessage = $derived.by(() => {
		const scope = screenFilter === 'all' ? '' : KIOSK_SCREENS[screenFilter].label;
		return view === 'current'
			? `ยังไม่มีแบนเนอร์${scope}ที่กำลังแสดงหรือรอแสดง`
			: `ยังไม่มีแบนเนอร์${scope}ที่หมดอายุ`;
	});

	const setStatus = useSetKioskBannerStatus();
	const remove = useDeleteKioskBanner();

	let deleteOpen = $state(false);
	let deleteTarget = $state.raw<KioskBannerSummary | null>(null);

	const tabs: { value: KioskBannerView; label: string }[] = [
		{ value: 'current', label: 'กำลังแสดง / รอแสดง' },
		{ value: 'expired', label: 'หมดอายุ' }
	];

	function handleToggle(banner: KioskBannerSummary, show: boolean) {
		setStatus.mutate(
			{ id: banner._id, rev: banner._rev, status: show ? 'active' : 'inactive' },
			{
				onSuccess: () =>
					toast.success(show ? 'เปิดการแสดงแบนเนอร์บนตู้แล้ว' : 'ปิดการแสดงแบนเนอร์บนตู้แล้ว')
			}
		);
	}

	function askDelete(banner: KioskBannerSummary) {
		deleteTarget = banner;
		deleteOpen = true;
	}

	function confirmDelete() {
		const target = deleteTarget;
		if (!target) return;
		remove.mutate(
			{ id: target._id, rev: target._rev },
			{
				onSuccess: () => {
					deleteOpen = false;
					toast.success(`ลบแบนเนอร์ "${target.title}" แล้ว`);
				}
			}
		);
	}

	const screenLabel = (banner: KioskBannerSummary) => {
		const screen = KIOSK_SCREENS[screenTypeOf(banner)];
		return `${screen.label} ${screen.size}`;
	};

	const editHref = (id: string) => resolve(`/back-office/kiosks/banners/${encodeURIComponent(id)}`);
</script>

<Tabs.Root bind:value={view}>
	<div class="border-b border-border px-4 py-3 sm:px-6">
		<Tabs.List class="h-11">
			{#each tabs as tab (tab.value)}
				<Tabs.Trigger value={tab.value} class="px-4">{tab.label}</Tabs.Trigger>
			{/each}
		</Tabs.List>
	</div>

	{#each tabs as tab (tab.value)}
		<Tabs.Content value={tab.value}>
			{#if view === tab.value}
				{#if loading}
					<p class="px-6 py-16 text-center text-muted-foreground">กำลังโหลดรายการแบนเนอร์...</p>
				{:else if errorMessage}
					<p class="px-6 py-16 text-center text-sm text-destructive">{errorMessage}</p>
				{:else}
					<div class="overflow-x-auto">
						<table class="w-full text-left text-sm">
							<thead
								class="border-b border-border bg-muted/40 text-xs font-semibold text-muted-foreground uppercase"
							>
								<tr>
									<th class="px-4 py-4 sm:px-6">รูป</th>
									<th class="px-4 py-4">ชื่อ</th>
									<th class="px-4 py-4">ขนาดจอ</th>
									<th class="px-4 py-4">ช่วงเวลา</th>
									<th class="px-4 py-4">ลำดับ</th>
									<th class="px-4 py-4">สถานะ</th>
									<th class="px-4 py-4 text-right sm:px-6">จัดการ</th>
								</tr>
							</thead>
							<tbody class="divide-y divide-border/60">
								{#each banners as banner (banner._id)}
									<tr class="transition-colors hover:bg-muted/20">
										<td class="px-4 py-3 sm:px-6">
											<img
												src={kioskBannerRemoteRepository.imageUrl(banner._id, banner._rev)}
												alt=""
												class={[
													'rounded-md border border-border bg-slate-100 object-contain',
													screenTypeOf(banner) === 'portrait' ? 'h-16 w-9' : 'h-12 w-20'
												]}
												loading="lazy"
											/>
										</td>
										<td class="px-4 py-3 font-semibold text-foreground">{banner.title}</td>
										<td class="px-4 py-3 whitespace-nowrap">
											<span class="badge-muted">{screenLabel(banner)}</span>
										</td>
										<td class="px-4 py-3 whitespace-nowrap text-slate-700 tabular-nums">
											{formatBannerWindow(banner.start_at, banner.end_at)}
										</td>
										<td class="px-4 py-3 tabular-nums">{banner.order}</td>
										<td class="px-4 py-3">
											{#if view === 'current'}
												<div class="flex min-h-11 items-center gap-2">
													<Switch
														id="banner-status-{banner._id}"
														bind:checked={
															() => banner.status === 'active', (next) => handleToggle(banner, next)
														}
														disabled={setStatus.isPending}
														aria-label="แสดง {banner.title} บนตู้"
													/>
													<label
														for="banner-status-{banner._id}"
														class="text-sm font-medium text-slate-700"
													>
														{banner.status === 'active' ? 'แสดงบนตู้' : 'ไม่แสดง'}
													</label>
												</div>
											{:else}
												<span class="badge-muted">หมดอายุ</span>
											{/if}
										</td>
										<td class="px-4 py-3 text-right sm:px-6">
											<div class="flex items-center justify-end gap-1">
												<Button
													variant="ghost"
													size="sm"
													class="min-h-11 min-w-11 p-0 text-primary hover:bg-primary/10"
													href={editHref(banner._id)}
													title="แก้ไขแบนเนอร์"
												>
													<Pencil class="h-4 w-4" />
													<span class="sr-only">แก้ไขแบนเนอร์ {banner.title}</span>
												</Button>
												<Button
													variant="ghost"
													size="sm"
													data-testid="delete-banner"
													class="min-h-11 min-w-11 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
													onclick={() => askDelete(banner)}
													title="ลบแบนเนอร์"
												>
													<Trash2 class="h-4 w-4" />
													<span class="sr-only">ลบแบนเนอร์ {banner.title}</span>
												</Button>
											</div>
										</td>
									</tr>
								{:else}
									<tr>
										<td colspan="7" class="px-6 py-12 text-center text-muted-foreground">
											<Images class="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
											<p>{emptyMessage}</p>
											{#if view === 'current'}
												<p class="text-xs">กดปุ่ม "+ สร้างแบนเนอร์" ด้านบนเพื่อเพิ่มแบนเนอร์</p>
											{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			{/if}
		</Tabs.Content>
	{/each}
</Tabs.Root>

<AlertDialog.Root bind:open={deleteOpen}>
	<AlertDialog.Content class="max-w-md">
		<AlertDialog.Header>
			<div class="flex items-center gap-2 text-destructive">
				<TriangleAlert class="size-5 shrink-0" />
				<AlertDialog.Title>ยืนยันการลบแบนเนอร์</AlertDialog.Title>
			</div>
			{#if deleteTarget}
				<AlertDialog.Description class="space-y-2 pt-2 text-sm">
					<span class="block">
						ลบแบนเนอร์ <span class="font-semibold text-foreground">{deleteTarget.title}</span>
					</span>
					<span class="block font-medium text-destructive">
						ลบแล้วย้อนกลับไม่ได้ ตู้ kiosk จะเลิกแสดงแบนเนอร์นี้เมื่อรีเฟรชข้อมูลรอบถัดไป
					</span>
				</AlertDialog.Description>
			{/if}
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={remove.isPending}>ยกเลิก</AlertDialog.Cancel>
			<AlertDialog.Action
				class="text-destructive-foreground bg-destructive hover:bg-destructive/90"
				disabled={remove.isPending || !deleteTarget}
				onclick={confirmDelete}
			>
				{remove.isPending ? 'กำลังลบ...' : 'ลบแบนเนอร์'}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
