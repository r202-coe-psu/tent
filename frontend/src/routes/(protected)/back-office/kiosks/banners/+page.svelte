<script lang="ts">
	import { resolve } from '$app/paths';
	import StaffPageShell from '$lib/components/staff-page-shell.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { spatial } from '$lib/tokens';
	import { getShelterCode } from '$lib/db/shelter';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { KIOSK_SCREENS, screenTypeOf } from '$lib/features/shared';
	import {
		KioskBannerGroupCard,
		groupOf,
		kioskBannerRemoteRepository,
		summarizeScreen,
		useKioskBannerGroups,
		useKioskBanners
	} from '$lib/features/kiosk-banners';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';

	/** Every role (SA included) works on the shelter picked in the back-office shelter switcher. */
	const activeShelter = $derived(shelterStore.selectedShelterCode ?? getShelterCode());

	const newGroupHref = resolve('/back-office/kiosks/banners/groups/new');

	const groupsQuery = useKioskBannerGroups(() => activeShelter);
	const currentQuery = useKioskBanners(
		() => activeShelter,
		() => 'current'
	);
	const expiredQuery = useKioskBanners(
		() => activeShelter,
		() => 'expired'
	);

	/** Evaluation time for "active now"; ticks so a page left open follows schedule changes. */
	let now = $state(new Date());
	$effect(() => {
		const timer = setInterval(() => (now = new Date()), 30_000);
		return () => clearInterval(timer);
	});

	const groups = $derived(groupsQuery.data ?? []);
	const current = $derived(currentQuery.data ?? []);
	const expired = $derived(expiredQuery.data ?? []);
	/** Banners saved before groups existed: no group, so no kiosk plays them. */
	const ungrouped = $derived([...current, ...expired].filter((banner) => groupOf(banner) === null));

	function summariesOf(groupId: string) {
		return {
			compact: summarizeScreen(
				current,
				expired,
				{ group_id: groupId, screen_type: 'compact' },
				now
			),
			portrait: summarizeScreen(
				current,
				expired,
				{ group_id: groupId, screen_type: 'portrait' },
				now
			)
		};
	}

	const loading = $derived(
		groupsQuery.isLoading || currentQuery.isLoading || expiredQuery.isLoading
	);
	const failure = $derived(groupsQuery.error ?? currentQuery.error ?? expiredQuery.error);
	const errorMessage = $derived(
		failure ? (failure instanceof Error ? failure.message : 'โหลดกลุ่มแบนเนอร์ไม่สำเร็จ') : null
	);
</script>

<svelte:head>
	<title>แบนเนอร์ Kiosk — SmartShelter</title>
</svelte:head>

<StaffPageShell
	title="แบนเนอร์ Kiosk"
	description="จัดตู้ kiosk เป็นกลุ่ม แล้วสร้างแบนเนอร์ให้แต่ละกลุ่ม — ตู้แสดงเฉพาะแบนเนอร์ของกลุ่มที่ตัวเองอยู่"
>
	{#snippet meta()}
		<p class="text-sm text-slate-600">
			ศูนย์: <span class="font-semibold text-slate-900">{activeShelter}</span>
			<span class="text-slate-500">(เปลี่ยนศูนย์ที่ตัวเลือกศูนย์ด้านบน)</span>
		</p>
	{/snippet}
	{#snippet actions()}
		<Button href={newGroupHref} class="btn-primary-brand min-h-11 shrink-0 gap-2">
			<Plus class="h-4 w-4" />
			สร้างกลุ่ม
		</Button>
	{/snippet}

	<div class="flex flex-col gap-6">
		<div class={[spatial.container.staffPageCard, 'p-4 sm:p-6']}>
			{#if loading}
				<p class="py-16 text-center text-muted-foreground">กำลังโหลดกลุ่มแบนเนอร์...</p>
			{:else if errorMessage}
				<p class="py-16 text-center text-sm text-destructive">{errorMessage}</p>
			{:else if groups.length === 0}
				<div class="flex flex-col items-center gap-3 py-12 text-center">
					<p class="font-semibold text-slate-900">ยังไม่มีกลุ่มแบนเนอร์</p>
					<p class="max-w-md text-sm text-slate-600">
						สร้างกลุ่ม เลือกตู้ kiosk เข้ากลุ่ม แล้วจึงสร้างแบนเนอร์ให้กลุ่มนั้น —
						ตู้ที่ไม่อยู่ในกลุ่มใดจะไม่แสดงแบนเนอร์
					</p>
					<Button href={newGroupHref} class="btn-primary-brand min-h-11 gap-2">
						<Plus class="h-4 w-4" />
						สร้างกลุ่ม
					</Button>
				</div>
			{:else}
				<div class="grid gap-4 sm:grid-cols-2">
					{#each groups as group (group._id)}
						<KioskBannerGroupCard
							{group}
							deviceCount={group.device_ids.length}
							summaries={summariesOf(group._id)}
						/>
					{/each}
				</div>
			{/if}
		</div>

		{#if !loading && !errorMessage && ungrouped.length > 0}
			<section class={[spatial.container.staffPageCard, 'p-4 sm:p-6']}>
				<h2 class="text-lg font-bold text-slate-900">ยังไม่จัดกลุ่ม</h2>
				<p class="mt-1 text-sm text-slate-600">
					แบนเนอร์เหล่านี้สร้างไว้ก่อนมีกลุ่ม จึงไม่แสดงบนตู้ kiosk เครื่องใดเลย —
					แก้ไขเพื่อเลือกกลุ่ม
				</p>
				<ul class="mt-4 divide-y divide-border/60">
					{#each ungrouped as banner (banner._id)}
						{@const meta = KIOSK_SCREENS[screenTypeOf(banner)]}
						<li class="flex flex-wrap items-center gap-3 py-3">
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
								<p class="text-sm text-slate-700">{meta.label} {meta.size}</p>
							</div>
							<Button
								variant="outline"
								class="ml-auto min-h-11 gap-2"
								href={resolve(`/back-office/kiosks/banners/${encodeURIComponent(banner._id)}`)}
							>
								<Pencil class="h-4 w-4" />
								แก้ไข
								<span class="sr-only">แบนเนอร์ {banner.title}</span>
							</Button>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	</div>
</StaffPageShell>
