<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import StaffPageShell from '$lib/components/staff-page-shell.svelte';
	import { screenTypeOf } from '$lib/features/shared';
	import { spatial } from '$lib/tokens';
	import {
		KioskBannerApiError,
		KioskBannerForm,
		useKioskBanner,
		useKioskBannerGroups,
		useUpdateKioskBanner,
		type KioskBannerSavePayload
	} from '$lib/features/kiosk-banners';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';

	const bannerQuery = useKioskBanner(() => page.params.id);
	const update = useUpdateKioskBanner();
	const groupsQuery = useKioskBannerGroups(() => bannerQuery.data?.shelter_code);
	/** Back to the banner's group/screen page once it has loaded (a v1 banner has no group: the list). */
	const listPath = $derived(
		bannerQuery.data?.group_id
			? (`/back-office/kiosks/banners/groups/${encodeURIComponent(bannerQuery.data.group_id)}/${screenTypeOf(bannerQuery.data)}` as const)
			: ('/back-office/kiosks/banners' as const)
	);

	const notFound = $derived(
		bannerQuery.error instanceof KioskBannerApiError && bannerQuery.error.status === 404
	);

	/** A failed call is already toasted by the mutation hook (409 = someone else saved first). */
	async function handleSave(payload: KioskBannerSavePayload) {
		const id = page.params.id;
		if (!id || !payload.rev) return;
		try {
			await update.mutateAsync({
				id,
				rev: payload.rev,
				input: payload.input,
				image: payload.image
			});
		} catch {
			return;
		}
		toast.success('บันทึกแบนเนอร์แล้ว');
		await goto(
			resolve(
				`/back-office/kiosks/banners/groups/${encodeURIComponent(payload.input.group_id)}/${payload.input.screen_type}`
			)
		);
	}
</script>

<svelte:head>
	<title>แก้ไขแบนเนอร์ Kiosk — SmartShelter</title>
</svelte:head>

<StaffPageShell title="แก้ไขแบนเนอร์" maxWidth="6xl">
	{#snippet meta()}
		<a
			href={resolve(listPath)}
			class="inline-flex min-h-11 items-center gap-1 text-sm text-primary underline-offset-2 hover:underline"
		>
			<ArrowLeft class="h-4 w-4" />
			กลับไปรายการแบนเนอร์
		</a>
	{/snippet}

	<div class="{spatial.container.staffPageCard} p-4 sm:p-6">
		{#if bannerQuery.isLoading || (bannerQuery.data && groupsQuery.isLoading)}
			<p class="py-16 text-center text-muted-foreground">กำลังโหลดแบนเนอร์...</p>
		{:else if notFound}
			<div class="space-y-3 py-12 text-center">
				<p class="font-semibold text-slate-900">ไม่พบแบนเนอร์นี้</p>
				<p class="text-sm text-slate-600">แบนเนอร์อาจถูกลบไปแล้ว หรือไม่ได้อยู่ในศูนย์ที่คุณดูแล</p>
				<a href={resolve(listPath)} class="inline-block text-sm text-primary underline">
					กลับไปรายการแบนเนอร์
				</a>
			</div>
		{:else if bannerQuery.isError}
			<p class="py-16 text-center text-sm text-destructive">
				{bannerQuery.error instanceof Error ? bannerQuery.error.message : 'โหลดแบนเนอร์ไม่สำเร็จ'}
			</p>
		{:else if groupsQuery.isError}
			<p class="py-16 text-center text-sm text-destructive">โหลดกลุ่มแบนเนอร์ไม่สำเร็จ</p>
		{:else if bannerQuery.data}
			{#key bannerQuery.data._id}
				<KioskBannerForm
					shelterCode={bannerQuery.data.shelter_code}
					banner={bannerQuery.data}
					groups={groupsQuery.data ?? []}
					onsave={handleSave}
				/>
			{/key}
		{/if}
	</div>
</StaffPageShell>
