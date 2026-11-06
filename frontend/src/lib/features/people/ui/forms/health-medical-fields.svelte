<script lang="ts">
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as RadioGroup from '$lib/components/ui/radio-group/index.js';
	import { MasterTagInput, resolveMasterCodes, useMasterData } from '$lib/features/master-data';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import type { CareTrack } from '../../domain/people.js';
	import { HEALTH_MEDICAL_FIELDS_I18N } from '../_constants/health-medical-fields.i18n';

	let {
		care_track = $bindable<CareTrack>('normal'),
		conditions = $bindable<string>(''),
		medications = $bindable<string>(''),
		allergies = $bindable<string>(''),
		general_symptoms = $bindable<string>(''),
		disabled = false,
		idPrefix = 'med',
		showGeneralSymptoms = true
	}: {
		care_track?: CareTrack;
		conditions?: string;
		medications?: string;
		allergies?: string;
		general_symptoms?: string;
		disabled?: boolean;
		idPrefix?: string;
		showGeneralSymptoms?: boolean;
	} = $props();

	const t = $derived(getTranslation(HEALTH_MEDICAL_FIELDS_I18N, langState.current));

	// CR-186 / #648 — โรคประจำตัว and ประวัติการแพ้ pick from masters `chronic_disease` /
	// `allergy`; both stay comma-separated strings of codes / free text so parents
	// keep their split(',').
	// Parents still map legacy labels on save (FR-7) — this getter only shows them.
	const chronicDiseaseQuery = useMasterData(() => 'chronic_disease');
	const chronicDiseaseItems = $derived(chronicDiseaseQuery.data?.items ?? []);
	const allergyQuery = useMasterData(() => 'allergy');
	const allergyItems = $derived(allergyQuery.data?.items ?? []);

	function getConditionTokens(): string[] {
		return resolveMasterCodes(conditions.split(','), chronicDiseaseItems);
	}

	function setConditionTokens(tokens: string[]) {
		conditions = tokens.join(', ');
	}

	function getAllergyTokens(): string[] {
		return resolveMasterCodes(allergies.split(','), allergyItems);
	}

	function setAllergyTokens(tokens: string[]) {
		allergies = tokens.join(', ');
	}

	const careTrackOptions: { value: CareTrack; label: string; desc: string }[] = $derived([
		{ value: 'normal', label: t.careTrackNormalLabel, desc: t.careTrackNormalDesc },
		{ value: 'fast_track', label: t.careTrackFastLabel, desc: t.careTrackFastDesc }
	]);
</script>

<div class="space-y-5">
	<div class="space-y-1.5">
		<Label class="text-xs font-semibold text-foreground">{t.careTrackLabel}</Label>
		<RadioGroup.Root
			value={care_track}
			onValueChange={(v) => {
				if (v === 'normal' || v === 'fast_track') care_track = v;
			}}
			{disabled}
			class="grid grid-cols-1 gap-2.5 sm:grid-cols-2"
		>
			{#each careTrackOptions as opt (opt.value)}
				{@const selected = care_track === opt.value}
				<label
					for="{idPrefix}-care-track-{opt.value}"
					class="flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-all {selected
						? 'border-primary bg-primary/5 shadow-xs ring-1 ring-primary'
						: 'border-border bg-card hover:bg-muted/30'} {disabled
						? 'pointer-events-none opacity-60'
						: ''}"
				>
					<RadioGroup.Item
						value={opt.value}
						id="{idPrefix}-care-track-{opt.value}"
						class="mt-0.5"
					/>
					<div class="min-w-0 space-y-0.5 break-words">
						<span class="block text-xs font-semibold text-foreground">{opt.label}</span>
						<span class="block text-xs text-muted-foreground">{opt.desc}</span>
					</div>
				</label>
			{/each}
		</RadioGroup.Root>
	</div>

	<!-- โรคประจำตัว gets a full-width row so its tags flow on one line (CR-186). -->
	<div class="space-y-1.5">
		<Label for="{idPrefix}-conditions" class="text-xs font-medium text-foreground">
			{t.conditionsLabel}
		</Label>
		<MasterTagInput
			id="{idPrefix}-conditions"
			bind:value={getConditionTokens, setConditionTokens}
			items={chronicDiseaseItems}
			{disabled}
			placeholder={t.conditionsPlaceholder}
			searchPlaceholder={t.conditionsSearch}
			listLabel={t.conditionsListLabel}
		/>
	</div>

	<div class="space-y-1.5">
		<Label for="{idPrefix}-medications" class="text-xs font-medium text-foreground">
			{t.medicationsLabel}
		</Label>
		<Textarea
			id="{idPrefix}-medications"
			bind:value={medications}
			{disabled}
			rows={3}
			placeholder={t.medicationsPlaceholder}
			class="text-xs"
		/>
	</div>

	<!-- ประวัติการแพ้ gets its own full-width row like โรคประจำตัว (#648). -->
	<div class="space-y-1.5">
		<Label for="{idPrefix}-allergies" class="text-xs font-medium text-foreground">
			{t.allergiesLabel}
		</Label>
		<MasterTagInput
			id="{idPrefix}-allergies"
			bind:value={getAllergyTokens, setAllergyTokens}
			items={allergyItems}
			{disabled}
			placeholder={t.allergiesPlaceholder}
			searchPlaceholder={t.allergiesSearch}
		/>
	</div>

	{#if showGeneralSymptoms}
		<div class="space-y-1.5">
			<Label for="{idPrefix}-general-symptoms" class="text-xs font-medium text-foreground">
				{t.generalSymptomsLabel}
			</Label>
			<Textarea
				id="{idPrefix}-general-symptoms"
				bind:value={general_symptoms}
				{disabled}
				rows={3}
				placeholder={t.generalSymptomsPlaceholder}
				class="text-xs"
			/>
		</div>
	{/if}
</div>
