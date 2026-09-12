<script lang="ts">
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Eye from '@lucide/svelte/icons/eye';
	import Navigation from '@lucide/svelte/icons/navigation';
	import Users from '@lucide/svelte/icons/users';
	import HeartPulse from '@lucide/svelte/icons/heart-pulse';
	import PawPrint from '@lucide/svelte/icons/paw-print';
	import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';

	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';

	import type { PublicShelterCardModel } from '../domain/types';
	import { resolveMasterLabel } from '../domain/master-labels';
	import { useShelterTypeLabelMap, useVulnerableGroupLabelMap } from '../application/queries';

	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_SHELTER_CARD_I18N } from '$lib/constants/i18n';
	import { langState } from '$lib/states/i18n.svelte';

	let {
		shelter,
		getStatusColor,
		getStatusText,
		isSelected = false,
		onSelect,
		onPreRegister
	}: {
		shelter: PublicShelterCardModel;
		getStatusColor: (status: string) => string;
		getStatusText: (status: string) => string;
		/** Whether this shelter is currently selected */
		isSelected?: boolean;
		/** Callback when this card is clicked to select/focus */
		onSelect?: () => void;
		/** Opens booking with this shelter locked. Omit on surfaces that do not book. */
		onPreRegister?: (shelterCode: string) => void;
	} = $props();

	let t = $derived(getTranslation(PUBLIC_SHELTER_CARD_I18N, langState.current));

	let canBook = $derived(Boolean(shelter.code) && shelter.status !== 'CLOSED');

	const shelterTypeLabels = useShelterTypeLabelMap();
	const vulnerableGroupLabels = useVulnerableGroupLabelMap();

	function adminTypeLabel(type: string): string {
		const legacyEn: Record<string, string> =
			langState.current === 'en'
				? {
						วัด: 'Temple',
						โรงเรียน: 'School',
						ศาลาประชาคม: 'Community Hall',
						ศูนย์กีฬา: 'Sports Centre',
						อาคารราชการ: 'Government Building',
						หน่วยงานราชการ: 'Government Agency',
						ศูนย์อพยพ: 'Evacuation Center',
						มหาวิทยาลัย: 'University',
						มัสยิด: 'Mosque',
						โบสถ์: 'Church',
						พื้นที่เอกชน: 'Private Area',
						อื่นๆ: 'Other',
						unspecified: 'Unspecified'
					}
				: { unspecified: '' };
		return resolveMasterLabel(type, shelterTypeLabels.data, legacyEn);
	}

	function vulnerableGroupLabel(group: string): string {
		const legacy: Record<string, string> = {
			general_vulnerable: t.generalVulnerable,
			quarantine: t.quarantine,
			wheelchair: t.wheelchair,
			none: t.noSpecificZone
		};
		if (langState.current === 'en') {
			Object.assign(legacy, {
				ผู้ป่วยติดเตียง: 'Bedridden Patient',
				ผู้ใช้วีลแชร์: 'Wheelchair User',
				เด็กอ่อน: 'Infant/Baby',
				ผู้สูงอายุ: 'Elderly',
				สตรีมีครรภ์: 'Pregnant Women',
				ผู้พิการ: 'Disabled Person',
				ผู้ป่วยจิตเวช: 'Psychiatric Patient',
				ผู้ป่วยแยกกักโรค: 'Quarantine Patient'
			});
		}
		return resolveMasterLabel(group, vulnerableGroupLabels.data, legacy);
	}

	function translatePetPolicy(policyStr: string | undefined): string {
		if (!policyStr) return '-';
		if (policyStr === 'not_allowed' || policyStr === 'ไม่อนุญาต') return t.notAllowed;
		if (policyStr === 'allowed' || policyStr === 'อนุญาต') return t.allowed;
		if (policyStr.startsWith('conditional:')) {
			const categories = policyStr.split(':')[1];
			const map: Record<string, string> = {
				small_general: t.smallGeneral,
				large_dog: t.largeDog,
				livestock: t.livestock
			};
			const translated = categories
				.split(',')
				.map((c) => map[c] || c)
				.join(', ');
			return `${t.conditionalAllowed} (${translated})`;
		}
		return policyStr;
	}

	let visibleVulnerableGroups = $derived(
		(Array.isArray(shelter.vulnerable_groups) ? shelter.vulnerable_groups : [])
			.filter((g) => g && g !== 'none' && g !== 'ไม่มีโซนเฉพาะ')
			.map((g) => ({ code: g, label: vulnerableGroupLabel(g) }))
			.filter((g) => g.label)
	);

	let adminTypeDisplay = $derived(
		shelter.admin_type && shelter.admin_type !== 'unspecified'
			? adminTypeLabel(shelter.admin_type)
			: ''
	);

	let hasLocationParts = $derived(
		Boolean(shelter.subdistrict || shelter.district || shelter.province)
	);
</script>

<Card.Root
	class="flex cursor-pointer flex-col gap-2! rounded-2xl border-border p-5 shadow-sm transition-all hover:border-primary/50 hover:bg-muted/10 hover:shadow-md {isSelected
		? 'border-primary bg-primary/5 shadow-md ring-2 ring-primary/40'
		: ''}"
	onclick={(e: MouseEvent) => {
		const target = e.target as HTMLElement | null;
		if (target && target.closest('button, a')) return;
		onSelect?.();
	}}
