<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { SvelteURLSearchParams } from 'svelte/reactivity';

	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Dialog from '$lib/components/ui/dialog';
	import { RegisteredViaBadge } from '$lib/features/people';

	import {
		CLAIM_DIALOG_DESCRIPTION,
		formatClaimCreatedAt,
		formatOpenMemberDemographicsLine,
		formatOpenMemberIdentityLine,
		formatOpenMemberName,
		formatOpenMemberVulnerableGroup,
		formatOpenPetLabel,
		toggleMemberSelection,
		togglePetSelection,
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
		/** Selected pool hit whose open members/pets can be claimed. */
		hit?: UnassignedRegistrationSearchHit | null;
		/** Optional shelter code forwarded on claim (active Station 1 shelter). */
		shelterCode?: string | null;
	} = $props();

	/** Selection is scoped to the open hit id so switching hits starts empty (CR-113 / #247). */
	let selectedForHitId = $state<string | null>(null);
	let selectedMemberIds = $state<string[]>([]);
	let selectedPetIds = $state<string[]>([]);

	const activeHitId = $derived(hit?.id ?? null);
	const openPets = $derived(hit?.open_pets ?? []);
	const effectiveSelectedIds = $derived(
		selectedForHitId === activeHitId ? selectedMemberIds : ([] as string[])
	);
	const effectiveSelectedPetIds = $derived(
		selectedForHitId === activeHitId ? selectedPetIds : ([] as string[])
	);
	const canClaim = $derived(effectiveSelectedIds.length > 0 || effectiveSelectedPetIds.length > 0);

	function setMemberChecked(memberId: string, checked: boolean | 'indeterminate') {
		if (!activeHitId) return;
		const baseMembers = selectedForHitId === activeHitId ? selectedMemberIds : [];
		const basePets = selectedForHitId === activeHitId ? selectedPetIds : [];
		selectedForHitId = activeHitId;
		selectedMemberIds = toggleMemberSelection(baseMembers, memberId, checked === true);
		selectedPetIds = basePets;
	}

	function setPetChecked(petId: string, checked: boolean | 'indeterminate') {
		if (!activeHitId) return;
		const baseMembers = selectedForHitId === activeHitId ? selectedMemberIds : [];
		const basePets = selectedForHitId === activeHitId ? selectedPetIds : [];
		selectedForHitId = activeHitId;
		selectedMemberIds = baseMembers;
		selectedPetIds = togglePetSelection(basePets, petId, checked === true);
	}

	function closeDialog() {
		open = false;
		hit = null;
		selectedForHitId = null;
		selectedMemberIds = [];
		selectedPetIds = [];
	}

	/**
	 * Selection only — claim itself does not happen here anymore (CR-140 addendum).
	 * Navigate to the review page, which loads this same registration fresh from Mongo
	 * and only calls claim + Report-in when staff confirm there.
	 */
	async function goToReview() {
		if (!hit || (effectiveSelectedIds.length === 0 && effectiveSelectedPetIds.length === 0)) {
			return;
		}
		const registrationId = hit.id;
		const params = new SvelteURLSearchParams();
		if (effectiveSelectedIds.length > 0) params.set('memberIds', effectiveSelectedIds.join(','));
		if (effectiveSelectedPetIds.length > 0) params.set('petIds', effectiveSelectedPetIds.join(','));
		if (shelterCode) params.set('shelterCode', shelterCode);
		const path = resolve(
			`/onsite/unassigned/${registrationId}/report-in` as `/onsite/unassigned/${string}/report-in`
		);
		closeDialog();
		await goto(`${path}?${params.toString()}`);
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
			<Dialog.Title>เลือกรายการจากคิวกลาง</Dialog.Title>
			<Dialog.Description>
				{CLAIM_DIALOG_DESCRIPTION}
			</Dialog.Description>
		</Dialog.Header>
		{#if hit}
			<div class="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden text-sm">
				<div class="rounded-xl border border-slate-200/80 bg-white p-3">
					<div class="mb-2 flex flex-wrap items-center gap-2">
						<UnassignedQueueBadge />
						<RegisteredViaBadge via={hit.registered_via} />
					</div>
					<p class="text-xs font-semibold text-slate-500">ลงทะเบียนเมื่อ</p>
					<p class="text-slate-900 tabular-nums">{formatClaimCreatedAt(hit.created_at)}</p>
				</div>
				<div class="min-h-0 flex-1 space-y-4 overflow-y-auto">
					{#if hit.open_members.length > 0}
						<div>
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
											<div class="min-w-0 flex-1 space-y-1">
												<p class="font-medium text-slate-900">{formatOpenMemberName(member)}</p>
												<p class="text-xs text-muted-foreground tabular-nums">
													{formatOpenMemberIdentityLine(member)}
												</p>
												<p class="text-xs text-muted-foreground">
													{formatOpenMemberDemographicsLine(member)}
												</p>
												{#if member.vulnerable_groups.length > 0 || member.special_needs.length > 0}
													<div class="flex flex-wrap gap-1.5 pt-0.5">
														{#each member.vulnerable_groups as code (code)}
															<span
																class="rounded-md border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-xs text-rose-900"
															>
																{formatOpenMemberVulnerableGroup(code)}
															</span>
														{/each}
														{#each member.special_needs as need (need)}
															<span
																class="rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-xs text-amber-900"
															>
																{need}
															</span>
														{/each}
													</div>
												{/if}
											</div>
										</div>
									</li>
								{/each}
							</ul>
						</div>
					{/if}
					{#if openPets.length > 0}
						<div>
							<p class="mb-2 text-sm font-semibold text-slate-900">สัตว์เลี้ยงที่ยัง open</p>
							<ul class="space-y-2">
								{#each openPets as pet (pet.pet_id)}
									<li class="rounded-xl border border-slate-200/80 bg-white px-3 py-2">
										<div class="flex items-start gap-3">
											<Checkbox
												checked={effectiveSelectedPetIds.includes(pet.pet_id)}
												onCheckedChange={(v) => setPetChecked(pet.pet_id, v)}
												class="mt-1"
												aria-label={`เลือก ${formatOpenPetLabel(pet)}`}
											/>
											<div class="min-w-0 flex-1">
												<p class="font-medium text-slate-900">{formatOpenPetLabel(pet)}</p>
												{#if pet.has_cage}
													<p class="text-xs text-muted-foreground">มีกรง</p>
												{/if}
											</div>
										</div>
									</li>
								{/each}
							</ul>
						</div>
					{/if}
				</div>
				<div class="flex flex-col gap-2 border-t border-slate-200/80 pt-3">
					<p class="text-xs text-muted-foreground">
						เลือกแล้ว {effectiveSelectedIds.length} / {hit.open_members.length} คน
						{#if openPets.length > 0}
							· {effectiveSelectedPetIds.length} / {openPets.length} สัตว์
						{/if}
						· ที่ไม่ติ๊กยังคง open ในคิวกลาง
					</p>
					<Button type="button" disabled={!canClaim} onclick={goToReview} class="w-full">
						ตรวจสอบรายละเอียด →
					</Button>
				</div>
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>
