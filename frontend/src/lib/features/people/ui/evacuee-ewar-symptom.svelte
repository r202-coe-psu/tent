<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import HeartPulse from '@lucide/svelte/icons/heart-pulse';
	import Stethoscope from '@lucide/svelte/icons/stethoscope';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Check from '@lucide/svelte/icons/check';
	import {
		EWAR_SYMPTOM_GROUPS,
		migrateVulnerableGroupCodes,
		type EvacueeInput
	} from '../domain/people';
	import type { SvelteSet } from 'svelte/reactivity';
	import { toast } from 'svelte-sonner';
	import { getTranslation } from '$lib/utils/i18n';
	import { languageStore } from '$lib/stores/language.svelte';
	import { EVACUEE_EWAR_I18N } from './_constants/evacuee-ewar.i18n';
	import { EVACUEE_REGISTRATION_I18N } from './_constants/evacuee-registration.i18n';
	import { useMasterData } from '$lib/features/master-data';
	import { useShelter } from '$lib/features/shelters';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { getShelterCode } from '$lib/db/shelter';

	export type ScreeningDraft = Pick<
		EvacueeInput,
		| 'medical_conditions'
		| 'medical_medications'
		| 'medical_allergies'
		| 'vulnerable_groups'
		| 'special_needs'
		| 'medical_note'
	>;

	let {
		onNext,
		onBack,
		selectedSymptoms,
		isHealthy = $bindable(false),
		screeningDraft = $bindable({
			medical_conditions: [],
			medical_medications: [],
			medical_allergies: [],
			vulnerable_groups: [],
			special_needs: [],
			medical_note: ''
		})
	}: {
		onNext: () => void;
		onBack: () => void;
		selectedSymptoms: SvelteSet<string>;
		isHealthy: boolean;
		screeningDraft?: ScreeningDraft;
	} = $props();

	const t = $derived(getTranslation(EVACUEE_EWAR_I18N, languageStore.current));
	const regT = $derived(getTranslation(EVACUEE_REGISTRATION_I18N, languageStore.current));

	const shelterQuery = useShelter(() => shelterStore.selectedShelterCode ?? getShelterCode());
	const vulnerableGroupQuery = useMasterData(() => 'vulnerable_group');

	const specialNeedChipOptions = $derived.by(() => {
		if (!vulnerableGroupQuery.isSuccess) return [];
		const supported = migrateVulnerableGroupCodes(
			shelterQuery.data?.admission_policy?.supported_vulnerable_groups ?? []
		);
		const masterByCode = new Map(
			vulnerableGroupQuery.data.items
				.filter((item) => item.status === 'active')
				.map((item) => [item.code, item])
		);
		return supported
			.filter((code) => masterByCode.has(code))
			.map((code) => ({ code, label: masterByCode.get(code)!.label }));
	});

	let medicalConditionsStr = $state(screeningDraft.medical_conditions?.join(', ') ?? '');
	let medicalMedicationsStr = $state(screeningDraft.medical_medications?.join(', ') ?? '');
	let medicalAllergiesStr = $state(screeningDraft.medical_allergies?.join(', ') ?? '');
	let hasNoConditions = $state(false);
	let hasNoMedications = $state(false);
	let hasNoAllergies = $state(false);
	let hasNoVulnerableGroup = $state(false);

	const isMedicalSectionComplete = $derived(
		(hasNoConditions || (screeningDraft.medical_conditions?.length ?? 0) > 0) &&
			(hasNoMedications || (screeningDraft.medical_medications?.length ?? 0) > 0) &&
			(hasNoAllergies || (screeningDraft.medical_allergies?.length ?? 0) > 0)
	);

	const isVulnerableGroupComplete = $derived(
		hasNoVulnerableGroup || (screeningDraft.vulnerable_groups?.length ?? 0) > 0
	);

	function parseMedicalList(value: string) {
		return value
			.split(',')
			.map((item) => item.trim())
			.filter(Boolean);
	}

	function toggleSymptom(id: string) {
		if (isHealthy) return;
		if (selectedSymptoms.has(id)) {
			selectedSymptoms.delete(id);
		} else {
			selectedSymptoms.add(id);
		}
	}

	function toggleHealthy() {
		const wasHealthy = isHealthy;
		isHealthy = !isHealthy;
		if (isHealthy) {
			selectedSymptoms.clear();
			if (!wasHealthy) scrollToSection('medical');
		}
	}

	function toggleNoConditions() {
		hasNoConditions = !hasNoConditions;
		if (hasNoConditions) {
			medicalConditionsStr = '';
			screeningDraft.medical_conditions = [];
		}
	}

	function toggleNoMedications() {
		hasNoMedications = !hasNoMedications;
		if (hasNoMedications) {
			medicalMedicationsStr = '';
			screeningDraft.medical_medications = [];
		}
	}

	function toggleNoAllergies() {
		hasNoAllergies = !hasNoAllergies;
		if (hasNoAllergies) {
			medicalAllergiesStr = '';
			screeningDraft.medical_allergies = [];
		}
	}

	function toggleNoVulnerableGroup() {
		hasNoVulnerableGroup = !hasNoVulnerableGroup;
		if (hasNoVulnerableGroup) {
			screeningDraft.vulnerable_groups = [];
		}
	}

	function toggleVulnerableGroup(need: NonNullable<EvacueeInput['vulnerable_groups']>[number]) {
		hasNoVulnerableGroup = false;
		const current = screeningDraft.vulnerable_groups ?? [];
		const checked = current.includes(need);
		screeningDraft.vulnerable_groups = checked
			? current.filter((n) => n !== need)
			: [...current, need];
	}

	function updateMedicalField(field: 'conditions' | 'medications' | 'allergies', value: string) {
		const parsed = parseMedicalList(value);
		if (field === 'conditions') {
			hasNoConditions = false;
			medicalConditionsStr = value;
			screeningDraft.medical_conditions = parsed;
		} else if (field === 'medications') {
			hasNoMedications = false;
			medicalMedicationsStr = value;
			screeningDraft.medical_medications = parsed;
		} else {
			hasNoAllergies = false;
			medicalAllergiesStr = value;
			screeningDraft.medical_allergies = parsed;
		}
	}

	const NON_ISOLATION_SYMPTOMS = new Set(['trauma', 'chemical_poisoning', 'tetanus']);

	const needsIsolation = $derived(
		!isHealthy && [...selectedSymptoms].some((id) => !NON_ISOLATION_SYMPTOMS.has(id))
	);

	const hasSymptomsSelected = $derived(!isHealthy && selectedSymptoms.size > 0);

	type FormSectionId = 'ewar' | 'medical' | 'special';

	const formSectionNav = $derived([
		{ id: 'ewar' as const, label: regT.sections.ewar, icon: Stethoscope },
		{ id: 'medical' as const, label: regT.sections.medical, icon: HeartPulse },
		{ id: 'special' as const, label: regT.sections.special, icon: ShieldAlert }
	]);

	let activeSection = $state<FormSectionId>('ewar');
	let scrollSpyPaused = $state(false);

	function findScrollParent(element: Element): Element | null {
		let parent = element.parentElement;
		while (parent) {
			const { overflowY } = getComputedStyle(parent);
			if (overflowY === 'auto' || overflowY === 'scroll') return parent;
			parent = parent.parentElement;
		}
		return null;
	}

	function createScrollSpy(): import('svelte/attachments').Attachment {
		return (node) => {
			const sectionIds: FormSectionId[] = ['ewar', 'medical', 'special'];
			const sectionNodes = () =>
				sectionIds
					.map((id) => document.getElementById(`screen-section-${id}`))
					.filter((el): el is HTMLElement => el instanceof HTMLElement);

			const scrollRoot = findScrollParent(node);
			const observer = new IntersectionObserver(
				(entries) => {
					if (scrollSpyPaused) return;
					const visible = entries
						.filter((entry) => entry.isIntersecting)
						.sort((a, b) => b.intersectionRatio - a.intersectionRatio);
					const target = visible[0]?.target;
					if (!(target instanceof HTMLElement) || !target.id.startsWith('screen-section-')) return;
					activeSection = target.id.replace('screen-section-', '') as FormSectionId;
				},
				{
					root: scrollRoot,
					rootMargin: '-72px 0px -55% 0px',
					threshold: [0, 0.1, 0.25, 0.5, 0.75, 1]
				}
			);

			for (const el of sectionNodes()) observer.observe(el);

			return () => observer.disconnect();
		};
	}

	function scrollToSection(sectionId: FormSectionId) {
		scrollSpyPaused = true;
		activeSection = sectionId;
		document.getElementById(`screen-section-${sectionId}`)?.scrollIntoView({
			behavior: 'smooth',
			block: 'start'
		});
		window.setTimeout(() => {
			scrollSpyPaused = false;
		}, 700);
	}

	function handleNext() {
		if (!isHealthy && selectedSymptoms.size === 0) {
			toast.error(t.toastSelectRequired);
			return;
		}
		if (!isMedicalSectionComplete) {
			toast.error(t.toastMedicalRequired);
			return;
		}
		if (!isVulnerableGroupComplete) {
			toast.error(t.toastSpecialRequired);
			return;
		}
		onNext();
	}
