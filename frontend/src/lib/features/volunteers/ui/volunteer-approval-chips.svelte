<script module lang="ts">
	export type ApprovalChip = 'all' | 'identity' | 'skill_cert' | 'shift';
</script>

<script lang="ts">
	/**
	 * "รออนุมัติ" pill sub-filter row (owner-approved mockup, 2026-08-28) — only
	 * shown while `VolunteerStatPills`' `pending` pill is selected.
	 *
	 * `identity` count always equals `all` (the `pending` pool here IS
	 * `!identity_verified`, `VolunteerStatPills`) — kept as a separate chip only
	 * for visual parity with the mockup. `skill_cert` is a best-effort read of
	 * "has a controlled skill" (`domain/skills.ts#isControlledSkill`) — there is
	 * no `skill_certified`/`skill_verified` field on `volunteer` (schema.md
	 * §2.8) to say whether that skill has actually been certified yet, so this
	 * likely undercounts/overcounts against the real intent. `shift` ("รอเข้ากะ")
	 * has no backing data at all (would need today's `shift_assignment`
	 * joined against this same pending pool) — always 0, disabled. Both are
	 * flagged for a CR to add the missing fields.
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
		{ key: 'all' as const, label: 'ค้างทั้งหมด', value: countAll, disabled: false },
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
