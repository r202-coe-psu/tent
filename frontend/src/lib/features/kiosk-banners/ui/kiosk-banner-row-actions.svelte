<script lang="ts">
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import {
		useDeleteKioskBanner,
		useSetKioskBannerStatus
	} from '../application/kiosk-banner.queries';
	import type { KioskBannerSummary } from '../data/kiosk-banner.repository';

	/**
	 * Per-row actions for one banner: show/hide switch (or the「หมดอายุ」badge), edit link and
	 * delete with its own confirm dialog.
	 */
	let { banner, expired = false }: { banner: KioskBannerSummary; expired?: boolean } = $props();

	const setStatus = useSetKioskBannerStatus();
	const remove = useDeleteKioskBanner();

	let deleteOpen = $state(false);

	function handleToggle(show: boolean) {
		setStatus.mutate(
			{ id: banner._id, rev: banner._rev, status: show ? 'active' : 'inactive' },
			{
				onSuccess: () =>
					toast.success(show ? 'เปิดการแสดงแบนเนอร์บนตู้แล้ว' : 'ปิดการแสดงแบนเนอร์บนตู้แล้ว')
			}
		);
	}

	function confirmDelete() {
		remove.mutate(
			{ id: banner._id, rev: banner._rev },
			{
				onSuccess: () => {
					deleteOpen = false;
					toast.success(`ลบแบนเนอร์ "${banner.title}" แล้ว`);
				}
			}
		);
	}

	const editHref = $derived(
		resolve(`/back-office/kiosks/banners/${encodeURIComponent(banner._id)}`)
	);
</script>

<div class="flex items-center justify-end gap-1">
	{#if expired}
		<span class="badge-muted mr-1">หมดอายุ</span>
	{:else}
		<div class="mr-1 flex min-h-11 items-center gap-2">
			<Switch
				id="banner-status-{banner._id}"
				bind:checked={() => banner.status === 'active', (next) => handleToggle(next)}
				disabled={setStatus.isPending}
				aria-label="แสดง {banner.title} บนตู้"
			/>
			<label for="banner-status-{banner._id}" class="text-sm font-medium text-slate-700">
				{banner.status === 'active' ? 'แสดงบนตู้' : 'ไม่แสดง'}
			</label>
		</div>
	{/if}
	<Button
		variant="ghost"
		size="sm"
		class="min-h-11 min-w-11 p-0 text-primary hover:bg-primary/10"
		href={editHref}
		title="แก้ไขแบนเนอร์"
	>
		<Pencil class="h-4 w-4" />
		<span class="sr-only">แก้ไขแบนเนอร์ {banner.title}</span>
	</Button>
	<Button
		variant="ghost"
		size="sm"
		data-testid="delete-banner"
		class="min-h-11 min-w-11 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
		onclick={() => (deleteOpen = true)}
		title="ลบแบนเนอร์"
	>
		<Trash2 class="h-4 w-4" />
		<span class="sr-only">ลบแบนเนอร์ {banner.title}</span>
	</Button>
</div>

<AlertDialog.Root bind:open={deleteOpen}>
	<AlertDialog.Content class="max-w-md">
		<AlertDialog.Header>
			<div class="flex items-center gap-2 text-destructive">
				<TriangleAlert class="size-5 shrink-0" />
				<AlertDialog.Title>ยืนยันการลบแบนเนอร์</AlertDialog.Title>
			</div>
			<AlertDialog.Description class="space-y-2 pt-2 text-sm">
				<span class="block">
					ลบแบนเนอร์ <span class="font-semibold text-foreground">{banner.title}</span>
				</span>
				<span class="block font-medium text-destructive">
					ลบแล้วย้อนกลับไม่ได้ ตู้ kiosk จะเลิกแสดงแบนเนอร์นี้เมื่อรีเฟรชข้อมูลรอบถัดไป
				</span>
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={remove.isPending}>ยกเลิก</AlertDialog.Cancel>
			<AlertDialog.Action
				class="text-destructive-foreground bg-destructive hover:bg-destructive/90"
				disabled={remove.isPending}
				onclick={confirmDelete}
			>
				{remove.isPending ? 'กำลังลบ...' : 'ลบแบนเนอร์'}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
