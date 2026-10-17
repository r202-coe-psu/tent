<script lang="ts">
	import { beforeNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import StaffPageShell from '$lib/components/staff-page-shell.svelte';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import { spatial } from '$lib/tokens';
	import { getShelterCode } from '$lib/db/shelter';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import {
		KIOSK_SCREENS,
		KIOSK_SCREEN_TYPES,
		kioskScreenTypeSchema,
		type KioskScreenType
	} from '$lib/features/shared';
	import {
		KioskBannerApiError,
		KioskBannerOrderList,
		KioskBannerPreviewDialog,
		buildListPreviewSlides,
		kioskBannerRemoteRepository,
		orderableBanners,
		sameOrder,
		useKioskBanners,
		useReorderKioskBanners,
		type KioskBannerSummary
	} from '$lib/features/kiosk-banners';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Eye from '@lucide/svelte/icons/eye';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';

	/** Every role (SA included) works on the shelter picked in the back-office shelter switcher. */
	const activeShelter = $derived(shelterStore.selectedShelterCode ?? getShelterCode());

	const listHref = resolve('/back-office/kiosks/banners');

	const bannersQuery = useKioskBanners(
		() => activeShelter,
		() => 'current'
	);
	const reorder = useReorderKioskBanners();

	const initialScreen = kioskScreenTypeSchema.safeParse(page.url.searchParams.get('screen'));
	let screen = $state<KioskScreenType>(initialScreen.success ? initialScreen.data : 'compact');

	/** Evaluation time for "active now"; refreshed after a successful save. */
	let now = $state(new Date());

	type Drafts = Record<KioskScreenType, KioskBannerSummary[] | null>;
	const NO_DRAFTS: Drafts = { compact: null, portrait: null };

	/** Unsaved order per screen type; null = no draft, show the saved order. */
	let drafts = $state.raw<Drafts>(NO_DRAFTS);
	/** Shelter the drafts were made for: switching shelter in the header drops them. */
	let draftShelter = $state<string | null>(null);
	const ownDrafts = $derived(draftShelter === activeShelter ? drafts : NO_DRAFTS);

	const saved = $derived({
		compact: orderableBanners(bannersQuery.data ?? [], 'compact', now),
		portrait: orderableBanners(bannersQuery.data ?? [], 'portrait', now)
	});

	const shown = $derived({
		compact: ownDrafts.compact ?? saved.compact,
		portrait: ownDrafts.portrait ?? saved.portrait
	});

	const dirty = $derived({
		compact: !sameOrder(shown.compact, saved.compact),
		portrait: !sameOrder(shown.portrait, saved.portrait)
	});
	const anyDirty = $derived(dirty.compact || dirty.portrait);

	const tabLabel = (type: KioskScreenType) =>
		`${KIOSK_SCREENS[type].label} ${KIOSK_SCREENS[type].size} (${saved[type].length})`;

	function setDraft(type: KioskScreenType, next: KioskBannerSummary[] | null) {
		drafts = { ...ownDrafts, [type]: next };
		draftShelter = activeShelter;
	}

	function selectScreen(value: string) {
		const parsed = kioskScreenTypeSchema.safeParse(value);
		if (parsed.success) screen = parsed.data;
	}

	async function save() {
		const type = screen;
		if (!dirty[type]) return;
		try {
			await reorder.mutateAsync({
				shelterCode: activeShelter,
				screenType: type,
				items: shown[type].map((banner) => ({ id: banner._id, rev: banner._rev }))
			});
		} catch (error) {
			// The mutation hook already toasted. A conflict means the draft is stale: reload.
			if (error instanceof KioskBannerApiError && error.status === 409) {
				setDraft(type, null);
				await bannersQuery.refetch();
			}
			return;
		}
		toast.success(`บันทึกลำดับ${KIOSK_SCREENS[type].label}แล้ว`);
		setDraft(type, null);
		now = new Date();
	}

	let previewOpen = $state(false);

	const previewSlides = $derived(
		buildListPreviewSlides(
			KIOSK_SCREEN_TYPES.flatMap((type) =>
				shown[type].map((banner, index) => ({ ...banner, order: index + 1 }))
			),
			now,
			kioskBannerRemoteRepository.imageUrl
		)
	);

	function openPreview() {
		now = new Date();
		previewOpen = true;
	}

	// Unsaved-order guard: a full unload gets the browser prompt, in-app navigation our dialog.
	let leaveOpen = $state(false);
	let leaveTo = $state<URL | null>(null);

	beforeNavigate((navigation) => {
		if (!anyDirty) return;
		navigation.cancel();
		if (navigation.willUnload) return;
		leaveTo = navigation.to?.url ?? null;
		leaveOpen = true;
	});

	async function discardAndLeave() {
		const target = leaveTo;
		leaveOpen = false;
		drafts = NO_DRAFTS;
		// `target` is the URL SvelteKit was already navigating to (base included), so no resolve().
		if (target) await goto(target);
	}
</script>

<svelte:head>
	<title>จัดลำดับแบนเนอร์ Kiosk — SmartShelter</title>
</svelte:head>

<StaffPageShell
	title="จัดลำดับแบนเนอร์"
	description="ลากเพื่อจัดลำดับที่ตู้ kiosk แสดงแบนเนอร์ แยกตามขนาดหน้าจอ — กดบันทึกเพื่อใช้ลำดับใหม่"
>
	{#snippet meta()}
		<div class="flex flex-wrap items-center gap-x-4 gap-y-1">
			<p class="text-sm text-slate-600">
				ศูนย์: <span class="font-semibold text-slate-900">{activeShelter}</span>
			</p>
			<a
				href={listHref}
				class="inline-flex min-h-11 items-center gap-1 text-sm text-primary underline-offset-2 hover:underline"
			>
				<ArrowLeft class="h-4 w-4" />
				กลับไปรายการแบนเนอร์
			</a>
		</div>
	{/snippet}

	<div class={spatial.container.staffPageCard}>
		<Tabs.Root value={screen} onValueChange={selectScreen}>
			<div
				class="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-6"
			>
				<Tabs.List class="h-11">
					{#each KIOSK_SCREEN_TYPES as type (type)}
						<Tabs.Trigger value={type} class="px-4">{tabLabel(type)}</Tabs.Trigger>
					{/each}
				</Tabs.List>
				<div class="flex flex-wrap items-center gap-2">
					<Button variant="outline" class="min-h-11 gap-2" onclick={openPreview}>
						<Eye class="h-4 w-4" />
						ดูตัวอย่าง
					</Button>
					<Button
						variant="outline"
						class="min-h-11"
						disabled={!dirty[screen] || reorder.isPending}
						onclick={() => setDraft(screen, null)}
					>
						ยกเลิก
					</Button>
					<Button
						class="btn-primary-brand min-h-11"
						disabled={!dirty[screen] || reorder.isPending}
						onclick={save}
					>
						{reorder.isPending ? 'กำลังบันทึก...' : 'บันทึกลำดับ'}
					</Button>
				</div>
			</div>

			<div
				class="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-4 py-2 sm:px-6"
			>
				<p class="text-sm text-slate-500">
					ลากที่ไอคอน ⠿ หรือกดลูกศรเพื่อย้าย · ลำดับใหม่ยังไม่มีผลจนกดบันทึก
				</p>
				{#if dirty[screen]}
					<p
						class="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-900"
					>
						<TriangleAlert class="h-3.5 w-3.5" />
						มีลำดับที่ยังไม่บันทึก
					</p>
				{/if}
			</div>

			{#each KIOSK_SCREEN_TYPES as type (type)}
				<Tabs.Content value={type}>
					{#if screen === type}
						{#if bannersQuery.isLoading}
							<p class="px-6 py-16 text-center text-muted-foreground">กำลังโหลดรายการแบนเนอร์...</p>
						{:else if bannersQuery.isError}
							<p class="px-6 py-16 text-center text-sm text-destructive">
								{bannersQuery.error instanceof Error
									? bannersQuery.error.message
									: 'โหลดรายการแบนเนอร์ไม่สำเร็จ'}
							</p>
						{:else}
							<KioskBannerOrderList
								bind:items={() => shown[type], (next) => setDraft(type, next)}
								{now}
								disabled={reorder.isPending}
							/>
						{/if}
					{/if}
				</Tabs.Content>
			{/each}
		</Tabs.Root>
	</div>
</StaffPageShell>

<KioskBannerPreviewDialog bind:open={previewOpen} slides={previewSlides} initialScreen={screen} />

<AlertDialog.Root bind:open={leaveOpen}>
	<AlertDialog.Content class="max-w-md">
		<AlertDialog.Header>
			<div class="flex items-center gap-2 text-destructive">
				<TriangleAlert class="size-5 shrink-0" />
				<AlertDialog.Title>ทิ้งลำดับที่ยังไม่บันทึก?</AlertDialog.Title>
			</div>
			<AlertDialog.Description class="pt-2 text-sm">
				ลำดับที่จัดไว้ยังไม่ถูกบันทึก ถ้าออกจากหน้านี้ลำดับจะกลับเป็นแบบเดิม
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