</script>

<div class="space-y-6">
	<nav class="sticky-section-nav" aria-label="ส่วนของการคัดกรอง">
		{#each formSectionNav as section (section.id)}
			<button
				type="button"
				class="touch-target shrink-0 rounded-full border px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors {activeSection ===
				section.id
					? 'border-primary bg-primary-muted text-foreground'
					: 'border-border bg-card text-muted-foreground hover:border-primary/40'}"
				aria-current={activeSection === section.id ? 'location' : undefined}
				onclick={() => scrollToSection(section.id)}
			>
				<section.icon class="mr-1.5 inline size-4" />
				{section.label}
			</button>
		{/each}
	</nav>

	<div class="space-y-6" {@attach createScrollSpy()}>
		<section id="screen-section-ewar" class="form-section-card scroll-mt-20 space-y-5">
			<header class="flex items-center gap-2 border-b border-border/60 pb-3">
				<Stethoscope class="size-5 text-primary" />
				<h2 class="text-base font-bold text-foreground">
					{regT.sections.ewar}<span class="text-destructive" aria-hidden="true"> *</span>
				</h2>
			</header>

			{#if needsIsolation}
				<div
					class="flex animate-in items-center gap-3 rounded-xl border border-red-600 bg-red-600 p-4 text-white shadow-lg duration-300 fade-in slide-in-from-top-2"
					role="alert"
				>
					<ShieldAlert class="size-7 shrink-0" aria-hidden="true" />
					<div>
						<p class="text-base leading-snug font-bold">
							{t.isolationTitle} <span class="font-extrabold">{t.isolationBadge}</span>
						</p>
						<p class="mt-0.5 text-sm font-medium opacity-90">
							{t.isolationDesc}
						</p>
					</div>
				</div>
			{/if}

			<button
				type="button"
				role="checkbox"
				aria-checked={isHealthy}
				onclick={toggleHealthy}
				class="touch-target flex min-h-12 w-full items-center gap-3 rounded-xl border-2 px-4 py-3 text-left text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none {isHealthy
					? 'border-green-500 bg-green-50 text-green-800 dark:bg-green-950/30 dark:text-green-300'
					: 'border-border bg-muted/30 text-muted-foreground hover:border-green-400 hover:bg-green-50/50'}"
			>
				<span
					class="flex size-5 shrink-0 items-center justify-center rounded border {isHealthy
						? 'border-green-600 bg-green-600 text-white'
						: 'border-muted-foreground/50 bg-background'}"
					aria-hidden="true"
				>
					{#if isHealthy}<Check class="size-3.5" />{/if}
				</span>
				<span class="leading-snug">
					{t.healthyLabel}<span class="text-destructive" aria-hidden="true"> *</span>
				</span>
			</button>

			{#each EWAR_SYMPTOM_GROUPS as group (group.title)}
				{@const selectedInGroup = group.symptoms.filter((symptom) =>
					selectedSymptoms.has(symptom.id)
				).length}
				<div class="overflow-hidden rounded-xl border border-border bg-background">
					<div
						class="flex items-center justify-between gap-3 border-b border-border/60 bg-muted/20 px-4 py-2.5"
					>
						<p class="text-sm font-semibold text-foreground">{group.title}</p>
						{#if selectedInGroup > 0}
							<span class="text-xs font-medium text-primary">
								{selectedInGroup}/{group.symptoms.length}
							</span>
						{/if}
					</div>
					<div class="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2">
						{#each group.symptoms as symptom (symptom.id)}
							{@const checked = selectedSymptoms.has(symptom.id)}
							<button
								type="button"
								role="checkbox"
								aria-checked={checked}
								aria-label={symptom.label}
								disabled={isHealthy}
								onclick={() => toggleSymptom(symptom.id)}
								class="touch-target flex min-h-12 items-start gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40 {checked
									? 'border-primary bg-primary/10 text-foreground'
									: 'border-border bg-background text-muted-foreground hover:border-primary/50 hover:bg-primary/5'}"
							>
								<span
									class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border {checked
										? 'border-primary bg-primary text-primary-foreground'
										: 'border-muted-foreground/50 bg-background'}"
									aria-hidden="true"
								>
									{#if checked}<Check class="size-3.5" />{/if}
								</span>
								<span class="flex min-w-0 items-start gap-2">
									<span class="text-base leading-none">{symptom.emoji}</span>
									<span class="leading-snug">{symptom.label}</span>
								</span>
							</button>
						{/each}
					</div>
				</div>
			{/each}
		</section>

		<section id="screen-section-medical" class="form-section-card scroll-mt-20 space-y-5">
			<header class="flex items-center gap-2 border-b border-border/60 pb-3">
				<HeartPulse class="size-5 text-primary" />
				<h2 class="text-base font-bold text-foreground">{regT.sections.medical}</h2>
			</header>

			<div class="space-y-2">
				<div class="flex items-center justify-between gap-3">
					<Label class="text-base sm:text-sm">
						{regT.medical.conditions.label}<span class="text-destructive" aria-hidden="true">
							*</span
						>
					</Label>
					<Button
						type="button"
						variant="outline"
						size="sm"
						aria-pressed={hasNoConditions}
						onclick={toggleNoConditions}
						class="touch-target h-9 shrink-0 px-3 text-sm font-medium {hasNoConditions
							? 'border-green-500 bg-green-50 text-green-700 hover:bg-green-100 hover:text-green-800 dark:bg-green-950/30 dark:text-green-400'
							: ''}"
					>
						{regT.medical.fieldNoneLabel}
					</Button>
				</div>
				<Input
					class="form-control-touch"
					placeholder={regT.medical.conditions.placeholder}
					disabled={hasNoConditions}
					value={medicalConditionsStr}
					oninput={(event) => updateMedicalField('conditions', event.currentTarget.value)}
				/>
			</div>

			<div class="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-4">
				<div class="space-y-2">
					<div class="flex items-center justify-between gap-3">
						<Label class="text-base sm:text-sm">
							{regT.medical.medications.label}<span class="text-destructive" aria-hidden="true">
								*</span
							>
						</Label>
						<Button
							type="button"
							variant="outline"
							size="sm"
							aria-pressed={hasNoMedications}
							onclick={toggleNoMedications}
							class="touch-target h-9 shrink-0 px-3 text-sm font-medium {hasNoMedications
								? 'border-green-500 bg-green-50 text-green-700 hover:bg-green-100 hover:text-green-800 dark:bg-green-950/30 dark:text-green-400'
								: ''}"
						>
							{regT.medical.fieldNoneLabel}
						</Button>
					</div>
					<Input
						class="form-control-touch"
						placeholder={regT.medical.medications.placeholder}
						disabled={hasNoMedications}
						value={medicalMedicationsStr}
						oninput={(event) => updateMedicalField('medications', event.currentTarget.value)}
					/>
				</div>

				<div class="space-y-2">
					<div class="flex items-center justify-between gap-3">
						<Label class="text-base sm:text-sm">
							{regT.medical.allergies.label}<span class="text-destructive" aria-hidden="true">
								*</span
							>
						</Label>
						<Button
							type="button"
							variant="outline"
							size="sm"
							aria-pressed={hasNoAllergies}
							onclick={toggleNoAllergies}
							class="touch-target h-9 shrink-0 px-3 text-sm font-medium {hasNoAllergies
								? 'border-green-500 bg-green-50 text-green-700 hover:bg-green-100 hover:text-green-800 dark:bg-green-950/30 dark:text-green-400'
								: ''}"
						>
							{regT.medical.fieldNoneLabel}
						</Button>
					</div>
					<Input
						class="form-control-touch"
						placeholder={regT.medical.allergies.placeholder}
						disabled={hasNoAllergies}
						value={medicalAllergiesStr}
						oninput={(event) => updateMedicalField('allergies', event.currentTarget.value)}
					/>
				</div>
			</div>
		</section>

		<section id="screen-section-special" class="form-section-card scroll-mt-20 space-y-4">
			<header class="flex items-center gap-2 border-b border-border/60 pb-3">
				<ShieldAlert class="size-5 text-primary" />
				<h2 class="text-base font-bold text-foreground">{regT.sections.special}</h2>
			</header>

			<div class="space-y-3">
				<div class="flex items-center justify-between gap-3">
					<Label class="text-base font-semibold sm:text-sm">
						{regT.specialNeeds.label}<span class="text-destructive" aria-hidden="true"> *</span>
					</Label>
					<Button
						type="button"
						variant="outline"
						size="sm"
						aria-pressed={hasNoVulnerableGroup}
						onclick={toggleNoVulnerableGroup}
						class="touch-target h-9 shrink-0 px-3 text-sm font-medium {hasNoVulnerableGroup
							? 'border-green-500 bg-green-50 text-green-700 hover:bg-green-100 hover:text-green-800 dark:bg-green-950/30 dark:text-green-400'
							: ''}"
					>
						{regT.specialNeeds.notVulnerableLabel}
					</Button>
				</div>

				<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
					{#each specialNeedChipOptions as chip (chip.code)}
						{@const need = chip.code as NonNullable<EvacueeInput['vulnerable_groups']>[number]}
						{@const checked = (screeningDraft.vulnerable_groups ?? []).includes(need)}
						<button
							type="button"
							role="checkbox"
							aria-checked={checked}
							disabled={hasNoVulnerableGroup}
							onclick={() => toggleVulnerableGroup(need)}
							class="touch-target flex min-h-11 items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40 {checked
								? 'border-primary bg-primary/10 text-foreground'
								: 'border-border bg-background text-muted-foreground hover:border-primary/50 hover:bg-primary/5'}"
						>
							<span
								class="flex size-5 shrink-0 items-center justify-center rounded border {checked
									? 'border-primary bg-primary text-primary-foreground'
									: 'border-muted-foreground/50 bg-background'}"
								aria-hidden="true"
							>
								{#if checked}<Check class="size-3.5" />{/if}
							</span>
							<span class="leading-snug">{chip.label}</span>
						</button>
					{/each}
				</div>
			</div>

			<div class="space-y-2 pt-2">
				<Label class="text-base sm:text-sm">{regT.specialNeeds.note.label}</Label>
				<textarea
					bind:value={screeningDraft.medical_note}
					placeholder={regT.specialNeeds.note.placeholder}
					class="form-control-touch min-h-28 w-full rounded-md border border-input bg-background px-3 py-3 ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-24"
				></textarea>
			</div>

			{#if hasSymptomsSelected}
				<div
					class="flex animate-in items-center justify-center gap-2 rounded-xl border-2 border-danger-border bg-danger-muted px-4 py-4 text-danger duration-300 fade-in slide-in-from-top-2"
					role="alert"
				>
					<TriangleAlert class="size-5 shrink-0" aria-hidden="true" />
					<p class="text-sm font-bold sm:text-base">
						{regT.sos.title} <span class="font-extrabold">{regT.sos.badge}</span>
					</p>
				</div>
				<p class="text-center text-sm text-muted-foreground">
					{regT.sos.description}
				</p>
			{/if}
		</section>
	</div>

	<div
		class="flex flex-col gap-3 border-t border-border pt-6 sm:flex-row-reverse sm:items-center sm:justify-between"
	>
		<Button
			type="button"
			onclick={handleNext}
			class="touch-target h-auto w-full px-6 py-3 text-base font-semibold sm:h-10 sm:w-auto sm:text-sm"
		>
			{t.next}
		</Button>
		<Button
			type="button"
			variant="outline"
			onclick={onBack}
			class="touch-target h-auto w-full px-6 py-3 text-base font-medium sm:h-10 sm:w-auto sm:text-sm"
		>
			{t.back}
		</Button>
	</div>
</div>
