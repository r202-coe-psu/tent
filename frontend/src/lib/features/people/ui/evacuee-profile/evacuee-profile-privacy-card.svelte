<script lang="ts">
	import { toast } from 'svelte-sonner';
	import Search from '@lucide/svelte/icons/search';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { CONSENT_COPY } from '$lib/features/consent/server';
	import type { AuthorContext } from '$lib/db/model';
	import type { Evacuee } from '../../domain/people';
	import { showingNeedsFullNotice } from '../../domain/search-visibility';
	import { useSetSearchVisibility } from '../../application/queries';

	let {
		evacuee,
		readonly,
		getAuthorContext
	}: {
		evacuee: Evacuee;
		readonly: boolean;
		getAuthorContext: () => AuthorContext;
	} = $props();

	const mutation = useSetSearchVisibility();

	const visible = $derived(!evacuee.privacy?.search_excluded);
	let pending = $state<boolean | null>(null);
	const dialogOpen = $derived(pending !== null);
	const needsNotice = $derived(pending !== null && showingNeedsFullNotice(evacuee, pending));

	function confirm() {
		if (pending === null) return;
		const next = pending;
		let ctx: AuthorContext;
		try {
			ctx = getAuthorContext();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'ไม่พบผู้ใช้งานปัจจุบัน');
			return;
		}
		mutation.mutate(
			{ evacueeId: evacuee._id, visible: next, ctx },
			{
				onSuccess: () => {
					toast.success(next ? 'เปิดการแสดงในระบบค้นหาญาติแล้ว' : 'ซ่อนจากระบบค้นหาญาติแล้ว');
					pending = null;
				},
				onError: (err) => {
					toast.error(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ');
				}
			}
		);
	}
</script>

<section class="space-y-3 rounded-xl border border-slate-200/80 bg-white p-5 shadow-2xs">
	<div class="flex items-center gap-2.5 border-b border-slate-200/80 pb-2">
		<Search class="size-4.5 text-[#0A2647]" />
		<h3 class="text-base font-bold text-slate-900">ความเป็นส่วนตัว</h3>
	</div>
	<div class="flex items-center justify-between gap-4">
		<div class="min-w-0 space-y-0.5">
			<Label for="search-visibility" class="text-sm font-semibold text-slate-700">
				แสดงในระบบค้นหาญาติ
			</Label>
			<p class="text-sm text-slate-500">
				{visible ? 'ญาติค้นหาชื่อและศูนย์ที่พักได้' : 'ซ่อนจากระบบค้นหาญาติ'}
			</p>
		</div>
		<Switch
			id="search-visibility"
			disabled={readonly || mutation.isPending}
			bind:checked={() => visible, (next) => (pending = next)}
		/>
	</div>
</section>

<AlertDialog.Root
	bind:open={() => dialogOpen, (open) => !open && !mutation.isPending && (pending = null)}
>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>
				{pending ? 'แสดงในระบบค้นหาญาติ?' : 'ซ่อนจากระบบค้นหาญาติ?'}
			</AlertDialog.Title>
			<AlertDialog.Description>
				ยืนยันว่าเจ้าตัวเป็นผู้ขอเปลี่ยนการตั้งค่านี้ด้วยตนเอง
			</AlertDialog.Description>
		</AlertDialog.Header>
		{#if needsNotice}
			<div class="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
				<p class="font-semibold text-slate-900">{CONSENT_COPY.heading}</p>
				<p class="text-slate-700">{CONSENT_COPY.main.full}</p>
				<p class="text-slate-700">{CONSENT_COPY.search.full}</p>
				<p class="text-slate-500">
					เมื่อยืนยัน การลงทะเบียนของผู้นี้จะเปลี่ยนเป็น「{CONSENT_COPY.summary.modeFull}」
					โดยยังไม่เก็บข้อมูลสุขภาพ
				</p>
			</div>
		{/if}
		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={mutation.isPending}>ยกเลิก</AlertDialog.Cancel>
			<AlertDialog.Action
				onclick={(e) => {
					e.preventDefault();
					confirm();
				}}
				disabled={mutation.isPending}
			>
				{mutation.isPending ? 'กำลังบันทึก…' : needsNotice ? 'เจ้าตัวรับทราบและยืนยัน' : 'ยืนยัน'}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
