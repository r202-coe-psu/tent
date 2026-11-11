<script lang="ts">
	import { useQueryClient } from '@tanstack/svelte-query';
	import { toast } from 'svelte-sonner';
	import Ambulance from '@lucide/svelte/icons/ambulance';
	import Building2 from '@lucide/svelte/icons/building-2';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Send from '@lucide/svelte/icons/send';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import type { Referral, ReferralExternal } from '../domain/referral.schema';
	import {
		useCancelM5Batch,
		useIntegrationStatus,
		useStartM5Batch,
		useSubmitM5Batch
	} from '../application/m5-queries';
	import { M5_STATUS_META, M5_TONE_BADGE, m5ErrorMessage } from './referral.m5.ui';
	import M5GateAlert from './m5-gate-alert.svelte';

	let { members }: { members: Referral[] } = $props();

	const queryClient = useQueryClient();
	const statusQuery = useIntegrationStatus();
	const submitMutation = useSubmitM5Batch(queryClient);
	const startMutation = useStartM5Batch(queryClient);
	const cancelMutation = useCancelM5Batch(queryClient);

	type M5Member = Referral & { batch_id?: string; external?: ReferralExternal };
	const m5Members = $derived(members as M5Member[]);
	const batchId = $derived(m5Members.find((m) => m.batch_id)?.batch_id ?? '');
	const external = $derived(m5Members.map((m) => m.external).find(Boolean));
	const drafts = $derived(m5Members.filter((m) => m.status === 'draft'));
	const sent = $derived(m5Members.filter((m) => m.status === 'sent'));
	const accepted = $derived(m5Members.some((m) => m.status === 'accepted'));
	const open = $derived([...drafts, ...sent]);
	const gateState = $derived(statusQuery.data?.m5.state);
	const gateReady = $derived(gateState === 'ready');
	const gateBlocked = $derived(gateState && gateState !== 'ready' ? gateState : null);
	const busy = $derived(
		submitMutation.isPending || startMutation.isPending || cancelMutation.isPending
	);
	const statusMeta = $derived(external ? M5_STATUS_META[external.status] : null);
	const destination = $derived(m5Members[0]?.to_org?.name ?? '');

	let cancelOpen = $state(false);
	let cancelReason = $state('');
	let removeIds = $state<string[]>([]);

	function memberName(m: Referral): string {
		const s = m.evacuee_summary;
		return s ? `${s.first_name} ${s.last_name}`.trim() : m.evacuee_id;
	}

	async function submit() {
		try {
			const res = await submitMutation.mutateAsync(batchId);
			if (res.failed.length) {
				toast.warning(`ส่งไป M5 แล้ว (${res.code}) แต่บันทึกบางใบไม่สำเร็จ ระบบจะซ่อมให้อัตโนมัติ`);
			} else {
				toast.success(`ส่งไป M5 แล้ว (${res.code}) รอ สธ. พิจารณา`);
			}
		} catch (e: unknown) {
			toast.error(m5ErrorMessage(e));
		}
	}

	async function start() {
		try {
			await startMutation.mutateAsync(batchId);
			toast.success('แจ้งรถออกแล้ว');
		} catch (e: unknown) {
			toast.error(m5ErrorMessage(e));
		}
	}

	async function confirmCancel() {
		const reason = cancelReason.trim();
		if (!reason) {
			toast.error('กรุณาระบุเหตุผลที่ถอนคำขอ');
			return;
		}
		try {
			const res = await cancelMutation.mutateAsync({
				batchId,
				reason,
				...(removeIds.length ? { resubmitWithout: removeIds } : {})
			});
			cancelOpen = false;
			toast.success(
				res.new_batch_id
					? 'ถอนชุดเดิมแล้ว และสร้างร่างชุดใหม่ไว้ในรายการส่งต่อ ตรวจแล้วกดส่งอีกครั้ง'
					: 'ถอนคำขอทั้งชุดแล้ว'
			);
		} catch (e: unknown) {
			toast.error(m5ErrorMessage(e));
		}
	}

	function toggleRemove(id: string, checked: boolean | 'indeterminate') {
		removeIds = checked === true ? [...removeIds, id] : removeIds.filter((x) => x !== id);
	}
</script>

