<script lang="ts">
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { CR112_VULNERABLE_GROUP_ACTIVE, formatMasterLabel } from '$lib/features/master-data';
	import { PUBLIC_BOOKING_FORM_I18N } from '$lib/constants/i18n';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';

	let {
		vulnerable_groups = $bindable<string[]>([]),
		/** Free text when「ผู้พิการ (อื่นๆ)」is ticked — optional (CR-148). */
		disability_other_detail = $bindable<string | null | undefined>(null),
		/** Render the detail input — off for screens that cannot persist it yet. */
		showDisabilityDetail = true,
		disabled = false,
		idPrefix = 'vg',
		label = ''
	}: {
		vulnerable_groups?: string[];
		disability_other_detail?: string | null;
		showDisabilityDetail?: boolean;
		disabled?: boolean;
		idPrefix?: string;
		label?: string;
	} = $props();

	const t = $derived(getTranslation(PUBLIC_BOOKING_FORM_I18N, langState.current));

	const vulnerableLabelByCode = $derived({
		bedridden: t.vgBedridden,
		dialysis: t.vgDialysis,
		wheelchair: t.vgWheelchair,
		psychiatric: t.vgPsychiatric,
		elderly_dependent: t.vgElderlyDependent,
		infant: t.vgInfant,
		young_child: t.vgYoungChild,
		pregnant: t.vgPregnant,
		vision_impaired: t.vgVisionImpaired,
		hearing_impaired: t.vgHearingImpaired,
		disability_other: t.vgDisabilityOther,
		chronic_illness: t.vgChronicIllness
	} as Record<string, string>);

	function vulnerableLabel(code: string, fallback: string): string {
		return vulnerableLabelByCode[code] ?? fallback;
	}

	function toggle(code: string) {
		if (disabled) return;
		const removing = vulnerable_groups.includes(code);
		vulnerable_groups = removing
			? vulnerable_groups.filter((c) => c !== code)
			: [...vulnerable_groups, code];
		if (removing && code === 'disability_other') disability_other_detail = null;
	}

	const showDetail = $derived(
		showDisabilityDetail && vulnerable_groups.includes('disability_other')
	);
</script>

<div class="space-y-3">
	{#if label}
		<Label class="text-sm font-semibold text-foreground">{label}</Label>
	{/if}

	<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
		{#each CR112_VULNERABLE_GROUP_ACTIVE as item (item.code)}
			{@const isChecked = vulnerable_groups.includes(item.code)}
			<label
				class="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border p-2.5 text-xs transition-colors select-none {isChecked
					? 'border-primary/60 bg-primary/5 font-semibold text-foreground'
					: 'border-border/60 bg-background text-muted-foreground hover:border-primary/30 hover:bg-muted/30'} {disabled
					? 'pointer-events-none opacity-60'
					: ''}"
			>
				<Checkbox
					id="{idPrefix}-{item.code}"
					checked={isChecked}
					onCheckedChange={() => toggle(item.code)}
					{disabled}
					class="size-4 shrink-0"
				/>
				<span class="leading-tight"
					>{vulnerableLabel(item.code, formatMasterLabel(item, langState.current))}</span
				>
			</label>
		{/each}
	</div>

	{#if showDetail}
		<div class="space-y-1.5">
			<Label for="{idPrefix}-disability-detail" class="text-xs font-semibold text-foreground">
				{t.disabilityOtherDetailLabel}
			</Label>
			<Input
				id="{idPrefix}-disability-detail"
				value={disability_other_detail ?? ''}
				oninput={(e) => (disability_other_detail = (e.currentTarget as HTMLInputElement).value)}
				{disabled}
				maxlength={120}
				placeholder={t.disabilityOtherDetailPlaceholder}
				class="h-9"
			/>
		</div>
	{/if}
</div>
