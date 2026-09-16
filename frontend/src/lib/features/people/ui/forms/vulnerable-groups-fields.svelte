<script lang="ts">
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { CR112_VULNERABLE_GROUP_ACTIVE } from '$lib/features/master-data';
	import { PUBLIC_BOOKING_FORM_I18N } from '$lib/constants/i18n';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';

	let {
		vulnerable_groups = $bindable<string[]>([]),
		disabled = false,
		idPrefix = 'vg',
		label = ''
	}: {
		vulnerable_groups?: string[];
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
		vulnerable_groups = vulnerable_groups.includes(code)
			? vulnerable_groups.filter((c) => c !== code)
			: [...vulnerable_groups, code];
	}
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
				<span class="leading-tight">{vulnerableLabel(item.code, item.label)}</span>
			</label>
		{/each}
	</div>
</div>
