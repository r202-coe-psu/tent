<script module lang="ts">
	export type ApprovalChip = 'all' | 'identity' | 'skill_cert' | 'shift';
</script>

<script lang="ts">
	/**
	 * "รออนุมัติ" pill sub-filter row (owner-approved mockup, 2026-08-28) — only
	 * shown while `VolunteerStatPills`' `pending` pill is selected.
	 *
	 * Identity and controlled-skill counts read the volunteer verification records;
	 * job approval remains on Job Details > Applicants.
	 */
	let {
		countAll,
		countIdentity,
		countSkillCert,
		countShift = 0,
		selected = $bindable<ApprovalChip>('all')
	}: {
		countAll: number;
		countIdentity: number;
		countSkillCert: number;
		countShift?: number;
		selected?: ApprovalChip;
	} = $props();

	const chips = $derived([
		{ key: 'all' as const, label: 'ต้องตรวจทั้งหมด', value: countAll, disabled: false },
		{ key: 'identity' as const, label: 'รอยืนยันตัวตน', value: countIdentity, disabled: false },
		{ key: 'skill_cert' as const, label: 'รอรับรองทักษะ', value: countSkillCert, disabled: false },
		{ key: 'shift' as const, label: 'รอเข้ากะ', value: countShift, disabled: countShift === 0 }
	]);
</script>

<div class="flex flex-wrap items-center gap-2 rounded-xl bg-muted/60 p-2">
	<span class="inline-flex items-center gap-1 px-1 text-xs font-semibold text-muted-foreground">
		กรองย่อย:
	</span>
	{#each chips as chip (chip.key)}
		<button
			type="button"
			disabled={chip.disabled}
			aria-pressed={selected === chip.key}
			onclick={() => (selected = chip.key)}
			class="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 {selected ===
			chip.key
				? 'border-primary bg-primary text-primary-foreground'
				: 'border-border bg-background text-foreground hover:bg-muted'}"
		>
			{chip.label} ({chip.value})
		</button>
	{/each}
</div>
