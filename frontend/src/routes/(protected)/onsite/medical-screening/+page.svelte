<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import { Html5Qrcode } from 'html5-qrcode';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Scan from '@lucide/svelte/icons/scan';
	import Search from '@lucide/svelte/icons/search';
	import Camera from '@lucide/svelte/icons/camera';
	import CameraOff from '@lucide/svelte/icons/camera-off';
	import Stethoscope from '@lucide/svelte/icons/stethoscope';
	import Clock from '@lucide/svelte/icons/clock';
	import Users from '@lucide/svelte/icons/users';
	import X from '@lucide/svelte/icons/x';
	import Check from '@lucide/svelte/icons/check';
	import Pencil from '@lucide/svelte/icons/pencil';

	import PaginationControls from '$lib/components/pagination-controls.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Badge } from '$lib/components/ui/badge';
	import * as Card from '$lib/components/ui/card';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Table from '$lib/components/ui/table';
	import * as Tabs from '$lib/components/ui/tabs';

	import {
		useEvacuees,
		useHouseholds,
		useScreenings,
		maskNationalId,
		lookupFederatedByScanCode
	} from '$lib/features/people';
	import {
		ClaimDialog,
		type UnassignedRegistrationSearchHit
	} from '$lib/features/unassigned-registration';
	import { useQueryClient } from '@tanstack/svelte-query';
	import { useShelter } from '$lib/features/shelters';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { DISPLAY_LOCALE, DISPLAY_TIME_ZONE, formatThaiTime } from '$lib/utils/date';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { STAFF_MEDICAL_SCREENING_I18N } from '$lib/constants/i18n/staff-medical-screening';
	import { paginateItems } from '$lib/db/paginate';
	import { getShelterCode } from '$lib/db/shelter';
	import { useMasterData, formatMasterLabel } from '$lib/features/master-data';
	import {
		buildMedicalScreeningPath,
		classifyScreeningQueueTab,
		matchesMedicalScreeningSearch,
		type ScreeningQueueTab
	} from './medical-screening.utils';

	const PAGE_SIZE = 10;

	const t = $derived(getTranslation(STAFF_MEDICAL_SCREENING_I18N, langState.current));

	const shelterQuery = useShelter(() => shelterStore.selectedShelterCode ?? getShelterCode());
	const enableMedical = $derived(
		shelterQuery.data?.feature_flags?.enable_medical_screening ?? false
	);

	const allEvacueesQuery = useEvacuees();
	const householdsQuery = useHouseholds();
	const screeningsQuery = useScreenings();
	const queryClient = useQueryClient();
	const vulnerableGroupQuery = useMasterData(() => 'vulnerable_group');

	const allEvacuees = $derived(allEvacueesQuery.data ?? []);
	const householdMap = $derived(new Map((householdsQuery.data ?? []).map((h) => [h._id, h])));
	const screenedIds = $derived(new Set((screeningsQuery.data ?? []).map((s) => s.evacuee_id)));

	let searchQuery = $state('');
	let barcodeInput = $state('');
	let showCameraModal = $state(false);
	let cameraError = $state<string | null>(null);
	/** Why the last scanned Person QR was refused; shown in the scanner modal, cleared on next scan. */
	let scanRejection = $state<string | null>(null);
	$effect(() => {
		if (!showCameraModal) scanRejection = null;
	});
	let activeTab = $state<ScreeningQueueTab>('pending');
	let currentPage = $state(1);
	let claimOpen = $state(false);
	let claimHit = $state<UnassignedRegistrationSearchHit | null>(null);
	let lookupInFlight = $state(false);

	const pendingEvacuees = $derived(
		allEvacuees.filter((e) => classifyScreeningQueueTab(e, screenedIds) === 'pending')
	);
	const screenedEvacuees = $derived(
		allEvacuees.filter((e) => classifyScreeningQueueTab(e, screenedIds) === 'screened')
	);

	const tabEvacuees = $derived(activeTab === 'pending' ? pendingEvacuees : screenedEvacuees);

	const filteredQueue = $derived(
		tabEvacuees.filter((evacuee) => {
			const household = evacuee.household_id ? householdMap.get(evacuee.household_id) : undefined;
			return matchesMedicalScreeningSearch(evacuee, searchQuery, household);
		})
	);

	const pagedRows = $derived(paginateItems(filteredQueue, currentPage, PAGE_SIZE));

	$effect(() => {
		void [activeTab, searchQuery];
		currentPage = 1;
	});

	const isLoading = $derived(
		allEvacueesQuery.isPending || screeningsQuery.isPending || householdsQuery.isPending
	);

	function openScreeningForm(id: string) {
		const path = buildMedicalScreeningPath(id);
		goto(resolve(path as `/onsite/medical-screening/${string}`));
	}

	async function handleCodeInput(raw: string) {
		if (lookupInFlight) return;
		lookupInFlight = true;
		scanRejection = null;
		try {
			const result = await lookupFederatedByScanCode(queryClient, raw);
			if (!result) {
				toast.error(t.toastCodeNotFound);
				return;
			}
			if (result.source === 'qr_rejected') {
				// Expired / invalid Person QR (CR-233): message only, nothing opened or recorded.
				scanRejection = result.message;
				toast.error('สแกนไม่ผ่าน');
				return;
			}
			barcodeInput = '';
			showCameraModal = false;
			if (result.source === 'couch') {
				toast.success(
					t.toastFoundEvacuee(`${result.evacuee.first_name} ${result.evacuee.last_name}`)
				);
				openScreeningForm(result.evacuee._id);
				return;
			}
			toast.success(t.toastFoundCentralQueue);
			claimHit = result.hit;
			claimOpen = true;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : t.toastScanLookupFailed);
		} finally {
			lookupInFlight = false;
		}
	}

	function cameraAttachment(node: HTMLDivElement) {
		const html5QrCode = new Html5Qrcode(node.id);
		cameraError = null;

		html5QrCode
			.start(
				{ facingMode: 'environment' },
				{
					fps: 10,
					qrbox: (width, height) => {
						const minDimension = Math.min(width, height);
						const qrboxSize = Math.floor(minDimension * 0.7);
						return { width: qrboxSize, height: qrboxSize };
					}
				},
				(decodedText) => {
					if (decodedText) {
						if (typeof navigator !== 'undefined' && navigator.vibrate) {
							navigator.vibrate(100);
						}
						handleCodeInput(decodedText);
					}
				},
				() => {}
			)
			.catch(() => {
				cameraError = t.cameraAccessError;
			});

		return () => {
			if (html5QrCode.isScanning) {
				html5QrCode.stop().catch(() => {});
			}
		};
	}

	function getSpecialNeedLabel(need: string): string {
		const masterItem = vulnerableGroupQuery.data?.items.find((i) => i.code === need);
		if (masterItem) return formatMasterLabel(masterItem, langState.current);
		const fromLegacy = t.specialNeedLabels[need];
		if (fromLegacy) return fromLegacy;
		if (need.startsWith('item_')) return '—';
		return need;
	}

	function formatTimeOrDate(isoDate?: string | null): string {
		if (!isoDate) return '—';
		const time = formatThaiTime(isoDate);
		if (!time) return isoDate;
		const day = new Date(isoDate).toLocaleDateString(DISPLAY_LOCALE, {
			timeZone: DISPLAY_TIME_ZONE,
			day: 'numeric',
			month: 'short'
		});
		return `${time}${t.timeSuffix} (${day})`;
	}
