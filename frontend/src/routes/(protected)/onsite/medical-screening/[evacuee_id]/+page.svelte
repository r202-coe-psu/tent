<script lang="ts">
	import { beforeNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Stethoscope from '@lucide/svelte/icons/stethoscope';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';

	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import * as Card from '$lib/components/ui/card';

	import {
		useEvacuees,
		useScreenings,
		maskNationalId,
		evacueeAgeYears,
		type Screening
	} from '$lib/features/people';
	import ClinicalScreeningForm from '../clinical-screening-form.svelte';
	import { shouldConfirmLeave } from '../medical-screening.utils';

	let { data } = $props();

	const evacueesQuery = useEvacuees();
	const screeningsQuery = useScreenings();

	const evacueeId = $derived(data.evacueeId);
	const isLoading = $derived(evacueesQuery.isPending || screeningsQuery.isPending);

	const evacuee = $derived((evacueesQuery.data ?? []).find((e) => e._id === evacueeId) ?? null);

	const screeningsForEvacuee = $derived(
		((screeningsQuery.data ?? []) as Screening[])
			.filter((s) => s.evacuee_id === evacueeId)
			.slice()
			.sort((a, b) => (b.screened_at || '').localeCompare(a.screened_at || ''))
	);

	const latestScreening = $derived(screeningsForEvacuee[0] ?? null);

	const priorScreening = $derived(
		latestScreening
			? {
					screeningCount: screeningsForEvacuee.length,
					lastScreenedAt: latestScreening.screened_at,
					lastScreenedBy: latestScreening.created_by,
					latest: latestScreening
				}
			: null
	);

	let isDirty = $state(false);
	let isNavigatingAfterSave = $state(false);
	let savedEvacueeId = $state<string | null>(null);

	beforeNavigate((nav) => {
		if (isNavigatingAfterSave || savedEvacueeId) return;
		if (
			shouldConfirmLeave({ isDirty }) &&
			!confirm('มีการแก้ไขที่ยังไม่ได้บันทึก ต้องการออกจากหน้านี้หรือไม่?')
		) {
			nav.cancel();
		}
	});

	function goToQueue() {
		isNavigatingAfterSave = true;
		goto(resolve('/onsite/medical-screening'));
	}

	function goToZoning(id: string) {
		isNavigatingAfterSave = true;
		goto(resolve(`/onsite/zoning/${id}` as `/onsite/zoning/${string}`));
	}

	function handleSuccess(id: string) {
		isDirty = false;
		savedEvacueeId = id;
	}
</script>

<svelte:head>
	<title>
		{evacuee ? `คัดกรอง · ${evacuee.first_name} ${evacuee.last_name}` : 'คัดกรองการแพทย์'} | SmartShelter
	</title>
</svelte:head>

<div class="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-4xl flex-col">
	<div class="flex items-center gap-3 border-b border-border px-4 py-4 md:px-6">
		<button
			type="button"
			onclick={goToQueue}
			class="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
			title="กลับไปคิวคัดกรอง"
		>
			<ArrowLeft class="size-4" />
		</button>
		<div class="min-w-0 flex-1">
			<div class="flex flex-wrap items-center gap-2">
				<div
					class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
				>
					<Stethoscope class="size-5" />
				</div>
				<h1 class="truncate text-xl font-bold tracking-tight text-foreground md:text-2xl">
					{#if evacuee}
						{evacuee.first_name}
						{evacuee.last_name}
					{:else}
						ฟอร์มคัดกรองทางการแพทย์
					{/if}
				</h1>
				<Badge
					variant="outline"
					class="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
				>
					Station 2
				</Badge>
			</div>
			{#if evacuee}
				<p class="mt-0.5 text-xs text-muted-foreground">
					เพศ {evacuee.gender === 'male' ? 'ชาย' : evacuee.gender === 'female' ? 'หญิง' : 'อื่นๆ'} · อายุ
					{evacueeAgeYears(evacuee) ?? '—'} ปี · บัตร
					{maskNationalId(evacuee.person_id?.number)} · โทร {evacuee.phone || '—'}
				</p>
			{/if}
		</div>
	</div>

	{#if isLoading}
		<div class="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-muted-foreground">
			<div
				class="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent"
			></div>
			<p class="text-xs">กำลังโหลดข้อมูลผู้ประสบภัย...</p>
		</div>
	{:else if !evacuee}
		<div class="flex flex-1 items-center justify-center p-6">
			<Card.Root class="w-full max-w-md border-border bg-card p-6 text-center shadow-sm">
				<div
					class="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600"
				>
					<AlertTriangle class="size-6" />
				</div>
				<h2 class="text-base font-bold text-foreground">ไม่พบผู้ประสบภัย</h2>
				<p class="mt-1.5 text-xs leading-relaxed text-muted-foreground">
					รหัส <span class="font-mono">{evacueeId}</span> ไม่มีในศูนย์นี้ หรือคุณไม่มีสิทธิ์เข้าถึง —
					กลับไปที่คิวคัดกรองแล้วลองค้นหาอีกครั้ง
				</p>
				<Button variant="default" class="mt-4 w-full" onclick={goToQueue}>กลับไปคิวคัดกรอง</Button>
			</Card.Root>
		</div>
	{:else if savedEvacueeId}
		<div class="flex flex-1 items-center justify-center p-6">
			<Card.Root class="w-full max-w-md border-border bg-card p-6 text-center shadow-sm">
				<h2 class="text-base font-bold text-foreground">บันทึกผลการคัดกรองแล้ว</h2>
				<p class="mt-1.5 text-xs text-muted-foreground">
					ส่งต่อไปโต๊ะจัดสรรที่พัก (Station 3) หรือกลับคิวแพทย์
				</p>
				<div class="mt-5 flex flex-col gap-2">
					<Button class="w-full" onclick={() => goToZoning(savedEvacueeId!)}>ไปจัดโซนเลย</Button>
					<Button variant="outline" class="w-full" onclick={goToQueue}>กลับคิวแพทย์</Button>
				</div>
			</Card.Root>
		</div>
	{:else}
		<ClinicalScreeningForm
			{evacuee}
			{priorScreening}
			onDirtyChange={(dirty) => (isDirty = dirty)}
			onSuccess={handleSuccess}
		/>
	{/if}
</div>
