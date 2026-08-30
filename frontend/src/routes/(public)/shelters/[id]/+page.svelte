<script lang="ts">
	import type { PageData } from './$types';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
	import { BookingModal } from '$lib/features/public-register';

	import ShelterHero from '$lib/components/shelter-hero.svelte';
	import ShelterAdmission from '$lib/components/shelter-admission.svelte';
	import ShelterTravel from '$lib/components/shelter-travel.svelte';
	import ShelterZones from '$lib/components/shelter-zones.svelte';
	import ShelterFacilities from '$lib/components/shelter-facilities.svelte';
	import ShelterContact from '$lib/components/shelter-contact.svelte';
	import { PublicPageShell } from '$lib/features/public-portal';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_SHELTER_DETAILS_I18N } from '$lib/constants/i18n';

	let { data }: { data: PageData } = $props();
	let shelter = $derived(data.shelter);
	let t = $derived(getTranslation(PUBLIC_SHELTER_DETAILS_I18N, langState.current));

	// CR-070 / T-71 — a closed shelter cannot be booked; everything else can
	// (a full one warns inside the wizard rather than blocking, per FR-72).
	let canBook = $derived(Boolean(shelter?.code) && shelter?.status !== 'CLOSED');
	let bookingOpen = $state(false);
</script>

<svelte:head>
	<title>{shelter?.name || t.shelterDetailFallback} - Smart Shelter</title>
</svelte:head>

<div class="pb-20">
	<!-- Top Navigation Bar -->
	<div class="border-b border-border bg-card">
		<div class="mx-auto flex max-w-380 items-center justify-between px-4 py-3 sm:px-6">
			<a
				href="/shelters"
				class="flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-1.5 text-sm font-bold text-foreground/90 transition-colors hover:text-primary"
			>
				<ChevronLeft class="h-4 w-4" />
				{t.backToShelters}
			</a>
			{#if canBook && shelter}
				<button
					type="button"
					onclick={() => (bookingOpen = true)}
					class="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-primary px-4 py-1.5 text-sm font-bold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
				>
					<ClipboardCheck class="h-4 w-4" />
					{t.bookThisShelter}
				</button>
			{:else}
				<div
					class="hidden text-2xs font-bold tracking-widest text-muted-foreground/80 uppercase md:block"
				>
					{t.shelterDetailSubtitle}
				</div>
			{/if}
		</div>
	</div>

	{#if shelter}
		<PublicPageShell class="space-y-8">
			<ShelterHero {shelter} />

			<!-- Main Content Grid -->
			<div class="grid grid-cols-1 gap-8 lg:grid-cols-2">
				<!-- LEFT COLUMN -->
				<div class="flex flex-col gap-8">
					<ShelterAdmission {shelter} />
					<ShelterTravel {shelter} />
					<ShelterZones {shelter} />
				</div>

				<!-- RIGHT COLUMN -->
				<div class="flex flex-col gap-8">
					<ShelterFacilities {shelter} />
					<ShelterContact {shelter} />
				</div>
			</div>
		</PublicPageShell>
	{:else}
		<div class="flex min-h-[50vh] flex-col items-center justify-center px-4 py-20 text-center">
			<AlertTriangle class="mb-4 h-12 w-12 text-muted-foreground/60" />
			<h2 class="text-xl font-bold text-foreground/90">{t.shelterNotFound}</h2>
			<p class="mt-2 text-sm text-muted-foreground">
				{t.shelterNotFoundDesc}
			</p>
			<a
				href="/shelters"
				class="mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-primary px-6 text-sm font-bold text-primary-foreground shadow-sm hover:bg-primary/90"
			>
				{t.backToShelters}
			</a>
		</div>
	{/if}
</div>

{#if shelter}
	<BookingModal bind:open={bookingOpen} shelterCode={shelter.code} />
{/if}