>
	<!-- Title and Status -->
	<div class="flex items-start justify-between gap-2">
		<div>
			{#if isSelected}
				<div class="mb-1.5 flex items-center gap-1.5">
					<Badge
						variant="default"
						class="h-5 bg-primary px-2 text-2xs font-bold text-primary-foreground shadow-xs"
					>
						✓ {t.selectedShelter}
					</Badge>
				</div>
			{/if}
			<h4 class="line-clamp-2 text-lg leading-tight font-bold text-foreground transition-colors">
				{shelter.name}
			</h4>

			{#if adminTypeDisplay}
				<div class="mt-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
					<span class="h-1.5 w-1.5 rounded-full bg-primary/40"></span>
					{adminTypeDisplay}
				</div>
			{/if}
			<div class="mt-1 text-xs font-semibold text-primary">
				{shelter.site_kind === 'host_house' ? t.hostHouse : t.evacCenter}
			</div>
		</div>
		<span
			class="shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-bold {getStatusColor(
				shelter.status
			)}"
		>
			<span class="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-current"></span>{getStatusText(
				shelter.status
			)}
		</span>
	</div>

	<!-- Address (when location parts exist; otherwise code is shown with distance below) -->
	{#if hasLocationParts}
		<div class="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground">
			<MapPin class="mt-0.5 h-4 w-4 shrink-0 text-primary/70" />
			<span class="leading-relaxed"
				>{shelter.address || '-'}{#if shelter.district}
					{t.districtPrefix}{shelter.district}{/if}{#if shelter.province}, {t.provincePrefix}{shelter.province}{/if}
			</span>
		</div>
	{/if}

	<!-- Shelter code + distance (same row) -->
	<div
		class="mt-1 flex flex-row flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground"
	>
		{#if shelter.code}
			<span class="font-semibold text-primary">{shelter.code}</span>
		{/if}
		<div class="flex items-center gap-1.5">
			<Navigation class="h-3.5 w-3.5 opacity-70" />
			{t.distance}
			{#if shelter.distance !== undefined && shelter.distance !== null && !isNaN(shelter.distance) && shelter.distance > 0}
				<span class="font-bold text-foreground">{shelter.distance} {t.km}</span>
			{:else}
				<span class="font-medium text-muted-foreground/70">-</span>
			{/if}
		</div>
	</div>

	<div class="mt-2 flex flex-col gap-2 rounded-xl bg-muted/40 p-3 ring-1 ring-border/50">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
				<Users class="h-4 w-4" />
				{t.maxCapacity}
			</div>
			<div class="font-bold text-foreground">
				<span class="text-base">{shelter.capacity ?? 0}</span>
				<span class="ml-0.5 text-xs font-bold text-muted-foreground">{t.people}</span>
			</div>
		</div>
		{#if shelter.pet_policy || visibleVulnerableGroups.length > 0}
			<div class="flex flex-col gap-2 border-t border-border/60 pt-2.5">
				{#if visibleVulnerableGroups.length > 0}
					<div class="flex flex-col gap-1.5">
						<div class="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
							<HeartPulse class="h-3.5 w-3.5" />
							{t.vulnerableGroups}
						</div>
						<div class="flex flex-wrap gap-1">
							{#each visibleVulnerableGroups as group (group.code)}
								<Badge
									variant="secondary"
									class="h-auto min-h-5 border-primary/10 bg-primary/5 py-1 text-left text-xs leading-tight whitespace-normal text-foreground hover:bg-primary/10"
								>
									{group.label}
								</Badge>
							{/each}
						</div>
					</div>
				{/if}

				{#if shelter.pet_policy}
					<div class="flex flex-col gap-1.5 {visibleVulnerableGroups.length > 0 ? 'mt-1' : ''}">
						<div class="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
							<PawPrint class="h-3.5 w-3.5" />
							{t.petPolicy}
						</div>
						<div class="flex flex-wrap">
							<Badge
								variant="outline"
								class="h-auto min-h-5 py-1 text-left text-xs leading-tight whitespace-normal {shelter.pet_policy ===
									'not_allowed' || shelter.pet_policy.includes('ไม่')
									? 'border-danger/30 bg-danger/5 text-danger'
									: 'border-success/30 bg-success/5 text-success-dark'}"
							>
								{translatePetPolicy(shelter.pet_policy)}
							</Badge>
						</div>
					</div>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Actions -->
	<div class="mt-auto flex flex-col gap-2 pt-2">
		{#if onPreRegister}
			<Button
				type="button"
				size="sm"
				disabled={!canBook}
				title={canBook ? undefined : t.preRegisterClosed}
				class="h-9 w-full rounded-xl bg-primary text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 {isSelected
					? 'shadow-sm ring-2 ring-primary/40'
					: ''}"
				onclick={() => {
					if (canBook) onPreRegister(shelter.code);
				}}
			>
				<ClipboardCheck class="mr-1.5 h-3.5 w-3.5" />
				{t.preRegister}
			</Button>
		{/if}
		<div class="flex gap-2">
			<Button
				href={`/shelters/${shelter.id}`}
				variant="outline"
				size="sm"
				class="h-9 flex-1 rounded-xl border-border text-sm font-bold text-foreground hover:bg-muted"
			>
				<Eye class="mr-1.5 h-3.5 w-3.5" />
				{t.viewDetails}
			</Button>
			<Button
				href={shelter.geo?.lat != null && shelter.geo?.lng != null
					? `https://www.google.com/maps/dir/?api=1&destination=${shelter.geo.lat},${shelter.geo.lng}`
					: undefined}
				target={shelter.geo?.lat != null && shelter.geo?.lng != null ? '_blank' : null}
				rel={shelter.geo?.lat != null && shelter.geo?.lng != null ? 'noopener noreferrer' : null}
				disabled={shelter.geo?.lat == null || shelter.geo?.lng == null}
				size="sm"
				class="h-9 flex-1 rounded-xl bg-primary-dark text-sm font-bold text-primary-foreground hover:bg-primary disabled:opacity-50"
			>
				<Navigation class="mr-1.5 h-3.5 w-3.5" />
				{t.navigate}
			</Button>
		</div>
	</div>
</Card.Root>
