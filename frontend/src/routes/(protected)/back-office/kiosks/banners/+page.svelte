<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import StaffPageShell from '$lib/components/staff-page-shell.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { spatial } from '$lib/tokens';
	import { getShelterCode } from '$lib/db/shelter';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { KIOSK_SCREEN_TYPES } from '$lib/features/shared';
	import {
		KioskBannerPreviewDialog,
		KioskBannerScreenCard,
		buildListPreviewSlides,
		kioskBannerRemoteRepository,
		summarizeScreen,
		useKioskBanners
	} from '$lib/features/kiosk-banners';
	import Eye from '@lucide/svelte/icons/eye';
	import Plus from '@lucide/svelte/icons/plus';

	/** Every role (SA included) works on the shelter picked in the back-office shelter switcher. */
	const activeShelter = $derived(shelterStore.selectedShelterCode ?? getShelterCode());

	// Interim until the routes slice puts the banner group in the path.
	const groupId = $derived(page.url.searchParams.get('group') ?? '');

	const newHref = resolve('/back-office/kiosks/banners/new');

	const currentQuery = useKioskBanners(
		() => activeShelter,
		() => 'current'
	);
	const expiredQuery = useKioskBanners(
		() => activeShelter,
		() => 'expired'
	);

	/** Evaluation time for "active now"; refreshed when the preview is opened. */
	let now = $state(new Date());

	const current = $derived(currentQuery.data ?? []);
	const expired = $derived(expiredQuery.data ?? []);
	const loading = $derived(currentQuery.isLoading || expiredQuery.isLoading);
	const failure = $derived(currentQuery.error ?? expiredQuery.error);
	const errorMessage = $derived(
		failure ? (failure instanceof Error ? failure.message : 'โหลดรายการแบนเนอร์ไม่สำเร็จ') : null
	);

	let previewOpen = $state(false);

	const previewSlides = $derived(
		buildListPreviewSlides(current, now, kioskBannerRemoteRepository.imageUrl)
	);

	function openPreview() {
		now = new Date();
		previewOpen = true;
	}
</script>

<svelte:head>
	<title>แบนเนอร์ Kiosk — SmartShelter</title>
</svelte:head>

<StaffPageShell
	title="แบนเนอร์ Kiosk"
	description="ภาพประชาสัมพันธ์ที่ตู้ kiosk แสดงเมื่อไม่มีผู้ใช้งาน — กำหนดช่วงเวลา ลำดับ และเปิด/ปิดการแสดง"
>
	{#snippet meta()}
		<p class="text-sm text-slate-600">
			ศูนย์: <span class="font-semibold text-slate-900">{activeShelter}</span>
			<span class="text-slate-500">(เปลี่ยนศูนย์ที่ตัวเลือกศูนย์ด้านบน)</span>
		</p>
	{/snippet}
	{#snippet actions()}
		<Button variant="outline" class="min-h-11 shrink-0 gap-2" onclick={openPreview}>
			<Eye class="h-4 w-4" />
			ดูตัวอย่างบน kiosk
		</Button>
		<Button href={newHref} class="btn-primary-brand min-h-11 shrink-0 gap-2">
			<Plus class="h-4 w-4" />
			สร้างแบนเนอร์
		</Button>
	{/snippet}

	<div class={[spatial.container.staffPageCard, 'p-4 sm:p-6']}>
		{#if loading}
			<p class="py-16 text-center text-muted-foreground">กำลังโหลดรายการแบนเนอร์...</p>
		{:else if errorMessage}
			<p class="py-16 text-center text-sm text-destructive">{errorMessage}</p>
		{:else}
			<div class="grid gap-4 sm:grid-cols-2">
				{#each KIOSK_SCREEN_TYPES as type (type)}
					<KioskBannerScreenCard
						screen={type}
						summary={summarizeScreen(
							current,
							expired,
							{ group_id: groupId, screen_type: type },
							now
						)}
					/>
				{/each}
			</div>
		{/if}
	</div>
</StaffPageShell>

<KioskBannerPreviewDialog bind:open={previewOpen} slides={previewSlides} />
