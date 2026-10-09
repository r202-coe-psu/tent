<script lang="ts">
	import Building2 from '@lucide/svelte/icons/building-2';
	import Check from '@lucide/svelte/icons/check';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Home from '@lucide/svelte/icons/home';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import Package from '@lucide/svelte/icons/package';
	import PawPrint from '@lucide/svelte/icons/paw-print';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Users from '@lucide/svelte/icons/users';
	import { Button } from '$lib/components/ui/button/index.js';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_BOOKING_FORM_I18N } from '$lib/constants/i18n';
	import type {
		UnifiedMemberWithMeta,
		UnifiedRegistrationInput
	} from '../../domain/unified-registration';

	let {
		shelterName = '',
		shelterCode = '',
		household,
		members,
		showVehiclesAssets = false,
		activeSection,
		pending = false,
		submitDisabled = false,
		submitLabel = '',
		submittingLabel = '',
		/** Desktop aside keeps submit; mobile summary sheet relies on sticky CTA. */
		showSubmit = true,
		existingMembers = [],
		existingHeadName = '',
		existingCount = 0,
		existingMaskedNames = [],
		onNavigate
	}: {
		shelterName?: string;
		shelterCode?: string;
		household: UnifiedRegistrationInput['household'];
		members: UnifiedMemberWithMeta[];
		showVehiclesAssets?: boolean;
		activeSection: string;
		pending?: boolean;
		submitDisabled?: boolean;
		submitLabel?: string;
		submittingLabel?: string;
		showSubmit?: boolean;
		/** Joining a family: its current members (onsite) — counted with the new ones. */
		existingMembers?: ReadonlyArray<{
			_id?: string;
			first_name?: string | null;
			last_name?: string | null;
			/** Stored members may have no gender (CR-154). */
			gender?: string | null;
			vulnerable_groups?: readonly string[] | null;
			special_needs?: readonly string[] | null;
		}>;
		/** Joining a family: the family's head, who stays the primary contact. */
		existingHeadName?: string;
		/** Joining a family whose members can't be listed (public): how many are already in it. */
		existingCount?: number;
		/** Public join: the family's current members as masked names (first name + hidden surname). */
		existingMaskedNames?: readonly string[];
		onNavigate: (sectionId: string) => void;
	} = $props();

	const t = $derived(getTranslation(PUBLIC_BOOKING_FORM_I18N, langState.current));

	const formattedAddress = $derived.by(() => {
		const parts = [
			household.address_no ? `${t.addrHouseNo} ${household.address_no}` : '',
			household.village_no || '',
			household.subdistrict
				? `${t.addrSubdistrictAbbr}${langState.current === 'en' ? ' ' : ''}${household.subdistrict}`
				: '',
			household.district
				? `${t.addrDistrictAbbr}${langState.current === 'en' ? ' ' : ''}${household.district}`
				: '',
			household.province
				? `${t.addrProvinceAbbr}${langState.current === 'en' ? ' ' : ''}${household.province}`
				: '',
			household.postal_code || ''
		].filter(Boolean);
		return parts.join(' ');
	});

	const headMember = $derived(members[0]);
	const headFullName = $derived(
		existingHeadName ||
			(headMember ? `${headMember.first_name || ''} ${headMember.last_name || ''}`.trim() : '')
	);
	const existingTotal = $derived(
		Math.max(existingMembers.length, existingMaskedNames.length, existingCount)
	);
	const totalCount = $derived(existingTotal + members.length);
	/** Gender / care counts cover everyone in the family, existing and new. */
	const everyone = $derived([...existingMembers, ...members]);

	/** Joined family first (its head is primary), then the new cards numbered after them. */
	const memberSummaries = $derived([
		...existingMembers.map((member, index) => {
			const name = `${member.first_name || ''} ${member.last_name || ''}`.trim();
			return {
				id: member._id || `existing-${index}`,
				name: name || `${t.summaryMemberNo} ${index + 1}`,
				isPrimary: Boolean(existingHeadName) && name === existingHeadName,
				isExisting: true
			};
		}),
		// Public join: names arrive masked, no other details.
		...(existingMembers.length > 0 ? [] : existingMaskedNames).map((name, index) => ({
			id: `existing-masked-${index}`,
			name,
			isPrimary: Boolean(existingHeadName) && name === existingHeadName,
			isExisting: true
		})),
		...members.map((member, index) => ({
			id: member._id || `member-${index}`,
			name:
				`${member.first_name || ''} ${member.last_name || ''}`.trim() ||
				`${t.summaryMemberNo} ${existingTotal + index + 1}`,
			isPrimary: index === 0 && existingTotal === 0 && !existingHeadName,
			isExisting: false
		}))
	]);

	const petCount = $derived(
		(household.pets ?? []).reduce((sum: number, p) => sum + (Number(p.count) || 1), 0)
	);

	const maleCount = $derived(everyone.filter((m) => m.gender === 'male').length);
	const femaleCount = $derived(everyone.filter((m) => m.gender === 'female').length);
	const vulnerableCount = $derived(
		everyone.filter(
			(m) => (m.vulnerable_groups?.length ?? 0) > 0 || (m.special_needs?.length ?? 0) > 0
		).length
	);

	// Whole strings, so the count and its unit render as one text node.
	const shelterCodeText = $derived(`${t.summaryShelterCode} ${shelterCode}`);
	const landmarkText = $derived(`${t.summaryLandmark} ${household.residence_landmark ?? ''}`);
	const memberCountText = $derived(
		`${totalCount} ${totalCount === 1 ? t.summaryPersonUnitOne : t.summaryPersonUnit}`
	);
	const existingNewText = $derived(
		`${t.summaryExisting} ${existingTotal} · ${t.summaryNew} ${members.length}`
	);
	const maleText = $derived(`${t.genderMale} ${maleCount}`);
	const femaleText = $derived(`${t.genderFemale} ${femaleCount}`);
	const careText = $derived(
		`${t.summaryCareGroup} ${vulnerableCount} ${vulnerableCount === 1 ? t.summaryPersonUnitOne : t.summaryPersonUnit}`
	);

	const isAddressReady = $derived(
		Boolean(
			household.province?.trim() && household.district?.trim() && household.subdistrict?.trim()
		)
	);
	const isMembersReady = $derived(Boolean(headMember?.first_name?.trim()));