</script>

{#snippet needBadges(evacuee: (typeof pagedRows.items)[number])}
	{#if (evacuee.vulnerable_groups && evacuee.vulnerable_groups.length > 0) || (evacuee.special_needs && evacuee.special_needs.length > 0)}
		<div class="flex flex-wrap gap-1">
			{#each evacuee.vulnerable_groups ?? [] as need (need)}
				<Badge
					variant="outline"
					class="border-primary/30 bg-primary/10 px-1.5 py-0 text-[11px] text-primary"
				>
					{getSpecialNeedLabel(need)}
				</Badge>
			{/each}
			{#each evacuee.special_needs ?? [] as need (need)}
				<Badge
					variant="outline"
					class="border-amber-500/30 bg-amber-500/10 px-1.5 py-0 text-[11px] text-amber-700 dark:text-amber-300"
				>
					{getSpecialNeedLabel(need)}
				</Badge>
			{/each}
		</div>
	{:else}
		<span class="text-xs text-muted-foreground">—</span>
	{/if}
{/snippet}

<svelte:head>
	<title>{t.queuePageTitle}</title>
</svelte:head>

{#if !enableMedical && !shelterQuery.isPending}
	<div class="flex min-h-[calc(100vh-8rem)] flex-1 items-center justify-center p-6">
		<Card.Root class="w-full max-w-md border-border bg-card p-6 text-center shadow-sm">
			<div
				class="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600"
			>
				<Stethoscope class="size-6" />
			</div>
			<h2 class="text-base font-bold text-foreground">{t.disabledTitle}</h2>
			<p class="mt-1.5 text-xs leading-relaxed text-muted-foreground">
				{t.disabledDesc}
			</p>
			<div class="mt-5 flex flex-col gap-2">
				<Button
					variant="default"
					class="h-auto min-h-9 w-full py-2 leading-tight whitespace-normal"
					onclick={() => goto(resolve('/portal'))}
				>
					{t.backToPortal}
				</Button>
				<Button
					variant="outline"
					class="h-auto min-h-9 w-full py-2 leading-tight whitespace-normal"
					onclick={() => goto(resolve('/onsite/zoning'))}
				>
					{t.goToStation3}
				</Button>
			</div>
		</Card.Root>
	</div>
{:else}
	<div class="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-6">
		<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
			<div class="flex min-w-0 items-center gap-3">
				<a
					href={resolve('/portal')}
					class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
					title={t.backToPortal}
				>
					<ArrowLeft class="size-4" />
				</a>
				<div class="min-w-0">
					<div class="flex items-center gap-2.5">
						<div
							class="flex size-8 items-center justify-center rounded-lg bg-station-2-subtle text-station-2"
						>
							<Stethoscope class="size-5" />
						</div>
						<h1 class="text-2xl font-bold tracking-tight text-foreground">
							{t.heading}
						</h1>
					</div>
					<p class="mt-0.5 text-xs text-muted-foreground">
						{t.intro}
					</p>
				</div>
			</div>

			<div class="flex flex-wrap items-center gap-2">
				<Badge variant="secondary" class="gap-1.5 px-3 py-1.5 text-sm font-semibold shadow-xs">
					<Clock class="size-3.5 text-emerald-600 dark:text-emerald-400" />
					<span>{t.pendingBadgeLabel}</span>
					<span class="font-bold text-emerald-700 dark:text-emerald-300">
						{t.peopleCount(pendingEvacuees.length)}
					</span>
				</Badge>
				<Badge variant="secondary" class="gap-1.5 px-3 py-1.5 text-sm font-semibold shadow-xs">
					<Pencil class="size-3.5 text-sky-600 dark:text-sky-400" />
					<span>{t.screenedBadgeLabel}</span>
					<span class="font-bold text-sky-700 dark:text-sky-300">
						{t.peopleCount(screenedEvacuees.length)}
					</span>
				</Badge>
			</div>
		</div>

		<Card.Root class="border-border bg-card p-4 shadow-sm">
			<div class="flex flex-col gap-3 md:flex-row md:items-center">
				<div class="relative flex-1">
					<Search
						class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
					/>
					<Input
						type="text"
						placeholder={t.searchPlaceholder}
						bind:value={searchQuery}
						class="h-10 w-full bg-background pr-8 pl-9"
					/>
					{#if searchQuery}
						<button
							type="button"
							onclick={() => (searchQuery = '')}
							class="absolute top-1/2 right-2.5 -translate-y-1/2 p-0.5 text-muted-foreground hover:text-foreground"
							title={t.clearSearchTitle}
						>
							<X class="size-3.5" />
						</button>
					{/if}
				</div>

				<div class="flex flex-wrap items-center gap-2">
					<div class="relative w-full min-w-0 sm:w-auto sm:min-w-[220px]">
						<Scan
							class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
						/>
						<Input
							type="text"
							placeholder={t.scanPlaceholder}
							bind:value={barcodeInput}
							onkeydown={(e) => {
								if (e.key === 'Enter') {
									e.preventDefault();
									handleCodeInput(barcodeInput);
								}
							}}
							class="h-10 bg-background pl-9 font-mono text-xs"
						/>
					</div>
					<Button
						variant="outline"
						size="default"
						onclick={() => handleCodeInput(barcodeInput)}
						disabled={!barcodeInput.trim()}
						class="h-10 shrink-0"
					>
						{t.confirm}
					</Button>
					<Button
						variant="default"
						size="default"
						onclick={() => (showCameraModal = true)}
						class="h-10 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
					>
						<Camera class="size-4" />
						<span>{t.scanCamera}</span>
					</Button>
				</div>
			</div>
		</Card.Root>

		{#snippet queueTable()}
			<Card.Root class="overflow-hidden border-border bg-card shadow-sm">
				<Card.Header class="border-b bg-muted/20 px-5 py-3.5">
					<div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
						<div class="flex min-w-0 flex-wrap items-center gap-2">
							<Users class="size-4 text-emerald-600 dark:text-emerald-400" />
							<Card.Title class="min-w-0 text-base font-semibold break-words">
								{activeTab === 'pending' ? t.queueTitlePending : t.queueTitleScreened}
							</Card.Title>
							<Badge variant="secondary" class="text-xs">
								{t.recordCount(filteredQueue.length)}
							</Badge>
						</div>
						{#if searchQuery}
							<span class="text-xs text-muted-foreground">
								{t.filteredFromTotal(tabEvacuees.length)}
							</span>
						{/if}
					</div>
				</Card.Header>

				<Card.Content class="p-0">
					{#if isLoading}
						<div class="flex h-48 flex-col items-center justify-center gap-2 text-muted-foreground">
							<div
								class="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent"
							></div>
							<p class="text-xs">{t.loadingQueue}</p>
						</div>
					{:else if filteredQueue.length === 0}
						<div
							class="flex h-48 flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground"
						>
							{#if searchQuery}
								<Search class="size-8 text-muted-foreground/50" />
								<p class="text-sm font-medium">{t.noMatch(searchQuery)}</p>
								<Button variant="ghost" size="sm" onclick={() => (searchQuery = '')}>
									{t.clearSearch}
								</Button>
							{:else if activeTab === 'pending'}
								<Check class="size-8 text-emerald-500/60" />
								<p class="text-sm font-medium text-foreground">
									{t.emptyPending}
								</p>
							{:else}
								<Pencil class="size-8 text-sky-500/60" />
								<p class="text-sm font-medium text-foreground">{t.emptyScreened}</p>
							{/if}
						</div>
					{:else}
						<ul role="list" class="divide-y divide-border md:hidden" data-testid="screening-cards">
							{#each pagedRows.items as evacuee (evacuee._id)}
								<li class="space-y-2 px-4 py-3">
									<button
										type="button"
										tabindex="-1"
										class="block w-full min-w-0 text-left"
										onclick={() => openScreeningForm(evacuee._id)}
									>
										<span class="block font-semibold break-words text-foreground">
											{evacuee.first_name}
											{evacuee.last_name}
										</span>
										{#if evacuee.nickname}
											<span class="text-xs text-muted-foreground">({evacuee.nickname})</span>
										{/if}
									</button>
									<div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
										<span>
											{t.colRegisteredAt}:
											{formatTimeOrDate(evacuee.current_stay?.since || evacuee.created_at)}
										</span>
										<span
											>{t.colIdNo}:
											<span class="font-mono">{maskNationalId(evacuee.person_id?.number)}</span
											></span
										>
										<span>{t.colPhone}: {evacuee.phone || '—'}</span>
									</div>
									{@render needBadges(evacuee)}
									<Button
										variant="outline"
										class="min-h-11 w-full"
										onclick={() => openScreeningForm(evacuee._id)}
									>
										{activeTab === 'pending' ? t.btnScreen : t.btnEditResult}
									</Button>
								</li>
							{/each}
						</ul>
						<div class="hidden overflow-x-auto md:block">
							<Table.Root>
								<Table.TableHeader class="bg-muted/40 text-xs">
									<Table.TableRow>
										<Table.TableHead class="w-[200px]">{t.colName}</Table.TableHead>
										<Table.TableHead>{t.colIdNo}</Table.TableHead>
										<Table.TableHead>{t.colPhone}</Table.TableHead>
										<Table.TableHead>{t.colRegisteredAt}</Table.TableHead>
										<Table.TableHead>{t.colVulnerable}</Table.TableHead>
										<Table.TableHead class="text-right">{t.colActions}</Table.TableHead>
									</Table.TableRow>
								</Table.TableHeader>
								<Table.TableBody>
									{#each pagedRows.items as evacuee (evacuee._id)}
										<Table.TableRow
											class="cursor-pointer transition-colors hover:bg-muted/50"
											onclick={() => openScreeningForm(evacuee._id)}
										>
											<Table.TableCell class="py-3">
												<div class="flex flex-col">
													<span class="font-semibold text-foreground">
														{evacuee.first_name}
														{evacuee.last_name}
													</span>
													{#if evacuee.nickname}
														<span class="text-xs text-muted-foreground">
															({evacuee.nickname})
														</span>
													{/if}
												</div>
											</Table.TableCell>
											<Table.TableCell class="py-3 font-mono text-xs text-muted-foreground">
												{maskNationalId(evacuee.person_id?.number)}
											</Table.TableCell>
											<Table.TableCell class="py-3 text-xs">
												{evacuee.phone || '—'}
											</Table.TableCell>
											<Table.TableCell class="py-3 text-xs whitespace-nowrap text-muted-foreground">
												{formatTimeOrDate(evacuee.current_stay?.since || evacuee.created_at)}
											</Table.TableCell>
											<Table.TableCell class="py-3">
												{@render needBadges(evacuee)}
											</Table.TableCell>
											<Table.TableCell class="py-3 text-right">
												<Button
													variant="outline"
													size="sm"
													onclick={(e) => {
														e.stopPropagation();
														openScreeningForm(evacuee._id);
													}}
													class="h-7 text-xs"
												>
													{activeTab === 'pending' ? t.btnScreen : t.btnEditResult}
												</Button>
											</Table.TableCell>
										</Table.TableRow>
									{/each}
								</Table.TableBody>
							</Table.Root>
						</div>
						{#if pagedRows.totalPages > 1}
							<div class="border-t border-border px-5 py-3">
								<PaginationControls
									bind:page={currentPage}
									count={filteredQueue.length}
									perPage={PAGE_SIZE}
								/>
							</div>
						{/if}
					{/if}
				</Card.Content>
			</Card.Root>
		{/snippet}

		<Tabs.Root bind:value={activeTab} class="gap-4">
			<Tabs.List class="grid h-auto w-full max-w-md grid-cols-2">
				<Tabs.Trigger
					value="pending"
					class="min-w-0 flex-wrap gap-1.5 leading-tight whitespace-normal"
				>
					{t.tabPending}
					<Badge variant="secondary" class="text-[10px]">{pendingEvacuees.length}</Badge>
				</Tabs.Trigger>
				<Tabs.Trigger
					value="screened"
					class="min-w-0 flex-wrap gap-1.5 leading-tight whitespace-normal"
				>
					{t.tabScreened}
					<Badge variant="secondary" class="text-[10px]">{screenedEvacuees.length}</Badge>
				</Tabs.Trigger>
			</Tabs.List>

			<Tabs.Content value="pending" class="mt-0">
				{@render queueTable()}
			</Tabs.Content>
			<Tabs.Content value="screened" class="mt-0">
				{@render queueTable()}
			</Tabs.Content>
		</Tabs.Root>
	</div>

	{#if showCameraModal}
		<Dialog.Root
			open={showCameraModal}
			onOpenChange={(open) => {
				if (!open) showCameraModal = false;
			}}
		>
			<Dialog.Content
				class="flex max-h-[85vh] w-full max-w-md flex-col rounded-3xl border-border bg-card p-6"
			>
				<Dialog.Header class="border-b pb-4">
					<Dialog.Title class="flex items-center gap-2 text-base font-bold text-foreground">
						<Scan class="size-5 text-emerald-600 dark:text-emerald-400" />
						<span>{t.cameraDialogTitle}</span>
					</Dialog.Title>
					<Dialog.Description class="text-xs text-muted-foreground">
						{t.cameraDialogDesc}
					</Dialog.Description>
				</Dialog.Header>

				<div class="my-6 flex flex-col items-center justify-center">
					<div
						class="relative flex aspect-square w-full max-w-[280px] items-center justify-center overflow-hidden rounded-2xl border border-border bg-background"
					>
						{#if !cameraError}
							<div
								id="medical-screening-qr-reader"
								class="h-full w-full overflow-hidden rounded-2xl [&_video]:h-full! [&_video]:w-full! [&_video]:rounded-2xl! [&_video]:bg-transparent! [&_video]:object-cover!"
								{@attach cameraAttachment}
							></div>
							<div class="pointer-events-none absolute inset-4">
								<div
									class="absolute top-0 left-0 h-6 w-6 rounded-tl-md border-t-4 border-l-4 border-emerald-500/80"
								></div>
								<div
									class="absolute top-0 right-0 h-6 w-6 rounded-tr-md border-t-4 border-r-4 border-emerald-500/80"
								></div>
								<div
									class="absolute bottom-0 left-0 h-6 w-6 rounded-bl-md border-b-4 border-l-4 border-emerald-500/80"
								></div>
								<div
									class="absolute right-0 bottom-0 h-6 w-6 rounded-br-md border-r-4 border-b-4 border-emerald-500/80"
								></div>
							</div>
						{:else}
							<div class="flex flex-col items-center justify-center p-6 text-center text-red-500">
								<CameraOff class="mb-3 size-12" />
								<p class="text-xs font-semibold">{cameraError}</p>
							</div>
						{/if}
					</div>
					{#if scanRejection}
						<p
							role="alert"
							class="mt-4 w-full rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
						>
							{scanRejection}
						</p>
					{/if}
				</div>

				<Dialog.Footer>
					<Button variant="outline" onclick={() => (showCameraModal = false)} class="w-full">
						{t.cancel}
					</Button>
				</Dialog.Footer>
			</Dialog.Content>
		</Dialog.Root>
	{/if}
{/if}

<ClaimDialog
	bind:open={claimOpen}
	bind:hit={claimHit}
	shelterCode={shelterStore.selectedShelterCode ?? getShelterCode()}
/>