<Card.Root class="rounded-xl border border-slate-200/80 bg-white shadow-2xs">
	<Card.Header class="space-y-2">
		<div class="flex flex-wrap items-center justify-between gap-2">
			<Card.Title class="text-lg font-bold text-slate-900">ส่งต่อผ่าน M5</Card.Title>
			{#if statusMeta}
				<span
					class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold {M5_TONE_BADGE[
						statusMeta.tone
					]}"
				>
					<Ambulance class="h-3.5 w-3.5" aria-hidden="true" />
					{statusMeta.label}
				</span>
			{:else}
				<span
					class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold {M5_TONE_BADGE.muted}"
				>
					ร่าง ยังไม่ได้ส่ง
				</span>
			{/if}
		</div>
		<Card.Description class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
			<span class="inline-flex items-center gap-1.5">
				<Building2 class="h-4 w-4" aria-hidden="true" />
				{destination}
			</span>
			{#if external}
				<span>เลขใบส่งต่อ <span class="font-semibold tabular-nums">{external.code}</span></span>
			{/if}
		</Card.Description>
	</Card.Header>
	<Card.Content class="space-y-4">
		{#if external?.review && (external.review.note || external.review.by)}
			<div class="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
				<span class="font-semibold">ผลพิจารณาของ สธ.</span>
				{#if external.review.by}<span> · {external.review.by}</span>{/if}
				{#if external.review.note}<p class="mt-1">{external.review.note}</p>{/if}
			</div>
		{/if}
		{#if external?.original_m5_facility_id !== undefined}
			<p class="text-sm text-slate-700">สธ. เปลี่ยนโรงพยาบาลปลายทางตอนอนุมัติ</p>
		{/if}
		{#if accepted && external?.status === 'pending'}
			<p class="flex items-start gap-2 text-sm text-slate-700">
				<CircleAlert class="mt-0.5 h-4 w-4 shrink-0 text-sky-700" aria-hidden="true" />
				สธ. อนุมัติแล้ว หากต้องยกเลิกให้โทรประสาน สธ.
			</p>
		{/if}

		{#if gateBlocked && (drafts.length || sent.length || external?.status === 'pending')}
			<M5GateAlert
				state={gateBlocked}
				checking={statusQuery.isFetching}
				onRetry={() => statusQuery.refetch()}
			/>
		{/if}

		<div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
			{#if drafts.length}
				<Button class="h-11 gap-2" disabled={busy || !gateReady || !batchId} onclick={submit}>
					<Send class="h-4 w-4" aria-hidden="true" />
					ส่งไป M5 ({drafts.length} คน)
				</Button>
			{/if}
			{#if external?.status === 'pending'}
				<Button class="h-11 gap-2" disabled={busy || !gateReady} onclick={start}>
					<Ambulance class="h-4 w-4" aria-hidden="true" />
					แจ้งรถออก
				</Button>
			{/if}
			{#if open.length && !accepted}
				<Button
					variant="outline"
					class="h-11 gap-2 border-red-200 text-red-700 hover:bg-red-50"
					disabled={busy || (sent.length > 0 && !gateReady)}
					onclick={() => {
						cancelReason = '';
						removeIds = [];
						cancelOpen = true;
					}}
				>
					<Undo2 class="h-4 w-4" aria-hidden="true" />
					{sent.length ? 'ถอนคำขอทั้งชุด' : 'ยกเลิกร่างทั้งชุด'}
				</Button>
			{/if}
		</div>
	</Card.Content>
</Card.Root>

<Dialog.Root bind:open={cancelOpen}>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{sent.length ? 'ถอนคำขอทั้งชุด' : 'ยกเลิกร่างทั้งชุด'}</Dialog.Title>
			<Dialog.Description>
				ผู้ป่วยทุกคนในชุด ({open.length} คน) จะถูกปิดรายการ
				{#if sent.length}M5 ถอนใบได้ทั้งใบเท่านั้น{/if}
			</Dialog.Description>
		</Dialog.Header>
		<div class="space-y-4">
			<div class="space-y-1.5">
				<Label for="m5-cancel-reason" class="text-sm font-semibold text-slate-700">
					เหตุผล <span class="text-red-600">*</span>
				</Label>
				<Textarea id="m5-cancel-reason" rows={2} bind:value={cancelReason} />
			</div>
			{#if open.length > 1}
				<fieldset class="space-y-2">
					<legend class="text-sm font-semibold text-slate-700">
						เอาผู้ป่วยออกแล้วสร้างร่างชุดใหม่จากคนที่เหลือ (ไม่บังคับ)
					</legend>
					{#each open as m (m._id)}
						<div class="flex min-h-11 items-center gap-3">
							<Checkbox
								id="m5-remove-{m._id}"
								checked={removeIds.includes(m._id)}
								onCheckedChange={(c) => toggleRemove(m._id, c)}
							/>
							<Label for="m5-remove-{m._id}" class="text-sm font-normal text-slate-700">
								{memberName(m)}
							</Label>
						</div>
					{/each}
				</fieldset>
			{/if}
		</div>
		<Dialog.Footer class="gap-2">
			<Button variant="outline" class="h-11" onclick={() => (cancelOpen = false)}>ปิด</Button>
			<Button
				class="h-11 bg-red-600 text-white hover:bg-red-700"
				disabled={cancelMutation.isPending}
				onclick={confirmCancel}
			>
				ยืนยันถอนทั้งชุด
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
