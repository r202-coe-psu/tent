<script lang="ts">
	import X from '@lucide/svelte/icons/x';
	import Search from '@lucide/svelte/icons/search';
	import Trash from '@lucide/svelte/icons/trash';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { checkEvacueeHouseholdConflict } from '../index';
	import type { Evacuee, Household } from '../domain/people';

	let {
		show,
		household,
		members,
		allEvacuees,
		allHouseholds,
		onClose,
		onAddMember,
		onRemoveMember
	}: {
		show: boolean;
		household: Household;
		members: Evacuee[];
		allEvacuees: Evacuee[];
		allHouseholds: Household[];
		onClose: () => void;
		onAddMember: (evacuee: Evacuee) => Promise<void>;
		onRemoveMember: (evacuee: Evacuee) => Promise<void>;
	} = $props();

	let searchQuery = $state('');

	const searchCandidates = $derived.by(() => {
		const q = searchQuery.trim().toLowerCase();
		if (!q) return [];
		return allEvacuees.filter((e) => {
			if (e.household_id === household._id) return false; // already in this hh
			const conflict = checkEvacueeHouseholdConflict(e, household._id, allHouseholds, allEvacuees);
			if (conflict.conflicted) return false;
			return (
				e.first_name.toLowerCase().includes(q) ||
				e.last_name.toLowerCase().includes(q) ||
				`${e.first_name} ${e.last_name}`.toLowerCase().includes(q) ||
				(e.nickname && e.nickname.toLowerCase().includes(q)) ||
				(e.phone && e.phone.includes(q)) ||
				(e.person_id?.number && e.person_id.number.includes(q))
			);
		});
	});
</script>

{#if show}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-xs"
	>
		<div
			class="w-full max-w-2xl animate-in space-y-4 rounded-3xl border border-border bg-card p-6 shadow-xl duration-150 zoom-in-95 fade-in"
		>
			<div class="flex items-center justify-between border-b border-border pb-2.5">
				<h3 class="text-lg font-bold text-slate-900 dark:text-slate-50">
					จัดการสมาชิกในครัวเรือน (Manage Members)
				</h3>
				<button
					onclick={() => {
						searchQuery = '';
						onClose();
					}}
					class="cursor-pointer rounded-lg p-1 text-muted-foreground transition-colors hover:text-foreground"
				>
					<X class="size-5" />
				</button>
			</div>

			<div class="grid grid-cols-1 gap-6 md:grid-cols-2">
				<!-- Current Members List -->
				<div class="space-y-2.5">
					<h4 class="text-xs font-bold text-slate-700 uppercase">รายชื่อสมาชิกปัจจุบัน</h4>
					<div class="max-h-[300px] space-y-2 overflow-y-auto pr-1">
						{#each members as m (m._id)}
							<div class="flex items-center justify-between border-b border-border/50 pb-2">
								<div class="min-w-0 pr-2">
									<p class="truncate text-sm font-semibold text-slate-800">
										{m.first_name}
										{m.last_name}
									</p>
									<p class="text-[10px] text-muted-foreground">
										{#if m._id === household.head_evacuee_id}
											<Badge class="bg-green-600 px-1 py-0 text-[9px] text-white">หัวหน้า</Badge>
										{:else}
											สมาชิก
										{/if}
									</p>
								</div>

								{#if m._id !== household.head_evacuee_id}
									<Button
										variant="ghost"
										size="sm"
										class="h-7 w-7 p-0 text-destructive hover:bg-destructive/10"
										onclick={() => onRemoveMember(m)}
									>
										<Trash class="size-4" />
									</Button>
								{/if}
							</div>
						{/each}
					</div>
				</div>

				<!-- Search & Add Candidates -->
				<div class="space-y-3">
					<h4 class="text-xs font-bold text-slate-700 uppercase">ค้นหาผู้ประสบภัยคนอื่น</h4>
					<div class="relative">
						<Search class="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
						<Input
							placeholder="ค้นหาชื่อ / เบอร์โทร / เลขบัตร..."
							bind:value={searchQuery}
							class="h-9 pl-9 text-xs"
						/>
					</div>

					<div class="max-h-[250px] space-y-2 overflow-y-auto pr-1">
						{#if searchQuery.trim() && searchCandidates.length === 0}
							<p class="py-4 text-center text-xs text-muted-foreground italic">
								ไม่พบผลลัพธ์การค้นหา
							</p>
						{:else if !searchQuery.trim()}
							<p class="py-4 text-center text-xs text-muted-foreground">พิมพ์เพื่อสืบค้นข้อมูล</p>
						{:else}
							{#each searchCandidates as c (c._id)}
								<div
									class="flex items-center justify-between border-b border-border/50 pb-2 text-xs"
								>
									<div class="min-w-0 pr-2">
										<p class="truncate font-semibold text-slate-800">
											{c.first_name}
											{c.last_name}
										</p>
										{#if c.phone}
											<p class="text-[10px] text-muted-foreground">โทร: {c.phone}</p>
										{/if}
									</div>

									<Button size="sm" class="h-7 px-2.5 text-[11px]" onclick={() => onAddMember(c)}>
										เพิ่มเข้ากลุ่ม
									</Button>
								</div>
							{/each}
						{/if}
					</div>
				</div>
			</div>

			<div class="flex justify-end gap-2 border-t border-border pt-4">
				<Button
					variant="outline"
					onclick={() => {
						searchQuery = '';
						onClose();
					}}
					class="w-full"
				>
					เสร็จสิ้น
				</Button>
			</div>
		</div>
	</div>
{/if}
