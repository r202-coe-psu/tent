<script lang="ts">
	export type HouseholdMemberCard = {
		id: string;
		name: string;
		nickname?: string | null;
		isHead: boolean;
		idMasked: string;
		phone?: string | null;
		needs: { key: string; emoji: string; label: string }[];
	};

	let { members }: { members: HouseholdMemberCard[] } = $props();
</script>

<!-- Phone layout of the household summary's member table (#1347); the table shows from md up. -->
<ul role="list" class="divide-y rounded-xl border md:hidden" data-testid="household-member-cards">
	{#each members as m (m.id)}
		<li class="space-y-2 p-3 text-sm">
			<div class="flex items-start justify-between gap-2">
				<p class="min-w-0 font-bold break-words text-slate-900 dark:text-slate-100">
					{m.name}
					{#if m.nickname}
						<span class="text-xs font-normal text-muted-foreground">({m.nickname})</span>
					{/if}
				</p>
				{#if m.isHead}
					<span class="shrink-0 rounded bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
						หัวหน้าครอบครัว
					</span>
				{:else}
					<span
						class="shrink-0 rounded bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground"
					>
						ลูกบ้าน
					</span>
				{/if}
			</div>
			<div class="font-mono text-xs">
				<span>ID: {m.idMasked}</span>
				{#if m.phone}
					<span class="opacity-75"> · {m.phone}</span>
				{/if}
			</div>
			<div class="flex flex-wrap gap-1">
				{#each m.needs as need (need.key)}
					<span
						class="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-2xs font-medium text-amber-700"
					>
						{need.emoji}
						{need.label}
					</span>
				{:else}
					<span class="text-xs text-muted-foreground italic">ไม่มีกลุ่มช่วยเหลือพิเศษ</span>
				{/each}
			</div>
		</li>
	{/each}
</ul>
