<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import Cpu from '@lucide/svelte/icons/cpu';
	import Building from '@lucide/svelte/icons/building';
	import Activity from '@lucide/svelte/icons/activity';
	import Settings2 from '@lucide/svelte/icons/settings-2';
	import ImageIcon from '@lucide/svelte/icons/image';
	import ImageOff from '@lucide/svelte/icons/image-off';
	import type { ScannerDevice } from '../domain/scanner.schema';
	import { useDeleteScannerDevice } from '../application/queries';
	import { toast } from 'svelte-sonner';
	import { formatThaiShortDate } from '$lib/utils/date';
	import DeleteScannerDialog from './delete-scanner-dialog.svelte';
	import EditScannerDialog from './edit-scanner-dialog.svelte';
	import { KIOSK_SCREENS, screenTypeOf } from '$lib/features/shared/domain/kiosk-screen';
	import ScannerPinBadge from './scanner-pin-badge.svelte';

	/**
	 * Kiosk device table: state only (status, PIN, banner group, last seen). Every per-device action —
	 * edit, active switch, Scanner Key, staff PIN, delete — is in the
	 * "จัดการ" dialog.
	 */
	let {
		devices = [],
		groupNames,
		onviewsecret,
		onviewpin,
		onsetpin
	}: {
		devices: ScannerDevice[];
		/** Banner group `_id` → name; a device whose group is missing here reads as having none. */
		groupNames?: ReadonlyMap<string, string>;
		onviewsecret?: (device: ScannerDevice) => void;
		/** Open the reveal-PIN dialog (PIN is fetched only when the user clicks show/copy there). */
		onviewpin?: (device: ScannerDevice) => void;
		/** Open the set/regenerate-PIN dialog. */
		onsetpin?: (device: ScannerDevice) => void;
	} = $props();

	const deleteMutation = useDeleteScannerDevice();

	let deleteDialogOpen = $state(false);
	let deleteTarget = $state<ScannerDevice | null>(null);

	let editOpen = $state(false);
	let editDeviceId = $state<string | null>(null);
	/** Read from the live list, so the dialog shows fresh PIN state after a refetch. */
	const editDevice = $derived(devices.find((d) => d.device_id === editDeviceId) ?? null);

	/** Bumped on every open: the dialog remounts, so a cancelled edit never comes back. */
	let editSession = $state(0);

	function handleEdit(device: ScannerDevice) {
		editDeviceId = device.device_id;
		editSession += 1;
		editOpen = true;
	}

	function handleDelete(device: ScannerDevice) {
		deleteTarget = device;
		deleteDialogOpen = true;
	}

	function confirmDelete(device: ScannerDevice) {
		deleteMutation.mutate(device.device_id, {
			onSuccess: () => {
				deleteDialogOpen = false;
				toast.success('ลบเครื่องสแกนเรียบร้อยแล้ว');
			},
			onError: (err) => toast.error(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการลบ')
		});
	}

	function groupNameOf(device: ScannerDevice): string | null {
		return (device.banner_group_id && groupNames?.get(device.banner_group_id)) || null;
	}

	function formatLastSeen(lastSeen: string | null): string {
		if (!lastSeen) return 'ยังไม่เคยเชื่อมต่อ';
		const diff = Math.floor((Date.now() - new Date(lastSeen).getTime()) / 1000);
		if (diff < 60) return 'ออนไลน์เมื่อสักครู่';
		if (diff < 3600) return `${Math.floor(diff / 60)} นาทีที่แล้ว`;
		if (diff < 86400) return `${Math.floor(diff / 3600)} ชั่วโมงที่แล้ว`;
		return formatThaiShortDate(lastSeen) || lastSeen;
	}
</script>

<div class="overflow-x-auto">
	<table class="w-full text-left text-sm">
		<thead class="border-b border-slate-200/80 bg-slate-50 text-xs font-semibold text-slate-500">
			<tr>
				<th class="px-6 py-3.5">เครื่องสแกน</th>
				<th class="px-6 py-3.5">ศูนย์พักพิง & จุดบริการ</th>
				<th class="px-6 py-3.5">สถานะ</th>
				<th class="px-6 py-3.5">เชื่อมต่อล่าสุด</th>
				<th class="px-6 py-3.5 text-right"><span class="sr-only">จัดการ</span></th>
			</tr>
		</thead>
		<tbody class="divide-y divide-slate-200/70">
			{#if devices.length === 0}
				<tr>
					<td colspan="5" class="px-6 py-12 text-center text-slate-500">
						<Cpu class="mx-auto mb-2 h-8 w-8 text-slate-300" />
						<p>ยังไม่มีเครื่องสแกนบัตรในระบบ</p>
						<p class="text-xs">กดปุ่ม "ลงทะเบียนเครื่องสแกนใหม่" ด้านบนเพื่อเพิ่มอุปกรณ์</p>
					</td>
				</tr>
			{:else}
				{#each devices as device (device.id)}
					{@const groupName = groupNameOf(device)}
					<tr class="transition-colors hover:bg-slate-50/70">
						<td class="px-6 py-4">
							<div class="flex items-center gap-3">
								<div
									class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#0A2647]/5 text-[#0A2647]"
								>
									<Cpu class="h-5 w-5" />
								</div>
								<div class="min-w-0">
									<p class="font-semibold text-slate-900">{device.name}</p>
									<p class="text-xs text-slate-500 tabular-nums">{device.device_id}</p>
									<span class="badge-muted mt-1">
										{KIOSK_SCREENS[screenTypeOf(device)].label}
										<span class="tabular-nums">{KIOSK_SCREENS[screenTypeOf(device)].size}</span>
									</span>
								</div>
							</div>
						</td>
						<td class="px-6 py-4">
							<div class="flex items-center gap-2">
								<Building class="h-4 w-4 shrink-0 text-slate-400" />
								<div>
									<span class="font-semibold text-slate-900">{device.shelter_code}</span>
									<span class="block text-xs text-slate-500">{device.station_name}</span>
								</div>
							</div>
						</td>
						<td class="px-6 py-4">
							<div class="flex max-w-[22rem] flex-wrap gap-1.5">
								{#if device.status === 'active'}
									<span
										class="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-900"
									>
										<span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
										Active
									</span>
								{:else}
									<span class="badge-muted">
										<span class="h-1.5 w-1.5 rounded-full bg-slate-400"></span>
										Inactive
									</span>
								{/if}
								<!-- A default PIN is flagged only in the จัดการ dialog, to keep the table quiet. -->
								{#if !device.staff_pin_is_default}
									<ScannerPinBadge {device} />
								{/if}
								{#if groupName}
									<span class="badge-accent">
										<ImageIcon class="h-3.5 w-3.5" />
										{groupName}
									</span>
								{:else}
									<span class="badge-muted">
										<ImageOff class="h-3.5 w-3.5" />
										ไม่มีกลุ่มแบนเนอร์
									</span>
								{/if}
							</div>
						</td>
						<td class="px-6 py-4 text-xs whitespace-nowrap text-slate-500">
							<div class="flex items-center gap-1.5">
								<Activity class="h-3.5 w-3.5 text-slate-400" />
								<span>{formatLastSeen(device.last_seen_at)}</span>
							</div>
						</td>
						<td class="px-6 py-4 text-right">
							<Button variant="outline" class="min-h-11 gap-1.5" onclick={() => handleEdit(device)}>
								<Settings2 class="h-4 w-4" />
								จัดการ
								<span class="sr-only">เครื่อง {device.name}</span>
							</Button>
						</td>
					</tr>
				{/each}
			{/if}
		</tbody>
	</table>
</div>

{#if editDevice}
	{#key editSession}
		<EditScannerDialog
			bind:open={editOpen}
			device={editDevice}
			groupName={groupNameOf(editDevice)}
			{onviewsecret}
			{onviewpin}
			{onsetpin}
			ondelete={handleDelete}
		/>
	{/key}
{/if}

<DeleteScannerDialog
	bind:open={deleteDialogOpen}
	device={deleteTarget}
	pending={deleteMutation.isPending}
	onconfirm={confirmDelete}
/>
