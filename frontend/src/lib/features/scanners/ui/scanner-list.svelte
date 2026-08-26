<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Cpu from '@lucide/svelte/icons/cpu';
	import Building from '@lucide/svelte/icons/building';
	import Activity from '@lucide/svelte/icons/activity';
	import type { ScannerDevice } from '../domain/scanner.schema';
	import { useDeleteScannerDevice, useUpdateScannerDevice } from '../application/queries';
	import { toast } from 'svelte-sonner';

	let {
		devices = []
	}: {
		devices: ScannerDevice[];
	} = $props();

	const deleteMutation = useDeleteScannerDevice();
	const updateMutation = useUpdateScannerDevice();

	function handleDelete(device: ScannerDevice) {
		if (confirm(`คุณต้องการลบเครื่องสแกน "${device.name}" (${device.device_id}) หรือไม่?`)) {
			deleteMutation.mutate(device._id, {
				onSuccess: () => toast.success('ลบเครื่องสแกนเรียบร้อยแล้ว'),
				onError: (err) => toast.error(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการลบ')
			});
		}
	}

	function handleToggleStatus(device: ScannerDevice) {
		const nextStatus = device.status === 'active' ? 'inactive' : 'active';
		updateMutation.mutate(
			{ id: device._id, patch: { status: nextStatus } },
			{
				onSuccess: () => toast.success(`เปลี่ยนสถานะเป็น ${nextStatus} เรียบร้อย`),
				onError: (err) => toast.error(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด')
			}
		);
	}

	function formatLastSeen(lastSeen: string | null): string {
		if (!lastSeen) return 'ยังไม่เคยเชื่อมต่อ';
		const diff = Math.floor((Date.now() - new Date(lastSeen).getTime()) / 1000);
		if (diff < 60) return 'ออนไลน์เมื่อสักครู่';
		if (diff < 3600) return `${Math.floor(diff / 60)} นาทีที่แล้ว`;
		if (diff < 86400) return `${Math.floor(diff / 3600)} ชั่วโมงที่แล้ว`;
		return new Date(lastSeen).toLocaleDateString('th-TH');
	}
</script>

<div class="overflow-x-auto">
	<table class="w-full text-left text-sm">
		<thead
			class="border-b border-border bg-muted/40 text-xs font-semibold text-muted-foreground uppercase"
		>
			<tr>
				<th class="px-6 py-4">เครื่องสแกน / รหัสอุปกรณ์</th>
				<th class="px-6 py-4">ศูนย์พักพิง & จุดบริการ</th>
				<th class="px-6 py-4">API Secret Prefix</th>
				<th class="px-6 py-4">สถานะ</th>
				<th class="px-6 py-4">การเชื่อมต่อล่าสุด</th>
				<th class="px-6 py-4 text-right">จัดการ</th>
			</tr>
		</thead>
		<tbody class="divide-y divide-border/60">
			{#if devices.length === 0}
				<tr>
					<td colspan="6" class="px-6 py-12 text-center text-muted-foreground">
						<Cpu class="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
						<p>ยังไม่มีเครื่องสแกนบัตรในระบบ</p>
						<p class="text-xs">กดปุ่ม "ลงทะเบียนเครื่องสแกน" ด้านบนเพื่อเพิ่มอุปกรณ์</p>
					</td>
				</tr>
			{:else}
				{#each devices as device (device._id)}
					<tr class="transition-colors hover:bg-muted/20">
						<td class="px-6 py-4">
							<div class="flex items-center gap-3">
								<div
									class="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary"
								>
									<Cpu class="h-5 w-5" />
								</div>
								<div>
									<p class="font-semibold text-foreground">{device.name}</p>
									<p class="font-mono text-xs text-muted-foreground">{device.device_id}</p>
								</div>
							</div>
						</td>
						<td class="px-6 py-4">
							<div class="flex items-center gap-2">
								<Building class="h-4 w-4 text-muted-foreground" />
								<div>
									<span class="font-semibold text-foreground">{device.shelter_code}</span>
									<span class="block text-xs text-muted-foreground">{device.station_name}</span>
								</div>
							</div>
						</td>
						<td class="px-6 py-4">
							<code class="rounded bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
								{device.secret_prefix}
							</code>
						</td>
						<td class="px-6 py-4">
							{#if device.status === 'active'}
								<button
									onclick={() => handleToggleStatus(device)}
									class="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-600 hover:bg-emerald-500/20"
								>
									<span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
									Active
								</button>
							{:else}
								<button
									onclick={() => handleToggleStatus(device)}
									class="inline-flex items-center gap-1.5 rounded-full border border-zinc-500/30 bg-zinc-500/10 px-2.5 py-0.5 text-xs font-semibold text-zinc-500 hover:bg-zinc-500/20"
								>
									<span class="h-1.5 w-1.5 rounded-full bg-zinc-400"></span>
									Inactive
								</button>
							{/if}
						</td>
						<td class="px-6 py-4 text-xs text-muted-foreground">
							<div class="flex items-center gap-1.5">
								<Activity class="h-3.5 w-3.5 text-muted-foreground" />
								<span>{formatLastSeen(device.last_seen_at)}</span>
							</div>
						</td>
						<td class="px-6 py-4 text-right">
							<Button
								variant="ghost"
								size="sm"
								class="text-destructive hover:bg-destructive/10 hover:text-destructive"
								onclick={() => handleDelete(device)}
							>
								<Trash2 class="h-4 w-4" />
							</Button>
						</td>
					</tr>
				{/each}
			{/if}
		</tbody>
	</table>
</div>
