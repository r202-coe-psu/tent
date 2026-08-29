<script lang="ts">
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import Dog from '@lucide/svelte/icons/dog';
	import Users from '@lucide/svelte/icons/users';
	import {
		resolveMasterLabel,
		useVulnerableGroupLabelMap,
		type PublicShelterDetail
	} from '$lib/features/public-portal';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_SHELTER_DETAILS_I18N } from '$lib/constants/i18n';

	let { shelter }: { shelter: NonNullable<PublicShelterDetail> } = $props();

	let t = $derived(getTranslation(PUBLIC_SHELTER_DETAILS_I18N, langState.current));
	const vulnerableGroupLabels = useVulnerableGroupLabelMap();

	function translatePetCategories(categoriesStr: string): string {
		if (!categoriesStr) return '';
		const map: Record<string, string> = {
			small_general: t.smallGeneral,
			large_dog: t.largeDogs,
			livestock: t.livestock
		};
		return categoriesStr
			.split(',')
			.map((c) => map[c] || c)
			.join(', ');
	}

	let visibleVulnerableGroups = $derived.by(() => {
		const groups = shelter.admission_policy?.vulnerable_groups ?? [];
		const legacy: Record<string, string> = {
			general_vulnerable: t.generalVulnerable,
			quarantine: t.quarantinePatients,
			wheelchair: t.wheelchairUsers,
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
		return groups
			.map((code) => ({
				code,
				label: resolveMasterLabel(code, vulnerableGroupLabels.data, legacy)
			}))
			.filter((g) => g.label);
	});
</script>

<section>
	<div class="mb-4 flex items-center gap-2">
		<CheckCircle2 class="h-5 w-5 text-success-dark" />
		<h2 class="text-lg font-bold text-foreground">{t.admissionPolicy}</h2>
	</div>

	<div class="flex flex-col gap-3">
		<!-- Pets -->
		<div class="flex items-start gap-4 rounded-xl border border-border bg-white p-4 shadow-sm">
			<div
				class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg {shelter
					.admission_policy?.pets === 'not_allowed'
					? 'bg-danger/10 text-danger'
					: 'bg-warning/15 text-warning-dark'}"
			>
				<Dog class="h-5 w-5" />
			</div>
			<div>
				<h3
					class="mb-1 text-sm font-bold {shelter.admission_policy?.pets === 'not_allowed'
						? 'text-danger'
						: 'text-foreground'}"
				>
					{t.petPolicy}
				</h3>
				<p
					class="text-sm {shelter.admission_policy?.pets === 'not_allowed'
						? 'text-danger/80'
						: 'text-muted-foreground'}"
				>
					{#if shelter.admission_policy?.pets === 'not_allowed'}
						{t.notAllowed}
					{:else if shelter.admission_policy?.pets === 'allowed'}
						{t.allowedPetZone}
					{:else if shelter.admission_policy?.pets?.startsWith('conditional')}
						{t.conditionallyAllowed} ({translatePetCategories(
							shelter.admission_policy.pets.split(':')[1]
						)})
					{:else}
						-
					{/if}
				</p>
			</div>
		</div>

		<!-- Vulnerable -->
		<div class="flex items-start gap-4 rounded-xl border border-border bg-white p-4 shadow-sm">
			<div
				class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-purple-muted text-accent-purple"
			>
				<Users class="h-5 w-5" />
			</div>
			<div>
				<h3 class="mb-1 text-sm font-bold text-foreground">{t.supportedVulnerableGroups}</h3>
				{#if visibleVulnerableGroups.length > 0}
					<div class="mt-2 flex flex-wrap gap-2">
						{#each visibleVulnerableGroups as group (group.code)}
							<span
								class="inline-flex items-center rounded-full bg-accent-purple/10 px-2.5 py-0.5 text-xs font-semibold text-accent-purple"
							>
								{group.label}
							</span>
						{/each}
					</div>
					{#if !(shelter.admission_policy?.vulnerable_groups ?? []).includes('bedridden')}
						<p class="mt-2 text-xs text-muted-foreground">
							{t.bedriddenNotExplicitlySupported}
						</p>
					{/if}
				{:else}
					<p class="text-sm text-muted-foreground">-</p>
				{/if}
			</div>
		</div>
	</div>
</section>
