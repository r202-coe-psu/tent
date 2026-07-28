<script lang="ts">
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import Dog from '@lucide/svelte/icons/dog';
	import Users from '@lucide/svelte/icons/users';
	import type { PublicShelterDetail } from '$lib/features/public-portal';

	let { shelter }: { shelter: NonNullable<PublicShelterDetail> } = $props();

	function translatePetCategories(categoriesStr: string): string {
		if (!categoriesStr) return '';
		const map: Record<string, string> = {
			small_general: 'สัตว์เล็กทั่วไป',
			large_dog: 'สุนัขพันธุ์ใหญ่',
			livestock: 'ปศุสัตว์'
		};
		return categoriesStr
			.split(',')
			.map((c) => map[c] || c)
			.join(', ');
	}
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
					นโยบายสัตว์เลี้ยง
				</h3>
				<p
					class="text-sm {shelter.admission_policy?.pets === 'not_allowed'
						? 'text-danger/80'
						: 'text-muted-foreground'}"
				>
					{#if shelter.admission_policy?.pets === 'not_allowed'}
						ไม่อนุญาต
					{:else if shelter.admission_policy?.pets === 'allowed'}
						อนุญาต (มีโซนสัตว์เลี้ยง)
					{:else if shelter.admission_policy?.pets?.startsWith('conditional')}
						อนุญาตแบบมีเงื่อนไข ({translatePetCategories(
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
				<h3 class="mb-1 text-sm font-bold text-foreground">กลุ่มเปราะบางที่รองรับได้เป็นพิเศษ</h3>
				{#if shelter.admission_policy?.vulnerable_groups && shelter.admission_policy.vulnerable_groups.length > 0}
					<div class="mt-2 flex flex-wrap gap-2">
						{#each shelter.admission_policy.vulnerable_groups as group, i (i)}
							<span
								class="inline-flex items-center rounded-full bg-accent-purple/10 px-2.5 py-0.5 text-xs font-semibold text-accent-purple"
							>
								{#if group === 'general_vulnerable'}
									กลุ่มเปราะบางทั่วไป
								{:else if group === 'quarantine'}
									ผู้ป่วยแยกกักโรค
								{:else if group === 'wheelchair'}
									ผู้ใช้วีลแชร์
								{:else if group === 'none'}
									ไม่มีโซนเฉพาะ
								{:else}
									{group}
								{/if}
							</span>
						{/each}
					</div>
					{#if !shelter.admission_policy.vulnerable_groups.includes('bedridden')}
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
