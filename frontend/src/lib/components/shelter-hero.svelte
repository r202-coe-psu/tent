<script lang="ts">
	import MapPin from '@lucide/svelte/icons/map-pin';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import Navigation from '@lucide/svelte/icons/navigation';
	import Button from '$lib/components/ui/button/button.svelte';
	import {
		resolveMasterLabel,
		useShelterTypeLabelMap,
		type PublicShelterDetail
	} from '$lib/features/public-portal';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_SHELTER_DETAILS_I18N } from '$lib/constants/i18n';

	let { shelter }: { shelter: NonNullable<PublicShelterDetail> } = $props();

	let t = $derived(getTranslation(PUBLIC_SHELTER_DETAILS_I18N, langState.current));
	const shelterTypeLabels = useShelterTypeLabelMap();

	let adminTypeDisplay = $derived.by(() => {
		const code = shelter.admin_type;
		if (!code || code === 'unspecified') return '';
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
				: {};
		return resolveMasterLabel(code, shelterTypeLabels.data, legacyEn);
	});
</script>

<!-- Hero Card -->
<div class="relative mb-8 overflow-hidden rounded-2xl bg-primary-dark text-white shadow-sm">
	<div
		class="absolute inset-0 bg-[radial-gradient(#fff_1px,transparent_1px)] [background-size:20px_20px] opacity-10"
	></div>

	<div class="relative p-6 md:p-10">
		<!-- Status Pill -->
		<div
			class="mb-5 inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/20 px-3 py-1 text-xs font-bold text-success-subtle"
		>
			<span class="relative flex h-2 w-2">
				<span
					class="absolute inline-flex h-full w-full animate-ping rounded-full bg-success-subtle opacity-75"
				></span>
				<span class="relative inline-flex h-2 w-2 rounded-full bg-success"></span>
			</span>
			{shelter.status === 'OPEN' ? t.openAdmission : shelter.status || '-'}
		</div>

		<!-- Title & Subtitle -->
		<h1 class="mb-3 text-3xl font-bold tracking-tight md:text-4xl">
			{shelter.name || t.unnamedShelter}
		</h1>
		<div class="mb-10 flex flex-wrap items-center gap-3 text-sm text-muted-foreground/60">
			<div class="flex items-center gap-1.5 text-accent">
				<MapPin class="h-4 w-4 text-warning" />
				{shelter.address || t.addressNotSpecified}
			</div>
			{#if adminTypeDisplay}
				<span
					class="rounded-full border border-white/20 bg-white/10 px-2.5 py-0.5 text-xs font-semibold text-white/90"
				>
					{adminTypeDisplay}
				</span>
			{/if}
		</div>

		<!-- Stats Grid -->
		<div
			class="flex flex-col justify-between gap-6 border-t border-white/10 pt-6 md:flex-row md:items-end"
		>
			<div class="grid grid-cols-2 gap-8 md:flex">
				<div>
					<div class="mb-1 text-xs font-semibold text-secondary/80">{t.capacityLabel}</div>
					<div class="flex items-baseline gap-1.5">
						<span class="text-3xl font-bold text-success-subtle"
							>{shelter.capacity?.available ?? '-'}</span
						>
						<span class="text-xl font-medium text-secondary">/</span>
						<span class="text-xl font-bold text-white">{shelter.capacity?.total ?? '-'}</span>
						<span class="text-sm font-medium text-secondary/80">{t.people}</span>
					</div>
				</div>

				<div>
					<div class="mb-1 text-xs font-semibold text-secondary/80">{t.occupancyRate}</div>
					<div class="text-3xl font-bold text-white">{shelter.occupancy_rate ?? '-'}%</div>
				</div>

				<div class="col-span-2 items-center justify-around md:col-span-1 md:space-y-2">
					<div class="text-xs font-semibold text-secondary/80">{t.buildingStatus}</div>
					<div class="flex items-end gap-2 self-end text-xl font-bold text-white">
						<CheckCircle2 class="h-5 w-5 text-warning-subtle" />
						{#if shelter.building_status === 'indoor'}
							{t.indoor}
						{:else if shelter.building_status === 'outdoor'}
							{t.outdoor}
						{:else if shelter.building_status === 'hybrid'}
							{t.hybrid}
						{:else}
							{t.unspecified}
						{/if}
					</div>
				</div>
			</div>

			{#if shelter.geo?.lat && shelter.geo?.lng}
				<Button
					onclick={() =>
						window.open(
							`https://www.google.com/maps/dir/?api=1&destination=${shelter.geo?.lat},${shelter.geo?.lng}`,
							'_blank'
						)}
					target="_blank"
					class="flex w-fit items-center gap-2 rounded-xl bg-warning px-6 py-3.5 text-sm font-bold text-warning-foreground shadow-lg transition-colors hover:bg-warning-subtle"
				>
					<Navigation class="h-4.5 w-4.5" />
					{t.navigateMaps}
				</Button>
			{/if}
		</div>
	</div>
</div>
