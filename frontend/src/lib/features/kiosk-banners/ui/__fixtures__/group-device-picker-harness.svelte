<script lang="ts">
	import type { KioskScreenType } from '$lib/features/shared/domain/kiosk-screen';
	import KioskBannerGroupDevicePicker from '../kiosk-banner-group-device-picker.svelte';

	type PickerDevice = {
		device_id: string;
		name: string;
		station_name: string;
		screen_type: KioskScreenType;
		banner_group_id: string | null;
	};

	/** Test-only parent: owns the bound `selected` (as a page does) and echoes it. */
	let {
		devices,
		groups,
		groupId = null,
		initialSelected = []
	}: {
		devices: PickerDevice[];
		groups: { _id: string; name: string }[];
		groupId?: string | null;
		initialSelected?: string[];
	} = $props();

	// svelte-ignore state_referenced_locally
	let selected = $state<string[]>(initialSelected);
</script>

<KioskBannerGroupDevicePicker {devices} {groups} {groupId} bind:selected />
<output data-testid="selected">{selected.join(',')}</output>
