<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import UsersRound from '@lucide/svelte/icons/users-round';
	import type { KioskHouseholdCandidate } from '../data/kiosk-check-in.api';

	interface Props {
		candidates: KioskHouseholdCandidate[];
		onselect: (primaryEvacueeId: string) => void;
		disabled?: boolean;
	}

	let { candidates, onselect, disabled = false }: Props = $props();
</script>

<section class="space-y-3" aria-labelledby="phone-household-title">
	<header>
		<h2 id="phone-household-title" class="text-xl font-bold tracking-tight text-slate-900">
			พบหลายครัวเรือนที่ใช้เบอร์นี้
		</h2>
		<p class="mt-1 text-base text-slate-700">เลือกครัวเรือนของท่าน</p>
	</header>
	<div class="space-y-2">
		{#each candidates as candidate (candidate.primary_evacuee_id)}
			<Button
				type="button"
				variant="outline"
				{disabled}
				onclick={() => onselect(candidate.primary_evacuee_id)}
				aria-label={`${candidate.contact_display}, สมาชิก ${candidate.member_count} คน, รอรายงานตัว ${candidate.pending_count} คน`}
				class="h-auto min-h-20 w-full justify-start gap-4 rounded-xl border-slate-200 bg-white px-4 py-3 text-left text-slate-900 shadow-2xs focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
			>
				<span
					class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#F0F4F8] text-[#0A2647]"
					aria-hidden="true"
				>
					<UsersRound class="h-5 w-5" />
				</span>
				<span class="min-w-0 flex-1">
					<span class="block truncate text-lg font-bold"
						>{candidate.contact_display || 'ไม่ระบุชื่อ'}</span
					>
					<span class="mt-1 block text-sm font-medium text-slate-700">
						{#if candidate.pending_count === 0}
							รายงานตัวครบแล้ว
						{:else}
							สมาชิก {candidate.member_count} คน · รอรายงานตัว {candidate.pending_count} คน
						{/if}
					</span>
				</span>
			</Button>
		{/each}
	</div>
</section>
