<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import StaffPageShell from '$lib/components/staff-page-shell.svelte';
	import { spatial } from '$lib/tokens';
	import { getShelterCode } from '$lib/db/shelter';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import {
		KioskBannerForm,
		nextBannerOrder,
		useCreateKioskBanner,
		useKioskBanners,
		type KioskBannerSavePayload
	} from '$lib/features/kiosk-banners';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';

	/** Every role (SA included) works on the shelter picked in the back-office shelter switcher. */
	const activeShelter = $derived(shelterStore.selectedShelterCode ?? getShelterCode());

	const create = useCreateKioskBanner();
	// Current banners: the duplicate-order note in the form, and the next free order to start from.
	const siblingsQuery = useKioskBanners(
		() => activeShelter,
		() => 'current'
	);
	const siblings = $derived(siblingsQuery.data ?? []);
	// The form reads `defaultOrder` once at mount, so it is mounted after the list has settled. On
	// error there is no list: the form starts at the default order and just shows no note.
	// Compact is the form's initial screen type; switching it later is covered by the note.
	const defaultOrder = $derived(
		siblingsQuery.data ? nextBannerOrder(siblingsQuery.data, 'compact', new Date()) : undefined
	);
	const listHref = resolve('/back-office/kiosks/banners');

	/** A failed call is already toasted by the mutation hook. */
	async function handleSave(payload: KioskBannerSavePayload) {
		if (!payload.image) return;
		try {
			await create.mutateAsync({
				shelterCode: activeShelter,
				input: payload.input,
				image: payload.image
			});
		} catch {
			return;
		}
		toast.success('สร้างแบนเนอร์แล้ว');
		await goto(listHref);
	}
</script>

<svelte:head>
	<title>สร้างแบนเนอร์ Kiosk — SmartShelter</title>
</svelte:head>

<StaffPageShell title="สร้างแบนเนอร์" maxWidth="6xl">
	{#snippet meta()}
		<a
			href={listHref}
			class="inline-flex min-h-11 items-center gap-1 text-sm text-primary underline-offset-2 hover:underline"
		>
			<ArrowLeft class="h-4 w-4" />
			กลับไปรายการแบนเนอร์
		</a>
	{/snippet}

	<div class="{spatial.container.staffPageCard} p-4 sm:p-6">
		{#if siblingsQuery.isLoading}
			<p class="py-16 text-center text-muted-foreground">กำลังโหลดแบนเนอร์...</p>
		{:else}
			<KioskBannerForm shelterCode={activeShelter} {siblings} {defaultOrder} onsave={handleSave} />
		{/if}
	</div>
</StaffPageShell>
