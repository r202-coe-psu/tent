<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Dialog from '$lib/components/ui/dialog';

	import {
		CLAIM_FLOW_STATUS_GUIDANCE,
		formatOpenMemberName,
		pickReportInEvacueeId,
		toggleMemberSelection,
		useClaimUnassignedRegistration,
		type UnassignedRegistrationSearchHit
	} from '../application/queries';
	import UnassignedQueueBadge from './unassigned-queue-badge.svelte';

	let {
		open = $bindable(false),
		hit = $bindable(null as UnassignedRegistrationSearchHit | null),
		shelterCode = null
	}: {
		/** Controlled open state — parent opens; dialog closes on cancel/success. */
		open?: boolean;
		/** Selected pool hit whose open members can be claimed. */
		hit?: UnassignedRegistrationSearchHit | null;
		/** Optional shelter code forwarded on claim (active Station 1 shelter). */
		shelterCode?: string | null;
	} = $props();

	/** Selection is scoped to the open hit id so switching hits starts empty (CR-113 / #247). */
	let selectedForHitId = $state<string | null>(null);
	let selectedMemberIds = $state<string[]>([]);

	const claimMutation = useClaimUnassignedRegistration();

	const activeHitId = $derived(hit?.id ?? null);
	const effectiveSelectedIds = $derived(
		selectedForHitId === activeHitId ? selectedMemberIds : ([] as string[])
	);
	const canClaim = $derived(effectiveSelectedIds.length > 0 && !claimMutation.isPending);

	function setMemberChecked(memberId: string, checked: boolean | 'indeterminate') {
		if (!activeHitId) return;
		const base = selectedForHitId === activeHitId ? selectedMemberIds : [];
		selectedForHitId = activeHitId;
		selectedMemberIds = toggleMemberSelection(base, memberId, checked === true);
	}

	function closeDialog() {
		open = false;
		hit = null;
		selectedForHitId = null;
		selectedMemberIds = [];
	}

	async function submitClaim() {
		if (!hit || effectiveSelectedIds.length === 0) return;
		const registrationId = hit.id;
		const memberIds = [...effectiveSelectedIds];
		try {
			const result = await claimMutation.mutateAsync({
				registrationId,
				payload: {
					member_ids: memberIds,
					...(shelterCode ? { shelter_code: shelterCode } : {})
				}
			});
			const reportInId = pickReportInEvacueeId(result.evacuee_ids);
			closeDialog();
			if (reportInId) {
				await goto(
					resolve(`/onsite/people/${reportInId}/report-in` as `/onsite/people/${string}/report-in`)
				);
			}
			// else: stay on caller page — mutation toast + peopleKeys invalidate already ran
		} catch {
			// toast handled in mutation onError
		}
	}
</script>

<Dialog.Root
	bind:open
	onOpenChange={(next) => {
		if (!next) closeDialog();
	}}
>
	<Dialog.Content class="flex max-h-[90vh] flex-col gap-4 sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>รับเข้าศูนย์ (claim)</Dialog.Title>
			<Dialog.Description>
				{CLAIM_FLOW_STATUS_GUIDANCE}
			</Dialog.Description>
		</Dialog.Header>
		{#if hit}
			<div class="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden text-sm">
				<div class="rounded-xl border border-slate-200/80 bg-white p-3">
					<div class="mb-2">
						<UnassignedQueueBadge />
					</div>
					<p class="text-xs font-semibold text-slate-500">รหัสเอกสาร</p>
					<p class="break-all text-slate-900 tabular-nums">{hit.id}</p>
					<p class="mt-2 text-xs font-semibold text-slate-500">ครัวเรือนสำรอง</p>
					<p class="break-all text-slate-900 tabular-nums">{hit.reserved_household_id}</p>
				</div>
				<div class="min-h-0 flex-1 overflow-y-auto">
					<p class="mb-2 text-sm font-semibold text-slate-900">สมาชิกที่ยัง open</p>
					<ul class="space-y-2">
						{#each hit.open_members as member (member.reserved_evacuee_id)}
							<li class="rounded-xl border border-slate-200/80 bg-white px-3 py-2">
								<div class="flex items-start gap-3">
									<Checkbox
										checked={effectiveSelectedIds.includes(member.reserved_evacuee_id)}
										onCheckedChange={(v) => setMemberChecked(member.reserved_evacuee_id, v)}
										class="mt-1"
										aria-label={`เลือก ${formatOpenMemberName(member)}`}
									/>
									<div class="min-w-0 flex-1">
										<p class="font-medium text-slate-900">{formatOpenMemberName(member)}</p>
										<p class="text-xs text-muted-foreground tabular-nums">
											{member.phone ?? 'ไม่มีเบอร์'} · {member.person_id?.number ?? 'ไม่มีเลขบัตร'}
										</p>
									</div>
								</div>
							</li>
						{/each}
					</ul>
				</div>
				<div class="flex flex-col gap-2 border-t border-slate-200/80 pt-3">
					<p class="text-xs text-muted-foreground">
						เลือกแล้ว {effectiveSelectedIds.length} / {hit.open_members.length} คน · คนที่ไม่ติ๊กยังคง
						open ในคิวกลาง
					</p>
					<Button type="button" disabled={!canClaim} onclick={submitClaim} class="w-full">
						{#if claimMutation.isPending}
							กำลังรับเข้าศูนย์...
						{:else}
							ยืนยันรับเข้าศูนย์
						{/if}
					</Button>
				</div>
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>
