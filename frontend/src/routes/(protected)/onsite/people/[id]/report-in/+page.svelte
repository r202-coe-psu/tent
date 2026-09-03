<script lang="ts">
	import { beforeNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import * as Card from '$lib/components/ui/card';
	import {
		RegistrationShell,
		EvacueeWristbandSuccess,
		RegistrationSaveErrorAlert,
		useEvacuee,
		type Evacuee,
		type SaveFailureReport
	} from '$lib/features/people';

	let { data } = $props();

	const evacueeQuery = useEvacuee(() => data.evacueeId);

	let completedEvacuee = $state<Evacuee | null>(null);
	let saveError = $state<SaveFailureReport | null>(null);
	let isDirty = $state(false);
	let isNavigatingAfterSave = $state(false);

	beforeNavigate((nav) => {
		if (isNavigatingAfterSave || completedEvacuee) return;
		if (isDirty && !confirm('มีการแก้ไขที่ยังไม่ได้บันทึก ต้องการออกจากหน้านี้หรือไม่?')) {
			nav.cancel();
		}
	});

	function backToQueue() {
		isNavigatingAfterSave = true;
		completedEvacuee = null;
		goto(resolve('/onsite/people'));
	}

	const evacuee = $derived(evacueeQuery.data ?? null);
	const wrongStatus = $derived(
		Boolean(evacuee && evacuee.current_stay.status !== 'pre_registered')
	);
</script>

<svelte:head>
	<title>
		{evacuee ? `รายงานตัว · ${evacuee.first_name}` : 'รายงานตัว'} | SmartShelter
	</title>
</svelte:head>

<div class="mx-auto w-full max-w-5xl px-4 py-4 md:px-6 md:py-6">
	{#if completedEvacuee}
		<EvacueeWristbandSuccess evacuee={completedEvacuee} onBack={backToQueue} />
	{:else}
		<button
			type="button"
			onclick={backToQueue}
			class="mb-3 inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
		>
			<ArrowLeft class="size-4" />
			<span>กลับคิวทะเบียน</span>
		</button>

		<div class="mb-4 flex flex-wrap items-center gap-2">
			<ClipboardList class="size-5 text-primary" />
			<h1 class="text-2xl font-bold md:text-3xl">รายงานตัว</h1>
			<Badge variant="outline">Station 1 · Report-in</Badge>
		</div>

		{#if saveError}
			<RegistrationSaveErrorAlert report={saveError} ondismiss={() => (saveError = null)} />
		{/if}

		{#if evacueeQuery.isPending}
			<div class="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
				<div
					class="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent"
				></div>
				<p class="text-xs">กำลังโหลดข้อมูลผู้ประสบภัย...</p>
			</div>
		{:else if !evacuee}
			<Card.Root class="border-border bg-card p-6 text-center shadow-sm">
				<div
					class="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600"
				>
					<AlertTriangle class="size-6" />
				</div>
				<h2 class="text-base font-bold">ไม่พบผู้ประสบภัย</h2>
				<p class="mt-1.5 text-xs text-muted-foreground">
					รหัส <span class="font-mono">{data.evacueeId}</span> ไม่มีในศูนย์นี้
				</p>
				<Button class="mt-4" onclick={backToQueue}>กลับคิวทะเบียน</Button>
			</Card.Root>
		{:else if wrongStatus}
			<Card.Root class="border-border bg-card p-6 text-center shadow-sm">
				<h2 class="text-base font-bold">สถานะไม่ใช่ pre_registered</h2>
				<p class="mt-1.5 text-xs text-muted-foreground">
					รายงานตัวได้เฉพาะผู้ที่ลงทะเบียนล่วงหน้า — สถานะปัจจุบัน:
					{evacuee.current_stay.status}
				</p>
				<Button class="mt-4" onclick={backToQueue}>กลับคิวทะเบียน</Button>
			</Card.Root>
		{:else}
			<div class="rounded-2xl border border-border bg-card p-5 shadow-xs sm:p-8 md:p-10">
				<RegistrationShell
					mode="report-in"
					initialEvacuee={evacuee}
					onDirtyChange={(dirty) => (isDirty = dirty)}
					onsaveerror={(report) => {
						saveError = report;
					}}
					onComplete={(ev) => {
						saveError = null;
						isDirty = false;
						isNavigatingAfterSave = true;
						completedEvacuee = ev;
					}}
				/>
			</div>
		{/if}
	{/if}
</div>
