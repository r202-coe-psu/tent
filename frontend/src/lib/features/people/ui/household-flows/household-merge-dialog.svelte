<script lang="ts">
	import GitMerge from '@lucide/svelte/icons/git-merge';
	import Search from '@lucide/svelte/icons/search';
	import Users from '@lucide/svelte/icons/users';
	import PawPrint from '@lucide/svelte/icons/paw-print';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import Home from '@lucide/svelte/icons/home';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import { toast } from 'svelte-sonner';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import {
		useHouseholds,
		useMergeHouseholds,
		type Household,
		type Evacuee
	} from '$lib/features/people';
	import { peopleRepository } from '$lib/features/people/data/people.remote';

	let {
		open = $bindable(false),
		targetHouseholdId = null,
		targetHouseholdLabel = '',
		excludeHouseholdId = null,
		onAbsorbIntoForm,
		onMerged
	}: {
		open?: boolean;
		targetHouseholdId?: string | null;
		targetHouseholdLabel?: string;
		excludeHouseholdId?: string | null;
		onAbsorbIntoForm?: (sourceHousehold: Household, members: Evacuee[]) => void;
		onMerged?: (result: { targetHousehold: Household; mergedMembers: Evacuee[] }) => void;
	} = $props();

	let searchQuery = $state('');
	let loadingHhId = $state<string | null>(null);

	const householdsQuery = useHouseholds();
	const allHouseholds = $derived(householdsQuery.data ?? []);
	const mergeMutation = useMergeHouseholds();

	const activeHouseholds = $derived.by(() => {
		const excluded = new Set([targetHouseholdId, excludeHouseholdId].filter(Boolean));
		return allHouseholds.filter((h) => h.status !== 'merged' && h.status !== 'cancelled' && !excluded.has(h._id));
	});

	const searchFilteredHouseholds = $derived.by(() => {
		const q = searchQuery.trim().toLowerCase();
		if (!q) return activeHouseholds.slice(0, 15);
		return activeHouseholds.filter((h) => {
			const label = (h.label || '').toLowerCase();
			const addr = [h.address_no, h.village_no, h.subdistrict, h.district, h.province]
				.filter(Boolean)
				.join(' ')
				.toLowerCase();
			const notes = (h.notes || '').toLowerCase();
			return label.includes(q) || addr.includes(q) || notes.includes(q);
		});
	});

	async function handleSelect(hh: Household) {
		loadingHhId = hh._id;
		try {
			const members = await peopleRepository().listHouseholdMembers(hh._id);

			if (onAbsorbIntoForm) {
				onAbsorbIntoForm(hh, members);
				toast.success(`ดึงสมาชิก ${members.length} คน และสัตว์เลี้ยงมารวมในฟอร์มแล้ว`);
				open = false;
				return;
			}

			if (targetHouseholdId) {
				const ctx = {
					shelterCode: getShelterCode(),
					createdBy: authStore.user?.name ?? 'unknown'
				};
				const result = await mergeMutation.mutateAsync({
					sourceHouseholdId: hh._id,
					targetHouseholdId,
					ctx
				});
				toast.success(`รวมครอบครัวสำเร็จ ย้ายสมาชิก ${result.mergedMembers.length} คน`);
				onMerged?.(result);
				open = false;
			}
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการรวมครอบครัว');
		} finally {
			loadingHhId = null;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-xl max-h-[90vh] flex flex-col">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2 text-base font-bold sm:text-lg">
				<GitMerge class="size-5 text-primary" />
				<span>รวมครอบครัว (Household Merge)</span>
			</Dialog.Title>
			<Dialog.Description class="text-xs text-muted-foreground">
				{#if targetHouseholdLabel}
					เลือกครอบครัวที่จะนำมารวมเข้ากับ <strong class="text-foreground">{targetHouseholdLabel}</strong>
				{:else}
					ค้นหาครอบครัวอื่นเพื่อดึงสมาชิกและสัตว์เลี้ยงมารวมในครอบครัวนี้
				{/if}
			</Dialog.Description>
		</Dialog.Header>

		<div class="relative mt-2">
			<Search class="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
			<Input
				type="search"
				bind:value={searchQuery}
				placeholder="ค้นหาด้วยชื่อครอบครัว หรือ ที่อยู่..."
				class="pl-9 h-10"
			/>
		</div>

		<div class="mt-3 flex-1 overflow-y-auto space-y-2.5 min-h-[220px] max-h-[380px] pr-1">
			{#if householdsQuery.isLoading}
				<div class="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2">
					<Loader2 class="size-6 animate-spin text-primary" />
					<span class="text-xs">กำลังโหลดรายชื่อครอบครัว...</span>
				</div>
			{:else if searchFilteredHouseholds.length === 0}
				<div class="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2">
					<AlertCircle class="size-6" />
					<span class="text-xs">ไม่พบครอบครัวที่ตรงกับคำค้นหา</span>
				</div>
			{:else}
				{#each searchFilteredHouseholds as hh (hh._id)}
					{@const isMerging = loadingHhId === hh._id}
					<div
						class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-border/80 bg-card p-3.5 transition-colors hover:border-primary/40 hover:bg-muted/10"
					>
						<div class="space-y-1">
							<div class="flex items-center gap-2">
								<Home class="size-4 text-primary shrink-0" />
								<span class="text-sm font-bold text-foreground">
									{hh.label || 'ครอบครัว'}
								</span>
								{#if hh.status}
									<Badge variant="outline" class="text-2xs capitalize">
										{hh.status}
									</Badge>
								{/if}
							</div>
							<p class="text-xs text-muted-foreground">
								{[hh.address_no ? `บ้านเลขที่ ${hh.address_no}` : '', hh.residence_landmark, hh.subdistrict, hh.district, hh.province]
									.filter(Boolean)
									.join(' ') || 'ไม่ระบุที่อยู่'}
							</p>
							{#if hh.pets && hh.pets.length > 0}
								<div class="flex items-center gap-1 text-2xs text-muted-foreground">
									<PawPrint class="size-3 text-amber-600" />
									<span>สัตว์เลี้ยง {hh.pets.length} รายการ</span>
								</div>
							{/if}
						</div>

						<Button
							type="button"
							size="sm"
							variant="outline"
							class="shrink-0 min-h-9 gap-1.5 border-primary/40 text-primary hover:bg-primary/10"
							disabled={isMerging || Boolean(loadingHhId)}
							onclick={() => handleSelect(hh)}
						>
							{#if isMerging}
								<Loader2 class="size-3.5 animate-spin" />
								<span>กำลังรวม...</span>
							{:else}
								<GitMerge class="size-3.5" />
								<span>{onAbsorbIntoForm ? 'ดึงมารวม' : 'รวมเข้าครอบครัวนี้'}</span>
							{/if}
						</Button>
					</div>
				{/each}
			{/if}
		</div>

		<Dialog.Footer class="mt-4">
			<Button
				type="button"
				variant="ghost"
				size="sm"
				class="min-h-10"
				onclick={() => (open = false)}
			>
				ปิด
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
