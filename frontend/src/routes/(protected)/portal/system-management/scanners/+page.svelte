<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import Plus from '@lucide/svelte/icons/plus';
	import Cpu from '@lucide/svelte/icons/cpu';
	import {
		CreateScannerDialog,
		RevealScannerSecretDialog,
		ScannerList,
		useScannerDevices,
		type CreatedScannerDevice
	} from '$lib/features/scanners';

	const devicesQuery = useScannerDevices();

	let createOpen = $state(false);
	let revealOpen = $state(false);
	let revealed = $state.raw<CreatedScannerDevice | null>(null);

	const devices = $derived(devicesQuery.data ?? []);

	function handleCreated(created: CreatedScannerDevice) {
		revealed = created;
		revealOpen = true;
	}
</script>

<svelte:head>
	<title>จัดการเครื่องสแกนบัตร (Scanners) — SmartShelter</title>
</svelte:head>

<div class="mx-6 flex flex-1 flex-col gap-8 p-6 md:p-8">
	<div class="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
		<div>
			<h2 class="flex items-center gap-3 text-3xl font-bold tracking-tight text-foreground">
				<Cpu class="h-8 w-8 text-primary" />
				เครื่องสแกนบัตรประชาชน (Smart Card Scanners)
			</h2>
			<p class="mt-2 text-muted-foreground">
				บริหารจัดการเครื่องอ่านบัตรประชาชน Smart Card Reader ประจำจุดคัดกรองและศูนย์พักพิง — สร้าง
				Device Secret เพื่อเชื่อมต่อกับ <code>scanner_client</code>
			</p>
		</div>
		<Button
			onclick={() => (createOpen = true)}
			class="shrink-0 gap-2 bg-primary text-primary-foreground shadow-md transition-all hover:bg-primary/90"
		>
			<Plus class="h-4 w-4" />
			ลงทะเบียนเครื่องสแกนใหม่
		</Button>
	</div>

	<div class="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
		{#if devicesQuery.isLoading}
			<div class="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
				<div
					class="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"
				></div>
				<p>กำลังโหลดรายการเครื่องสแกน...</p>
			</div>
		{:else if devicesQuery.isError}
			<div class="px-6 py-16 text-center text-sm text-destructive">
				{devicesQuery.error instanceof Error
					? devicesQuery.error.message
					: 'Failed to load scanners'}
			</div>
		{:else}
			<ScannerList {devices} />
		{/if}
	</div>
</div>

<CreateScannerDialog bind:open={createOpen} oncreated={handleCreated} />
<RevealScannerSecretDialog bind:open={revealOpen} created={revealed} />
