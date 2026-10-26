<script lang="ts">
	import { beforeNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import StaffPageShell from '$lib/components/staff-page-shell.svelte';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { spatial } from '$lib/tokens';
	import { cn } from '$lib/utils/shadcn.js';
	import { getShelterCode } from '$lib/db/shelter';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { KIOSK_SCREENS, type KioskScreenType } from '$lib/features/shared';
	import {
		KioskBannerScreenManager,
		useKioskBannerGroup,
		useKioskBanners,
		type KioskBannerSummary
	} from '$lib/features/kiosk-banners';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Eye from '@lucide/svelte/icons/eye';
	import Plus from '@lucide/svelte/icons/plus';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';

	/** Every role (SA included) works on the shelter picked in the back-office shelter switcher. */
	const activeShelter = $derived(shelterStore.selectedShelterCode ?? getShelterCode());

	// The `[screen=kioskScreen]` matcher guarantees a valid screen type.
	const screen = $derived(page.params.screen as KioskScreenType);
	const screenMeta = $derived(KIOSK_SCREENS[screen]);
	/** SvelteKit already decodes the segment (`kiosk_banner_group%3A01A` → `kiosk_banner_group:01A`). */
	const groupId = $derived(page.params.group ?? '');

	const groupQuery = useKioskBannerGroup(() => groupId);
	const groupName = $derived(groupQuery.data?.name ?? 'กลุ่มแบนเนอร์');

	const newHref = $derived(
		resolve(`/back-office/kiosks/banners/new?group=${encodeURIComponent(groupId)}&screen=${screen}`)
	);

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

	const loading = $derived(currentQuery.isLoading || expiredQuery.isLoading);
	const failure = $derived(currentQuery.error ?? expiredQuery.error);
	const errorMessage = $derived(
		failure ? (failure instanceof Error ? failure.message : 'โหลดรายการแบนเนอร์ไม่สำเร็จ') : null
	);

	/** Unsaved order and the shelter it was made for: switching shelter in the header drops it. */
	let draftState = $state.raw<{ banners: KioskBannerSummary[]; shelter: string } | null>(null);
	const draft = $derived(draftState?.shelter === activeShelter ? draftState.banners : null);

	function setDraft(banners: KioskBannerSummary[] | null) {
		draftState = banners ? { banners, shelter: activeShelter } : null;
	}

	let previewOpen = $state(false);

	function openPreview() {
		now = new Date();
		previewOpen = true;
	}

	// Unsaved-order guard: a full unload gets the browser prompt, in-app navigation our dialog.
	let leaveOpen = $state(false);
	let leaveTo = $state<URL | null>(null);

	beforeNavigate((navigation) => {
		if (draft === null) return;
		navigation.cancel();
		if (navigation.willUnload) return;
		leaveTo = navigation.to?.url ?? null;
		leaveOpen = true;
	});

	async function discardAndLeave() {
		const target = leaveTo;
		leaveOpen = false;
		draftState = null;
		// `target` is the URL SvelteKit was already navigating to (base included), so no resolve().
		if (target) await goto(target);
	}
</script>

<svelte:head>
	<title>แบนเนอร์{screenMeta.label} {screenMeta.size} · {groupName} — SmartShelter</title>
</svelte:head>

<StaffPageShell title="แบนเนอร์{screenMeta.label} {screenMeta.size} · {groupName}">
	{#snippet meta()}
		<div class="flex flex-wrap items-center gap-x-4 gap-y-1">
			<p class="text-sm text-slate-600">
				ศูนย์: <span class="font-semibold text-slate-900">{activeShelter}</span>
			</p>
			<a
				href={resolve(`/back-office/kiosks/banners/groups/${encodeURIComponent(groupId)}`)}
				class="inline-flex min-h-11 items-center gap-1 text-sm text-primary underline-offset-2 hover:underline"
			>
				<ArrowLeft class="h-4 w-4" />
				กลับไปกลุ่ม {groupName}
			</a>
		</div>
	{/snippet}
	{#snippet actions()}
		<Button variant="outline" class="min-h-11 shrink-0 gap-2" onclick={openPreview}>
			<Eye class="h-4 w-4" />
			ดูตัวอย่าง
		</Button>
		<Button href={newHref} class="btn-primary-brand min-h-11 shrink-0 gap-2">
			<Plus class="h-4 w-4" />
			สร้างแบนเนอร์
		</Button>
	{/snippet}

	<!-- No overflow clipping: the manager's footer is sticky against the page scroll. -->
	<div class={cn(spatial.container.staffPageCard, 'overflow-visible')}>
		<KioskBannerScreenManager
			{screen}
			{groupId}
			current={currentQuery.data ?? []}
			expired={expiredQuery.data ?? []}
			{now}
			shelterCode={activeShelter}
			{loading}
			{errorMessage}
			bind:draft={() => draft, setDraft}
			bind:previewOpen
		/>
	</div>
</StaffPageShell>

<AlertDialog.Root bind:open={leaveOpen}>
	<AlertDialog.Content class="max-w-md">
		<AlertDialog.Header>
			<div class="flex items-center gap-2 text-destructive">
				<TriangleAlert class="size-5 shrink-0" />
				<AlertDialog.Title>ทิ้งลำดับที่ยังไม่บันทึก?</AlertDialog.Title>
			</div>
			<AlertDialog.Description class="pt-2 text-sm">
				ลำดับที่จัดไว้ยังไม่ถูกบันทึก ถ้าออกไปลำดับจะกลับเป็นแบบเดิม
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>อยู่ต่อ</AlertDialog.Cancel>
			<AlertDialog.Action
				class="text-destructive-foreground bg-destructive hover:bg-destructive/90"
				onclick={discardAndLeave}
			>
				ทิ้งและออก
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
