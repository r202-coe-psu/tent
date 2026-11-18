<script lang="ts">
	import Navigation from '@lucide/svelte/icons/navigation';
	import Eye from '@lucide/svelte/icons/eye';
	import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
	import Users from '@lucide/svelte/icons/users';
	import X from '@lucide/svelte/icons/x';

	import ExternalShelterChip from './external-shelter-chip.svelte';
	import { Button } from '$lib/components/ui/button';
	import type { PublicShelterCardModel } from '../domain/types';
	import { shelterStatusClass, shelterStatusLabel } from '../domain/shelter-status';
	import { getTranslation } from '$lib/utils/i18n';
	import { directionsUrl } from '$lib/utils/maps';
	import { PUBLIC_SHELTERS_I18N, PUBLIC_SHELTER_CARD_I18N } from '$lib/constants/i18n';
	import { langState } from '$lib/states/i18n.svelte';

	/** Mobile (< lg) summary card over the bottom of the `/shelters` map for the picked pin. */
	let {
		shelter,
		onClose,
		onPreRegister
	}: {
		shelter: PublicShelterCardModel;
		onClose: () => void;
		onPreRegister: (shelterCode: string) => void;
	} = $props();

	const t = $derived(getTranslation(PUBLIC_SHELTERS_I18N, langState.current));
	const cardT = $derived(getTranslation(PUBLIC_SHELTER_CARD_I18N, langState.current));
</script>

<div
	class="pointer-events-auto absolute right-3 bottom-3 left-3 z-20 mx-auto max-w-md animate-in duration-200 slide-in-from-bottom-3 lg:hidden"
>
	<div
		class="relative rounded-2xl border border-border/80 bg-card/95 p-3.5 shadow-xl backdrop-blur-md"
	>
		<!-- Top row: Status + Distance + Close -->
		<div class="flex items-center justify-between gap-2 border-b border-border/50 pb-2">
			<div class="flex items-center gap-2">
				{#if shelter.is_external}
					<ExternalShelterChip
						label={t.statusUnknown}
						href={shelter.external_url}
						linkLabel={`${cardT.externalLink} ${cardT.externalLinkNewTab}`}
					/>
				{:else}
					<span
						class="inline-flex items-center rounded-full border px-2 py-0.5 text-2xs font-bold {shelterStatusClass(
							shelter.status
						)}"
					>
						<span class="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-current"></span>
						{shelterStatusLabel(shelter.status, t)}
					</span>
				{/if}
				{#if shelter.distance != null && !isNaN(shelter.distance) && shelter.distance > 0}
					<span class="inline-flex items-center gap-1 text-2xs font-semibold text-muted-foreground">
						<Navigation class="h-3 w-3" />
						{shelter.distance}
						{cardT.km}
					</span>
				{/if}
			</div>
			<button
				type="button"
				class="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-muted-foreground hover:text-foreground"
				onclick={onClose}
				aria-label="Close"
			>
				<X class="h-3.5 w-3.5" />
			</button>
		</div>

		<!-- Content row: Title & Capacity -->
		<div class="mt-2">
			<h4 class="line-clamp-1 text-sm font-bold text-foreground">
				{shelter.name}
			</h4>
			<div class="mt-0.5 flex items-center justify-between text-2xs text-muted-foreground">
				<span class="line-clamp-1">
					{shelter.district ? `${cardT.districtPrefix}${shelter.district}` : ''}
					{shelter.province ? `, ${cardT.provincePrefix}${shelter.province}` : ''}
				</span>
				<span class="shrink-0 font-semibold text-foreground">
					<Users class="mr-0.5 inline-block h-3 w-3 text-muted-foreground" />
					{#if shelter.is_external && !((shelter.capacity ?? 0) > 0)}
						{cardT.contactAtShelter}
					{:else}
						{cardT.maxCapacity}
						{shelter.capacity ?? 0}
						{cardT.people}
					{/if}
				</span>
			</div>
		</div>

		<!-- Actions row -->
		<div class="mt-2.5 flex gap-1.5">
			{#if !shelter.is_external && shelter.status !== 'CLOSED' && shelter.accepts_pre_registration && shelter.code}
				<Button
					type="button"
					size="sm"
					class="h-9 flex-1 rounded-xl bg-primary text-2xs font-bold text-primary-foreground shadow-xs"
					onclick={() => onPreRegister(shelter.code)}
				>
					<ClipboardCheck class="mr-1 h-3.5 w-3.5" />
					{cardT.preRegister}
				</Button>
			{/if}
			<Button
				href={`/shelters/${shelter.id}`}
				variant="outline"
				size="sm"
				class="h-9 flex-1 rounded-xl border-border text-2xs font-bold text-foreground hover:bg-muted"
			>
				<Eye class="mr-1 h-3.5 w-3.5" />
				{cardT.viewDetails}
			</Button>
			{#if shelter.geo?.lat != null && shelter.geo?.lng != null}
				<Button
					href={directionsUrl(shelter.geo)}
					target="_blank"
					rel="noopener noreferrer"
					size="sm"
					class="h-9 w-9 shrink-0 rounded-xl bg-primary-dark p-0 text-primary-foreground hover:bg-primary"
					aria-label={cardT.navigate}
					title={cardT.navigate}
				>
					<Navigation class="h-3.5 w-3.5" />
				</Button>
			{/if}
		</div>
	</div>
</div>
