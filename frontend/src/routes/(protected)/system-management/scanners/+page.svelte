<script lang="ts">
	import StaffPageShell from '$lib/components/staff-page-shell.svelte';
	import { spatial } from '$lib/tokens';
	import { Button } from '$lib/components/ui/button/index.js';
	import Plus from '@lucide/svelte/icons/plus';
	import {
		CreateScannerDialog,
		RevealScannerSecretDialog,
		ScannerList,
		useScannerDevices,
		type CreatedScannerDevice,
		type ScannerDevice
	} from '$lib/features/scanners';

	const devicesQuery = useScannerDevices();

	let createOpen = $state(false);
	let revealOpen = $state(false);
	let isNewCreated = $state(false);
	let selectedDevice = $state.raw<ScannerDevice | CreatedScannerDevice | null>(null);

	const devices = $derived(devicesQuery.data ?? []);

	function handleCreated(created: CreatedScannerDevice) {
		selectedDevice = created;
		isNewCreated = true;
		revealOpen = true;
	}

	function handleViewSecret(device: ScannerDevice) {
		selectedDevice = device;
		isNewCreated = false;
		revealOpen = true;
	}
</script>

<svelte:head>
	<title>จัดการเครื่องสแกนบัตร (Scanners) — SmartShelter</title>
</svelte:head>

<StaffPageShell
	title="เครื่องสแกนบัตรประชาชน (Smart Card Scanners)"
	description="บริหารจัดการเครื่องอ่านบัตรประชาชน Smart Card Reader ประจำจุดคัดกรองและศูนย์พักพิง — สร้าง Device Secret เพื่อเชื่อมต่อกับ scanner_client"
>
	{#snippet actions()}
		<Button onclick={() => (createOpen = true)} class="btn-primary-brand shrink-0 gap-2">
			<Plus class="h-4 w-4" />
			ลงทะเบียนเครื่องสแกนใหม่
		</Button>
	{/snippet}

	<div class={spatial.container.staffPageCard}>
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
			<ScannerList {devices} onviewsecret={handleViewSecret} />
		{/if}
	</div>
</StaffPageShell>

<CreateScannerDialog bind:open={createOpen} oncreated={handleCreated} />
<RevealScannerSecretDialog bind:open={revealOpen} device={selectedDevice} isNew={isNewCreated} />
