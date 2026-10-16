<script lang="ts">
	import { resolve } from '$app/paths';
	import StaffPageShell from '$lib/components/staff-page-shell.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { spatial } from '$lib/tokens';
	import { getShelterCode } from '$lib/db/shelter';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { KIOSK_SCREENS, KIOSK_SCREEN_TYPES, type KioskScreenType } from '$lib/features/shared';
	import {
		KioskBannerList,
		KioskBannerPreviewDialog,
		buildListPreviewSlides,
		kioskBannerRemoteRepository,
		matchesScreen,
		useKioskBanners,
		type KioskBannerView
	} from '$lib/features/kiosk-banners';
	import Eye from '@lucide/svelte/icons/eye';
	import Plus from '@lucide/svelte/icons/plus';

	/** Every role (SA included) works on the shelter picked in the back-office shelter switcher. */
	const activeShelter = $derived(shelterStore.selectedShelterCode ?? getShelterCode());

	let view = $state<KioskBannerView>('current');

	const listQuery = useKioskBanners(
		() => activeShelter,
		() => view
	);
	// Same query key as the list while on the current tab, so no extra request there.
	const currentQuery = useKioskBanners(
		() => activeShelter,
		() => 'current'
	);

	let screenFilter = $state<KioskScreenType | 'all'>('all');

	const screenOptions: { value: KioskScreenType | 'all'; label: string }[] = [
		{ value: 'all', label: 'ทั้งหมด' },
		...KIOSK_SCREEN_TYPES.map((type) => ({
			value: type,
			label: `${KIOSK_SCREENS[type].label} ${KIOSK_SCREENS[type].size}`
		}))
	];

	const visibleBanners = $derived(
		(listQuery.data ?? []).filter(
			(banner) => screenFilter === 'all' || matchesScreen(banner, screenFilter)
		)
	);

	let previewOpen = $state(false);
	let previewNow = $state(new Date());

	const previewSlides = $derived(
		buildListPreviewSlides(
			currentQuery.data ?? [],
			previewNow,
			kioskBannerRemoteRepository.imageUrl
		)
	);

	function openPreview() {
		previewNow = new Date();
		previewOpen = true;
	}

	const newHref = resolve('/back-office/kiosks/banners/new');
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

	<div class={spatial.container.staffPageCard}>
		<div
			class="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 sm:px-6"
			role="group"
			aria-label="กรองตามขนาดหน้าจอ"
		>
			{#each screenOptions as option (option.value)}
				<Button
					type="button"
					size="sm"
					variant={screenFilter === option.value ? 'default' : 'outline'}
					aria-pressed={screenFilter === option.value}
					class="min-h-11"
					onclick={() => (screenFilter = option.value)}
				>
					{option.label}
				</Button>
			{/each}
		</div>
		<KioskBannerList
			banners={visibleBanners}
			{screenFilter}
			bind:view
			loading={listQuery.isLoading}
			errorMessage={listQuery.isError
				? listQuery.error instanceof Error
					? listQuery.error.message
					: 'โหลดรายการแบนเนอร์ไม่สำเร็จ'
				: null}
		/>
	</div>
</StaffPageShell>

<KioskBannerPreviewDialog
	bind:open={previewOpen}
	slides={previewSlides}
	initialScreen={screenFilter === 'all' ? undefined : screenFilter}
/>
