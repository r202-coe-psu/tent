<script lang="ts">
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { KIOSK_SCREENS, type KioskScreenType } from '$lib/features/shared/domain/kiosk-screen';

	/**
	 * Checkbox list of a shelter's kiosks for a banner group. A kiosk is in at most one group, so
	 * ticking one that belongs to another group moves it here — the row warns about that.
	 */
	let {
		devices,
		groups,
		groupId,
		selected = $bindable()
	}: {
		devices: {
			device_id: string;
			name: string;
			station_name: string;
			screen_type: KioskScreenType;
			banner_group_id: string | null;
		}[];
		groups: { _id: string; name: string }[];
		/** The group being edited; `null` while creating one. */
		groupId: string | null;
		/** `device_id`s of the kiosks that will be in the group. */
		selected: string[];
	} = $props();

	const groupNames = $derived(new Map(groups.map((group) => [group._id, group.name])));
	const groupName = (id: string) => groupNames.get(id) ?? 'กลุ่มอื่น';
</script>

{#if devices.length === 0}
	<p class="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-slate-600">
		ยังไม่มีเครื่อง kiosk ในศูนย์นี้
	</p>
{:else}
	<ul class="divide-y divide-slate-200/80 rounded-xl border border-slate-200/80 bg-white">
		{#each devices as device (device.device_id)}
			{@const meta = KIOSK_SCREENS[device.screen_type]}
			{@const movesFrom =
				device.banner_group_id !== null && device.banner_group_id !== groupId
					? device.banner_group_id
					: null}
			<li>
				<label
					class="flex min-h-11 cursor-pointer items-start gap-3 px-4 py-3 hover:bg-slate-50 has-[:focus-visible]:bg-slate-50"
				>
					<input
						type="checkbox"
						value={device.device_id}
						bind:group={selected}
						class="mt-0.5 size-5 shrink-0 rounded border-slate-400 accent-primary"
					/>
					<span class="flex min-w-0 flex-1 flex-col gap-0.5">
						<span class="font-semibold break-words text-slate-900">{device.name}</span>
						<span class="text-sm break-words text-slate-700">
							{device.station_name} · {meta.label}
							{meta.size} ·
							{device.banner_group_id ? groupName(device.banner_group_id) : 'ไม่มีกลุ่ม'}
						</span>
						{#if movesFrom !== null && selected.includes(device.device_id)}
							<span
								class="inline-flex items-center gap-1.5 text-sm font-semibold text-amber-900"
								role="status"
							>
								<TriangleAlert class="size-4 shrink-0" aria-hidden="true" />
								จะย้ายออกจากกลุ่ม {groupName(movesFrom)}
							</span>
						{/if}
					</span>
				</label>
			</li>
		{/each}
	</ul>
{/if}