</script>

<div
	class="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-xs transition-shadow"
>
	<!-- Header -->
	<div class="border-b border-border/60 bg-muted/20 px-4 py-3 sm:px-5">
		<div class="flex items-center justify-between gap-2">
			<span class="text-xs font-bold tracking-wider text-muted-foreground uppercase">
				{t.summaryTitle}
			</span>
			<span
				class="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-2xs font-semibold text-primary"
			>
				Live Summary
			</span>
		</div>
	</div>

	<div class="space-y-4 p-4 sm:p-5">
		<!-- 1. Shelter Info -->
		<div class="space-y-1 rounded-xl border border-border/50 bg-muted/10 p-3">
			<div class="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
				<Building2 class="size-3.5 text-primary" />
				<span>{t.summaryShelter}</span>
			</div>
			{#if shelterName}
				<p class="text-sm font-bold text-foreground">{shelterName}</p>
			{:else if shelterCode}
				<p class="text-sm font-bold text-foreground">{shelterCodeText}</p>
			{:else}
				<p class="text-sm font-bold text-foreground">{t.summaryNoShelter}</p>
				<p class="text-2xs text-muted-foreground">{t.summaryNoShelterHint}</p>
			{/if}
		</div>

		<!-- 2. Address & Residence Info -->
		<div class="space-y-1.5 border-b border-border/50 pb-3.5">
			<div class="flex items-center justify-between gap-2">
				<span class="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
					<Home class="size-3.5 text-primary" />
					<span>{t.summaryResidence}</span>
				</span>
				<button
					type="button"
					onclick={() => onNavigate('address')}
					class="text-2xs font-medium text-primary hover:underline"
				>
					{t.summaryEdit}
				</button>
			</div>
			{#if formattedAddress}
				<p class="text-xs leading-relaxed font-medium text-foreground">
					{formattedAddress}
				</p>
			{:else}
				<p class="text-xs text-muted-foreground italic">{t.summaryNoAddress}</p>
			{/if}
			{#if household.residence_landmark}
				<p class="truncate text-2xs text-muted-foreground">
					{landmarkText}
				</p>
			{/if}
		</div>

		<!-- 3. Members Info -->
		<div class="space-y-2 border-b border-border/50 pb-3.5">
			<div class="flex items-center justify-between gap-2">
				<span class="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
					<Users class="size-3.5 text-primary" />
					<span>{t.summaryMembers}</span>
				</span>
				<span
					class="rounded-full bg-primary/10 px-2 py-0.5 text-2xs font-bold text-primary tabular-nums"
				>
					{memberCountText}
				</span>
			</div>
			{#if existingTotal > 0}
				<p class="text-2xs text-muted-foreground">
					{existingNewText}
				</p>
			{/if}

			<div class="text-xs text-foreground">
				<span class="text-muted-foreground">{t.summaryPrimaryContact} </span>
				<span class="font-semibold">{headFullName || t.summaryNoName}</span>
			</div>

			<ul class="space-y-1.5" aria-label={t.summaryMemberListAria}>
				{#each memberSummaries as member (member.id)}
					<li
						class="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/10 px-2.5 py-1.5 text-xs"
					>
						<span class="min-w-0 truncate font-medium text-foreground">{member.name}</span>
						<span class="flex shrink-0 items-center gap-1">
							{#if member.isExisting}
								<span class="text-2xs text-muted-foreground">{t.summaryExistingTag}</span>
							{/if}
							{#if member.isPrimary}
								<span class="text-2xs font-medium text-primary">{t.summaryPrimaryTag}</span>
							{/if}
						</span>
					</li>
				{/each}
			</ul>

			<div class="flex flex-wrap items-center gap-1.5 text-2xs text-muted-foreground">
				{#if maleCount > 0}
					<span class="rounded-md border border-border bg-muted/40 px-1.5 py-0.5">
						{maleText}
					</span>
				{/if}
				{#if femaleCount > 0}
					<span class="rounded-md border border-border bg-muted/40 px-1.5 py-0.5">
						{femaleText}
					</span>
				{/if}
				{#if vulnerableCount > 0}
					<span
						class="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 font-medium text-amber-800 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-300"
					>
						<ShieldAlert class="size-3" />
						{careText}
					</span>
				{/if}
			</div>
		</div>

		<!-- 4. Pets & Assets Info -->
		<div class="space-y-1.5 border-b border-border/50 pb-3.5">
			<div class="flex items-center justify-between gap-2">
				<span class="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
					<PawPrint class="size-3.5 text-primary" />
					<span>{t.summaryPets}</span>
				</span>
				<span class="text-xs font-medium text-foreground">
					{petCount > 0 ? `${petCount} ${t.summaryPetUnit}`.trim() : t.summaryNone}
				</span>
			</div>

			{#if showVehiclesAssets}
				<div class="flex items-center justify-between gap-2 pt-1">
					<span class="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
						<Package class="size-3.5 text-primary" />
						<span>{t.summaryVehicles}</span>
					</span>
					<span class="text-xs font-medium text-foreground">
						{(household.vehicles ?? []).length > 0
							? `${(household.vehicles ?? []).length} ${t.summaryVehicleUnit}`.trim()
							: t.summaryNone}
					</span>
				</div>
			{/if}
		</div>

		<!-- 5. Quick Jump Nav -->
		<div class="space-y-1.5">
			<span class="text-3xs font-semibold text-muted-foreground uppercase">
				{t.summaryShortcuts}
			</span>
			<div class="grid grid-cols-2 gap-1.5 text-xs">
				<button
					type="button"
					onclick={() => onNavigate('address')}
					class="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 px-2.5 py-1.5 transition-colors hover:bg-muted/50 {activeSection ===
					'address'
						? 'border-primary/40 font-semibold text-primary'
						: 'text-foreground'}"
				>
					<span class="truncate">{t.summaryNavAddress}</span>
					{#if isAddressReady}
						<Check class="size-3 text-emerald-600" />
					{:else}
						<ChevronRight class="size-3 text-muted-foreground" />
					{/if}
				</button>
				<button
					type="button"
					onclick={() => onNavigate('members')}
					class="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 px-2.5 py-1.5 transition-colors hover:bg-muted/50 {activeSection ===
					'members'
						? 'border-primary/40 font-semibold text-primary'
						: 'text-foreground'}"
				>
					<span class="truncate">{t.summaryNavMembers}</span>
					{#if isMembersReady}
						<Check class="size-3 text-emerald-600" />
					{:else}
						<ChevronRight class="size-3 text-muted-foreground" />
					{/if}
				</button>
				<button
					type="button"
					onclick={() => onNavigate('pets')}
					class="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 px-2.5 py-1.5 transition-colors hover:bg-muted/50 {activeSection ===
					'pets'
						? 'border-primary/40 font-semibold text-primary'
						: 'text-foreground'}"
				>
					<span class="truncate">{t.summaryNavPets}</span>
					<ChevronRight class="size-3 text-muted-foreground" />
				</button>
				{#if showVehiclesAssets}
					<button
						type="button"
						onclick={() => onNavigate('vehicles')}
						class="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 px-2.5 py-1.5 transition-colors hover:bg-muted/50 {activeSection ===
						'vehicles'
							? 'border-primary/40 font-semibold text-primary'
							: 'text-foreground'}"
					>
						<span class="truncate">{t.summaryNavVehicles}</span>
						<ChevronRight class="size-3 text-muted-foreground" />
					</button>
				{/if}
			</div>
		</div>

		<!-- 6. Submit Button (Desktop Access) -->
		{#if showSubmit}
			<div class="pt-2">
				<Button
					type="submit"
					disabled={pending || submitDisabled}
					class="h-11 w-full gap-2 rounded-xl text-sm font-semibold shadow-xs"
				>
					{#if pending}
						<Loader2 class="size-4 animate-spin" />
						{submittingLabel || t.submitting}
					{:else}
						{submitLabel || t.submitConfirm}
					{/if}
				</Button>
			</div>
		{/if}
	</div>
</div>
