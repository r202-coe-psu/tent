<script lang="ts">
	import Users from '@lucide/svelte/icons/users';
	import Plus from '@lucide/svelte/icons/plus';
	import Eye from '@lucide/svelte/icons/eye';
	import Trash from '@lucide/svelte/icons/trash';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import type { Evacuee, Household } from '../domain/people';

	let {
		household,
		members,
		onOpenMembersModal,
		onRemoveMember,
		onViewProfile
	}: {
		household: Household;
		members: Evacuee[];
		onOpenMembersModal: () => void;
		onRemoveMember: (evacuee: Evacuee) => void;
		onViewProfile: (id: string) => void;
	} = $props();
</script>

<div class="space-y-4 rounded-3xl border border-border bg-card p-6 shadow-sm">
	<div class="flex items-center justify-between border-b border-border pb-3">
		<h3 class="flex items-center gap-2 text-base font-black text-slate-800 dark:text-slate-200">
			<Users class="size-5 text-primary" />
			รายชื่อสมาชิกในครอบครัว ({members.length} คน)
		</h3>
		<Button variant="outline" size="sm" onclick={onOpenMembersModal}>
			<Plus class="mr-1.5 size-3.5" /> จัดการสมาชิก
		</Button>
	</div>

	{#if members.length === 0}
		<p class="py-6 text-center text-sm text-muted-foreground italic">ไม่มีสมาชิกในครัวเรือนนี้</p>
	{:else}
		<div class="divide-y divide-border/60">
			{#each members as m (m._id)}
				<div class="flex items-center justify-between py-3 first:pt-0 last:pb-0">
					<div class="min-w-0 pr-4">
						<p class="truncate font-semibold text-slate-800 dark:text-slate-100">
							{m.first_name}
							{m.last_name}
						</p>
						<p class="text-xs text-muted-foreground">
							{#if m._id === household.head_evacuee_id}
								<Badge class="mr-1.5 bg-green-600 text-white">หัวหน้า</Badge>
							{:else}
								<Badge variant="secondary" class="mr-1.5">สมาชิก</Badge>
							{/if}
							{#if m.birth_year}อายุ {new Date().getFullYear() - m.birth_year} ปี ·
							{/if}
							สถานะ: {{
								active: 'อยู่ในศูนย์',
								pre_registered: 'ลงทะเบียนล่วงหน้า',
								temporary_leave: 'ออกชั่วคราว',
								transferred: 'ย้ายศูนย์',
								checked_out: 'ย้ายออก',
								deceased: 'เสียชีวิต',
								cancelled: 'ยกเลิก'
							}[m.current_stay.status] ?? m.current_stay.status}
						</p>
					</div>

					<div class="flex gap-2">
						<Button
							variant="ghost"
							size="sm"
							class="h-8 text-xs text-primary hover:bg-primary/10"
							onclick={() => onViewProfile(m._id)}
						>
							<Eye class="size-3.5" />
						</Button>
						{#if m._id !== household.head_evacuee_id}
							<Button
								variant="ghost"
								size="sm"
								class="h-8 text-xs text-destructive hover:bg-destructive/10"
								onclick={() => onRemoveMember(m)}
							>
								<Trash class="size-3.5" />
							</Button>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
