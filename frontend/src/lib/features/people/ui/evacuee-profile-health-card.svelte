<script lang="ts">
	import Stethoscope from '@lucide/svelte/icons/stethoscope';
	import type { Evacuee, Medical, Screening } from '$lib/features/people';
	import { EWAR_SYMPTOM_GROUPS } from '$lib/features/people';
	import { useMasterData } from '$lib/features/master-data';

	let {
		evacuee,
		medical,
		screening
	}: {
		evacuee: Evacuee;
		medical: Medical | null;
		screening: Screening | null;
	} = $props();

	function getSymptomLabel(id: string): string {
		for (const g of EWAR_SYMPTOM_GROUPS) {
			const s = g.symptoms.find((sym) => sym.id === id);
			if (s) return s.label;
		}
		return id;
	}

	const vulnerableGroupQuery = useMasterData(() => 'vulnerable_group');
	function specialNeedLabel(code: string): string {
		return vulnerableGroupQuery.data?.items.find((i) => i.code === code)?.label ?? code;
	}
</script>

<div
	class="overflow-hidden rounded-3xl border border-red-100 bg-card shadow-sm dark:border-red-950/50"
>
	<div
		class="flex items-center gap-2.5 border-b border-red-100/50 bg-red-50/60 p-4 px-6 dark:border-red-950/30 dark:bg-red-950/20"
	>
		<Stethoscope class="size-5 text-red-600 dark:text-red-500" />
		<h3 class="text-sm font-bold text-slate-900 dark:text-slate-50">
			ข้อมูลสุขภาพ และ ความเปราะบาง (Health &amp; Vulnerability)
		</h3>
	</div>

	<div class="grid grid-cols-1 gap-6 p-6 md:grid-cols-12">
		<!-- Left: health data -->
		<div class="space-y-4 md:col-span-7">
			<div>
				<span class="block text-xs font-semibold text-red-600 dark:text-red-400"
					>อาการป่วยแรกรับ:</span
				>
				<div
					class="mt-1.5 rounded-2xl border border-slate-100 bg-slate-50 p-3 text-sm font-semibold text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
				>
					{#if screening && screening.symptoms.length > 0}
						<div class="flex flex-col gap-1">
							{#each screening.symptoms as sym (sym)}
								<span>• {getSymptomLabel(sym)}</span>
							{/each}
						</div>
					{:else if medical && medical.conditions.length > 0}
						<div class="flex flex-col gap-1">
							{#each medical.conditions as cond (cond)}
								<span>• {cond}</span>
							{/each}
						</div>
					{:else}
						<span class="font-normal text-muted-foreground">ไม่มีอาการป่วยแรกรับ</span>
					{/if}
				</div>
			</div>

			<div class="grid grid-cols-2 gap-4">
				<div>
					<span class="block text-xs font-medium text-muted-foreground">โรคประจำตัว:</span>
					<span class="mt-1 block text-sm font-bold text-slate-800 dark:text-slate-200">
						{medical?.conditions?.join(', ') || 'ไม่มี'}
					</span>
				</div>
				<div>
					<span class="block text-xs font-medium text-muted-foreground">ความเสี่ยงแพร่เชื้อ:</span>
					{#if (screening && screening.symptoms.includes('acute_respiratory')) || medical?.notes?.includes('กักโรค') || medical?.notes?.includes('แพร่เชื้อ')}
						<span
							class="mt-1.5 inline-block rounded-full border border-red-200 bg-red-100 px-2.5 py-0.5 text-[10px] font-bold text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
						>
							ควรแยกกักโรค
						</span>
					{:else}
						<span class="mt-1 block text-sm font-semibold text-slate-500">ไม่มีความเสี่ยง</span>
					{/if}
				</div>
			</div>

			<div class="grid grid-cols-2 gap-4 border-t border-border/40 pt-3">
				<div>
					<span class="block text-xs font-medium text-muted-foreground">แพ้ยา:</span>
					<span class="mt-0.5 block text-sm font-semibold text-slate-800 dark:text-slate-200">
						{#if medical && medical.medications && medical.medications.length > 0}
							{medical.medications.join(', ')}
						{:else}
							ไม่ระบุประวัติ
						{/if}
					</span>
				</div>
				<div>
					<span class="block text-xs font-medium text-muted-foreground">แพ้อาหาร:</span>
					<span class="mt-0.5 block text-sm font-semibold text-slate-800 dark:text-slate-200">
						{#if medical && medical.allergies && medical.allergies.length > 0}
							{medical.allergies.join(', ')}
						{:else}
							ไม่ระบุประวัติ
						{/if}
					</span>
				</div>
			</div>

			<div class="border-t border-border/40 pt-3">
				<span class="block text-xs font-medium text-muted-foreground">บันทึกของพยาบาล:</span>
				<div
					class="mt-1.5 rounded-2xl border border-blue-100/50 bg-blue-50/50 p-3 text-xs font-semibold text-blue-800 dark:border-blue-900/20 dark:bg-blue-950/20 dark:text-blue-300"
				>
					{medical?.notes || screening?.notes || 'ไม่มีบันทึกทางพยาบาล'}
				</div>
			</div>
		</div>

		<!-- Right: vulnerability -->
		<div class="space-y-4 border-t pt-4 md:col-span-5 md:border-t-0 md:border-l md:pt-0 md:pl-6">
			<div>
				<span class="block text-xs font-medium text-muted-foreground">กลุ่มเปราะบาง:</span>
				<div class="mt-2 flex flex-wrap gap-1.5">
					{#if evacuee.special_needs && evacuee.special_needs.length > 0}
						{#each evacuee.special_needs as need (need)}
							<span
								class="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300"
							>
								<span>{specialNeedLabel(need)}</span>
							</span>
						{/each}
					{:else}
						<span class="text-xs text-muted-foreground italic">ทั่วไป (ไม่มีความเปราะบาง)</span>
					{/if}
				</div>
			</div>

			<div class="border-t border-border/40 pt-3">
				<span class="block text-xs font-medium text-muted-foreground"
					>ความต้องการพิเศษ/ข้อแนะนำ:</span
				>
				<div
					class="mt-1.5 rounded-2xl border border-slate-100 bg-slate-50 p-3 text-xs font-medium text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
				>
					{#if evacuee.special_needs.includes('disabled')}
						ต้องการรถเข็น, เครื่องช่วยฟัง
					{:else if medical?.notes?.includes('ต้องการ')}
						{medical.notes}
					{:else}
						ไม่มีข้อแนะนำพิเศษ
					{/if}
				</div>
			</div>

			{#if screening?.needs_referral}
				<div class="pt-2">
					<span
						class="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400"
					>
						🚨 สถานะส่งต่อ: Requested
					</span>
				</div>
			{/if}
		</div>
	</div>
</div>
