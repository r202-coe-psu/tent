<script lang="ts">
	import Stethoscope from '@lucide/svelte/icons/stethoscope';
	import Pencil from '@lucide/svelte/icons/pencil';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import HeartHandshake from '@lucide/svelte/icons/heart-handshake';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import type { Evacuee, Medical, Screening } from '$lib/features/people';
	import { EWAR_SYMPTOM_GROUPS } from '$lib/features/people';
	import { CR112_VULNERABLE_GROUP_ACTIVE, useMasterData } from '$lib/features/master-data';

	let {
		evacuee,
		medical,
		screening,
		readonly,
		onOpenEdit
	}: {
		evacuee: Evacuee;
		medical: Medical | null;
		screening: Screening | null;
		readonly: boolean;
		onOpenEdit: () => void;
	} = $props();

	function getSymptomLabel(id: string): string {
		for (const g of EWAR_SYMPTOM_GROUPS) {
			const s = g.symptoms.find((sym) => sym.id === id);
			if (s) return s.label;
		}
		return id;
	}

	const vulnerableGroupQuery = useMasterData(() => 'vulnerable_group');
	function vulnerableLabel(code: string): string {
		const fromMaster = vulnerableGroupQuery.data?.items.find((i) => i.code === code)?.label;
		if (fromMaster) return fromMaster;
		const fallback = CR112_VULNERABLE_GROUP_ACTIVE.find((i) => i.code === code)?.label;
		return fallback ?? code;
	}

	const careTrack = $derived(medical?.track ?? screening?.track ?? 'normal');
	const isFastTrack = $derived(careTrack === 'fast_track');
	const hasEwarSymptoms = $derived(!!screening && screening.symptoms.length > 0);
	const vulnerableGroups = $derived(evacuee.vulnerable_groups ?? []);
	const specialNeeds = $derived(evacuee.special_needs ?? []);
</script>

