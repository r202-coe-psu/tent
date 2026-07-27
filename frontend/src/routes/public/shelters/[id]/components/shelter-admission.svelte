<script lang="ts">
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import Dog from '@lucide/svelte/icons/dog';
	import Users from '@lucide/svelte/icons/users';
	import type { PublicShelterDetail } from '$lib/features/public-portal';

	let { shelter }: { shelter: NonNullable<PublicShelterDetail> } = $props();
</script>

<section>
	<div class="mb-4 flex items-center gap-2">
		<CheckCircle2 class="h-5 w-5 text-success-dark" />
		<h2 class="text-lg font-bold text-foreground">นโยบายการรับเข้าพัก (Admission Policy)</h2>
	</div>

	<div class="flex flex-col gap-3">
		<!-- Pets -->
		<div class="flex items-start gap-4 rounded-xl border border-border bg-white p-4 shadow-sm">
			<div
				class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg {(
					shelter.admission_policy?.pets || ''
				).includes('ไม่')
					? 'bg-danger/10 text-danger'
					: 'bg-warning/15 text-warning-dark'}"
			>
				<Dog class="h-5 w-5" />
			</div>
			<div>
				<h3
					class="mb-1 text-sm font-bold {(shelter.admission_policy?.pets || '').includes('ไม่')
						? 'text-danger'
						: 'text-foreground'}"
				>
					นโยบายสัตว์เลี้ยง
				</h3>
				<p
					class="text-sm {(shelter.admission_policy?.pets || '').includes('ไม่')
						? 'text-danger/80'
						: 'text-muted-foreground'}"
				>
					{shelter.admission_policy?.pets || '-'}
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
				<h3 class="mb-1 text-sm font-bold text-foreground">กลุ่มเปราะบางที่รองรับได้เป็นพิเศษ</h3>
				{#if shelter.admission_policy?.vulnerable_groups && shelter.admission_policy.vulnerable_groups.length > 0}
					<div class="mt-2 flex flex-wrap gap-2">
						{#each shelter.admission_policy.vulnerable_groups as group, i (i)}
							<span
								class="inline-flex items-center rounded-full bg-accent-purple/10 px-2.5 py-0.5 text-xs font-semibold text-accent-purple"
							>
								{group}
							</span>
						{/each}
					</div>
					{#if !shelter.admission_policy.vulnerable_groups.includes('ผู้ป่วยติดเตียง')}
						<p class="mt-2 text-xs text-muted-foreground">
							* ไม่ได้ระบุว่ารองรับผู้ป่วยติดเตียงเป็นพิเศษ
						</p>
					{/if}
				{:else}
					<p class="text-sm text-muted-foreground">-</p>
				{/if}
			</div>
		</div>
	</div>
</section>
