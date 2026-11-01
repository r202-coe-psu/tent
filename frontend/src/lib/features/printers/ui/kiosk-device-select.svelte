<script lang="ts">
	/**
	 * Picks the shelter scanner (kiosk) a kiosk-hosted printer is built into (FR-5a / FR-48).
	 * `null` = not linked. The device list comes from the page so this feature never imports
	 * `kiosk-devices`.
	 */
	import { kioskDevicesOfShelter, type KioskDeviceRef } from '../domain/kiosk-link';

	let {
		id,
		value = $bindable<string | null>(null),
		devices,
		shelterCode,
		noneLabel
	}: {
		id: string;
		value?: string | null;
		devices: readonly KioskDeviceRef[];
		shelterCode: string;
		noneLabel: string;
	} = $props();

	const options = $derived(kioskDevicesOfShelter(devices, shelterCode));
</script>

<select
	{id}
	class="h-11 rounded-md border border-input bg-background px-3 text-sm"
	onchange={(event) => (value = event.currentTarget.value || null)}
>
	<option value="" selected={!value}>{noneLabel}</option>
	{#if value && !options.some((device) => device.device_id === value)}
		<option {value} selected>{value}</option>
	{/if}
	{#each options as device (device.device_id)}
		<option value={device.device_id} selected={value === device.device_id}>
			{device.name} ({device.device_id})
		</option>
	{/each}
</select>
