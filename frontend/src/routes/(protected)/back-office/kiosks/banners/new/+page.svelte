<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import StaffPageShell from '$lib/components/staff-page-shell.svelte';
	import { spatial } from '$lib/tokens';
	import { kioskScreenTypeSchema, type KioskScreenType } from '$lib/features/shared';
	import { getShelterCode } from '$lib/db/shelter';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import {
		KioskBannerForm,
		useCreateKioskBanner,
		useKioskBannerGroups,
		type KioskBannerSavePayload
	} from '$lib/features/kiosk-banners';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';

	/** Every role (SA included) works on the shelter picked in the back-office shelter switcher. */
	const activeShelter = $derived(shelterStore.selectedShelterCode ?? getShelterCode());

	const create = useCreateKioskBanner();
	const groupsQuery = useKioskBannerGroups(() => activeShelter);
	const groups = $derived(groupsQuery.data ?? []);
	/** `?group=` of the group page this one was opened from; ignored unless it is a group of this shelter. */
	const groupParam = $derived(page.url.searchParams.get('group'));
	const defaultGroupId = $derived(
		groupParam && groups.some((group) => group._id === groupParam) ? groupParam : undefined
	);
	/** `?screen=` of the page this one was opened from; the form starts on that screen type. */
	const screenParam = $derived(
		kioskScreenTypeSchema.safeParse(page.url.searchParams.get('screen'))
	);
	const defaultScreen = $derived<KioskScreenType | undefined>(
		screenParam.success ? screenParam.data : undefined
	);

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
		await goto(
			resolve(
				`/back-office/kiosks/banners/groups/${encodeURIComponent(payload.input.group_id)}/${payload.input.screen_type}`
			)
		);
	}

	const backPath = $derived(
		groupParam
			? (`/back-office/kiosks/banners/groups/${encodeURIComponent(groupParam)}` as const)
			: ('/back-office/kiosks/banners' as const)
	);
</script>

<svelte:head>
	<title>สร้างแบนเนอร์ Kiosk — SmartShelter</title>
</svelte:head>

<StaffPageShell title="สร้างแบนเนอร์" maxWidth="6xl">
	{#snippet meta()}
		<a
			href={resolve(backPath)}
			class="inline-flex min-h-11 items-center gap-1 text-sm text-primary underline-offset-2 hover:underline"
		>
			<ArrowLeft class="h-4 w-4" />
			กลับไปรายการแบนเนอร์
		</a>
	{/snippet}

	<div class="{spatial.container.staffPageCard} p-4 sm:p-6">
		{#if groupsQuery.isLoading}
			<p class="py-16 text-center text-muted-foreground">กำลังโหลดกลุ่มแบนเนอร์...</p>
		{:else if groupsQuery.isError}
			<p class="py-16 text-center text-sm text-destructive">โหลดกลุ่มแบนเนอร์ไม่สำเร็จ</p>
		{:else}
			<KioskBannerForm
				shelterCode={activeShelter}
				{defaultScreen}
				{groups}
				{defaultGroupId}
				onsave={handleSave}
			/>
		{/if}
	</div>
</StaffPageShell>
