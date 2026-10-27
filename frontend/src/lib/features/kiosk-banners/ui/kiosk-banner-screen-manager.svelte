<script lang="ts">
	import { useQueryClient } from '@tanstack/svelte-query';
	import { toast } from 'svelte-sonner';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import {
		KIOSK_SCREENS,
		screenTypeOf,
		type KioskScreenType
	} from '$lib/features/shared/domain/kiosk-screen';
	import { matchesSlot, orderableBanners } from '../domain/kiosk-banner';
	import { kioskBannerRemoteRepository } from '../data/kiosk-banner.remote';
	import { KioskBannerApiError, type KioskBannerSummary } from '../data/kiosk-banner.repository';
	import { kioskBannerKeys, useReorderKioskBanners } from '../application/kiosk-banner.queries';
	import KioskBannerOrderList from './kiosk-banner-order-list.svelte';
	import KioskBannerRowActions from './kiosk-banner-row-actions.svelte';
	import { reconcileDraft, sameOrder } from './kiosk-banner-order';
	import KioskBannerPreviewDialog from './kiosk-banner-preview-dialog.svelte';
	import { buildListPreviewSlides } from './kiosk-banner-preview-slides';
	import { formatBannerWindow } from './kiosk-banner-window';

	/**
	 * Manager panel for one (banner group, screen type) slot: reorder its current banners (draft
	 * held by the parent so its navigation guard can see it), edit/delete rows, browse expired ones.
	 * Also owns the kiosk preview dialog (it needs the draft order); the parent opens it through
	 * `previewOpen`.
	 */
	let {
		screen,
		groupId,
		current,
		expired,
		now,
		shelterCode,
		loading = false,
		errorMessage = null,
		draft = $bindable(null),
		previewOpen = $bindable(false)
	}: {
		screen: KioskScreenType;
		/** The banner group whose banners this panel manages. */
		groupId: string;
		/** The「current」list view, every group and screen type mixed. */
		current: KioskBannerSummary[];
		/** The「expired」list view, every group and screen type mixed. */
		expired: KioskBannerSummary[];
		now: Date;
		shelterCode: string;
		loading?: boolean;
		errorMessage?: string | null;
		draft?: KioskBannerSummary[] | null;
		previewOpen?: boolean;
	} = $props();

	const meta = $derived(KIOSK_SCREENS[screen]);
	const slot = $derived({ group_id: groupId, screen_type: screen });
	const saved = $derived(orderableBanners(current, slot, now));
	const shown = $derived(draft ? reconcileDraft(draft, saved) : saved);
	const expiredHere = $derived(expired.filter((banner) => matchesSlot(banner, slot)));
	const reorder = useReorderKioskBanners();
	const queryClient = useQueryClient();

	async function save() {
		if (!draft) return;
		try {
			await reorder.mutateAsync({
				shelterCode,
				groupId,
				screenType: screen,
				items: shown.map((banner) => ({ id: banner._id, rev: banner._rev }))
			});
		} catch (error) {
			// The mutation hook already toasted. A conflict means the draft is stale: drop it and
			// reload (the hook only invalidates on success).
			if (error instanceof KioskBannerApiError && error.status === 409) {
				draft = null;
				await queryClient.invalidateQueries({ queryKey: kioskBannerKeys.all });
			}
			return;
		}
		toast.success(`บันทึกลำดับ${meta.label}แล้ว`);
		draft = null;
	}

	const previewSlides = $derived(
		buildListPreviewSlides(
			shown.map((banner, index) => ({ ...banner, order: index + 1 })),
			now,
			kioskBannerRemoteRepository.imageUrl,
			groupId
		)
	);
</script>

<div class="flex flex-col">
	{#if loading}
		<p class="px-6 py-16 text-center text-muted-foreground">กำลังโหลดรายการแบนเนอร์...</p>
	{:else if errorMessage}
		<p class="px-6 py-16 text-center text-sm text-destructive">{errorMessage}</p>
	{:else}
		<Tabs.Root value="current" class="gap-0">
			<div class="border-b border-border px-4 py-3 sm:px-6">
				<Tabs.List class="h-11">
					<Tabs.Trigger value="current" class="px-4"
						>กำลังแสดง / รอแสดง ({saved.length})</Tabs.Trigger
					>
					<Tabs.Trigger value="expired" class="px-4">หมดอายุ ({expiredHere.length})</Tabs.Trigger>
				</Tabs.List>
			</div>
			<div>
				<Tabs.Content value="current">
					<p class="border-b border-border px-4 py-2 text-sm text-slate-500 sm:px-6">
						ลากที่ไอคอน ⠿ หรือกดลูกศรเพื่อย้าย · ลำดับใหม่ยังไม่มีผลจนกดบันทึก
					</p>
					<KioskBannerOrderList
						bind:items={() => shown, (next) => (draft = sameOrder(next, saved) ? null : next)}
						{now}
						disabled={reorder.isPending}
					>
						{#snippet rowActions(banner)}
							<KioskBannerRowActions {banner} />
						{/snippet}
					</KioskBannerOrderList>
				</Tabs.Content>
				<Tabs.Content value="expired">
					{#if expiredHere.length === 0}
						<p class="px-6 py-12 text-center text-muted-foreground">ไม่มีแบนเนอร์ที่หมดอายุ</p>
					{:else}
						<ul class="divide-y divide-border/60">
							{#each expiredHere as banner (banner._id)}
								<li class="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
									<img
										src={kioskBannerRemoteRepository.imageUrl(banner._id, banner._rev)}
										alt=""
										class={[
											'shrink-0 rounded-md border border-border bg-slate-100 object-contain',
											screenTypeOf(banner) === 'portrait' ? 'h-16 w-9' : 'h-12 w-20'
										]}
										loading="lazy"
									/>
									<div class="min-w-0 flex-1 basis-48">
										<p class="truncate font-semibold text-foreground">{banner.title}</p>
										<p class="text-sm whitespace-nowrap text-slate-700 tabular-nums">
											{formatBannerWindow(banner.start_at, banner.end_at)}
										</p>
									</div>
									<div class="ml-auto">
										<KioskBannerRowActions {banner} expired />
									</div>
								</li>
							{/each}
						</ul>
					{/if}
				</Tabs.Content>
			</div>
		</Tabs.Root>
	{/if}

	{#if draft !== null}
		<div
			class="sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-2 rounded-b-xl border-t border-border bg-slate-50 px-4 py-3 sm:px-6"
		>
			<p
				class="mr-auto inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-900"
			>
				<TriangleAlert class="h-3.5 w-3.5" />
				มีลำดับที่ยังไม่บันทึก
			</p>
			<Button
				variant="outline"
				class="min-h-11"
				disabled={reorder.isPending}
				onclick={() => (draft = null)}
			>
				ยกเลิก
			</Button>
			<Button class="btn-primary-brand min-h-11" disabled={reorder.isPending} onclick={save}>
				{reorder.isPending ? 'กำลังบันทึก...' : 'บันทึกลำดับ'}
			</Button>
		</div>
	{/if}
</div>

<KioskBannerPreviewDialog
	bind:open={previewOpen}
	slides={previewSlides}
	screens={[screen]}
	initialScreen={screen}
/>