<section class="overflow-hidden rounded-xl border border-blue-200/70 bg-card dark:border-blue-950/60 shadow-2xs">
	<div
		class="flex items-center gap-2.5 border-b border-blue-100/70 bg-blue-50/60 px-5 py-4 dark:border-blue-950/40 dark:bg-blue-950/20"
	>
		<Stethoscope class="size-5 text-blue-600 dark:text-blue-500" />
		<div class="flex flex-1 items-center justify-between">
			<h3 class="text-sm font-bold text-slate-900 dark:text-slate-50">
				ข้อมูลสุขภาพ และ ความเปราะบาง (Health &amp; Vulnerability)
			</h3>
			{#if !readonly}
				<button
					type="button"
					aria-label="แก้ไขข้อมูลสุขภาพ"
					title="แก้ไขข้อมูลสุขภาพ"
					onclick={onOpenEdit}
					class="inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-red-600 transition-colors hover:bg-red-100 hover:text-red-800 dark:text-red-400 dark:hover:bg-red-950"
				>
					<Pencil class="size-4" />
				</button>
			{/if}
		</div>
	</div>

	<div class="grid min-w-0 grid-cols-1 gap-5 p-5 md:grid-cols-12">
		<!-- Left: health data & symptoms (Station 2) -->
		<div class="min-w-0 space-y-4 md:col-span-7">
			<!-- Care Track & Infection Risk status -->
			<div class="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
				<div class="min-w-0">
					<span class="block text-xs font-medium text-muted-foreground">แนวทางดูแล (Care Track):</span>
					<div class="mt-1">
						{#if isFastTrack}
							<span
								class="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-bold text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
							>
								Fast track (เร่งด่วน / ติดตามใกล้ชิด)
							</span>
						{:else}
							<span
								class="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400"
							>
								ดูแลตามปกติ (Normal)
							</span>
						{/if}
					</div>
				</div>

				<div class="min-w-0">
					<span class="block text-xs font-medium text-muted-foreground">ความเสี่ยงแพร่เชื้อ:</span>
					<div class="mt-1">
						{#if hasEwarSymptoms}
							<span
								class="inline-flex items-center rounded-full border border-red-200 bg-red-100 px-2.5 py-0.5 text-xs font-bold text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
							>
								ควรแยกกักโรค (มีอาการเฝ้าระวัง)
							</span>
						{:else}
							<span class="text-sm font-semibold text-slate-500 dark:text-slate-400">
								ไม่มีความเสี่ยงแพร่เชื้อ
							</span>
						{/if}
					</div>
				</div>
			</div>

			<!-- General symptoms from Station 2 -->
			<div class="border-t border-border/40 pt-3">
				<span class="block text-xs font-medium text-muted-foreground">อาการและข้อสังเกตทั่วไป:</span>
				<div
					class="mt-1.5 break-words rounded-md border border-slate-100 bg-slate-50 p-3 text-sm text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
				>
					{#if screening?.notes}
						<span class="font-medium">{screening.notes}</span>
					{:else}
						<span class="text-muted-foreground italic">ไม่มีอาการระบุ</span>
					{/if}
				</div>
			</div>

			<!-- EWAR Surveillance Symptoms -->
			<div class="border-t border-border/40 pt-3">
				<div class="flex items-center gap-1.5">
					<AlertCircle class="size-3.5 text-amber-600 dark:text-amber-500" />
					<span class="text-xs font-semibold text-foreground">
						อาการเฝ้าระวังทางระบาดวิทยา (EWAR):
					</span>
				</div>
				<div class="mt-2">
					{#if hasEwarSymptoms}
						<div class="flex flex-wrap gap-1.5">
							{#each screening!.symptoms as sym (sym)}
								<span
									class="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
								>
									{getSymptomLabel(sym)}
								</span>
							{/each}
						</div>
					{:else}
						<span class="text-xs text-muted-foreground italic">ไม่มีอาการเฝ้าระวัง</span>
					{/if}
				</div>
			</div>

			<!-- Medical History: Conditions, Medications, Allergies -->
			<div class="grid min-w-0 grid-cols-1 gap-4 border-t border-border/40 pt-3 sm:grid-cols-3">
				<div class="min-w-0">
					<span class="block text-xs font-medium text-muted-foreground">โรคประจำตัว:</span>
					<span
						class="mt-0.5 block break-words text-sm font-semibold text-slate-800 dark:text-slate-200"
					>
						{medical?.conditions?.length ? medical.conditions.join(', ') : 'ไม่มี'}
					</span>
				</div>
				<div class="min-w-0">
					<span class="block text-xs font-medium text-muted-foreground">ยาที่ใช้ประจำ:</span>
					<span
						class="mt-0.5 block break-words text-sm font-semibold text-slate-800 dark:text-slate-200"
					>
						{medical?.medications?.length ? medical.medications.join(', ') : 'ไม่ระบุ'}
					</span>
				</div>
				<div class="min-w-0">
					<span class="block text-xs font-medium text-muted-foreground">ประวัติการแพ้:</span>
					<span
						class="mt-0.5 block break-words text-sm font-semibold text-slate-800 dark:text-slate-200"
					>
						{medical?.allergies?.length ? medical.allergies.join(', ') : 'ไม่ระบุ'}
					</span>
				</div>
			</div>

			{#if medical?.notes}
				<div class="min-w-0 border-t border-border/40 pt-3">
					<span class="block text-xs font-medium text-muted-foreground">บันทึกการดูแลต่อเนื่อง:</span>
					<div
						class="mt-1.5 break-words rounded-md border border-blue-100/50 bg-blue-50/50 p-3 text-xs text-blue-800 dark:border-blue-900/20 dark:bg-blue-950/20 dark:text-blue-300"
					>
						{medical.notes}
					</div>
				</div>
			{/if}
		</div>

		<!-- Right: vulnerability & special needs (Station 1 & Station 2) -->
		<div
			class="min-w-0 space-y-4 border-t pt-4 md:col-span-5 md:border-t-0 md:border-l md:pt-0 md:pl-6"
		>
			<!-- Section 3: Vulnerable Groups (CR112 active) -->
			<div class="min-w-0">
				<div class="flex items-center gap-1.5">
					<ShieldAlert class="size-4 text-amber-700 dark:text-amber-500" />
					<span class="text-xs font-semibold text-foreground">กลุ่มเปราะบาง (Vulnerable Groups):</span>
				</div>
				<div class="mt-2 flex flex-wrap gap-1.5">
					{#if vulnerableGroups.length > 0}
						{#each vulnerableGroups as code (code)}
							<span
								class="inline-flex max-w-full items-center gap-1 break-words rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
							>
								{vulnerableLabel(code)}
							</span>
						{/each}
					{:else}
						<span class="text-xs text-muted-foreground italic">ทั่วไป (ไม่มีกลุ่มเปราะบาง)</span>
					{/if}
				</div>
			</div>

			<!-- Section 4: Additional needs (special needs) -->
			<div class="min-w-0 border-t border-border/40 pt-3">
				<div class="flex items-center gap-1.5">
					<HeartHandshake class="size-4 text-sky-700 dark:text-sky-500" />
					<span class="text-xs font-semibold text-foreground">ความต้องการเพิ่มเติม:</span>
				</div>
				<div class="mt-2 flex flex-wrap gap-1.5">
					{#if specialNeeds.length > 0}
						{#each specialNeeds as need (need)}
							<span
								class="inline-flex max-w-full items-center gap-1 break-words rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-xs font-semibold text-sky-800 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-300"
							>
								{need}
							</span>
						{/each}
					{:else}
						<span class="text-xs text-muted-foreground italic">ไม่มีความต้องการเพิ่มเติม</span>
					{/if}
				</div>
			</div>
		</div>
	</div>
</section>
