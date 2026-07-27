<script lang="ts">
	import User from '@lucide/svelte/icons/user';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Eye from '@lucide/svelte/icons/eye';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { Evacuee } from '../domain/people';
	import { maskNationalId } from '../domain/people';

	let {
		head,
		onOpenHeadModal,
		onViewProfile
	}: {
		head: Evacuee | null;
		onOpenHeadModal: () => void;
		onViewProfile: (id: string) => void;
	} = $props();
</script>

<div class="space-y-4 rounded-3xl border border-border bg-card p-6 shadow-sm">
	<div class="flex items-center justify-between border-b border-border pb-3">
		<h3 class="flex items-center gap-2 text-base font-black text-slate-800 dark:text-slate-200">
			<User class="size-5 text-primary" />
			หัวหน้าครัวเรือน (Head of Household)
		</h3>
		<Button variant="outline" size="sm" onclick={onOpenHeadModal}>
			<Pencil class="mr-1.5 size-3.5" /> เปลี่ยนหัวหน้า
		</Button>
	</div>

	{#if head}
		<div class="flex items-start gap-4">
			<div
				class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-xl font-bold text-primary"
			>
				{head.first_name[0]}
			</div>
			<div class="min-w-0 flex-1 space-y-1">
				<h4 class="font-bold text-slate-900 dark:text-slate-50">
					{head.first_name}
					{head.last_name}
				</h4>
				<p class="text-xs text-muted-foreground">
					เลขบัตร: {maskNationalId(head.person_id?.number)}
					{#if head.phone}
						· โทร: {head.phone}{/if}
					{#if head.birth_year}
						· อายุ: {new Date().getFullYear() - head.birth_year} ปี{/if}
				</p>
				<div class="pt-2">
					<Button
						variant="ghost"
						size="sm"
						class="h-8 text-xs text-primary hover:bg-primary/10"
						onclick={() => onViewProfile(head._id)}
					>
						<Eye class="mr-1 size-3.5" /> ดูโปรไฟล์อย่างละเอียด
					</Button>
				</div>
			</div>
		</div>
	{:else}
		<p class="py-4 text-center text-sm text-muted-foreground italic">ไม่มีหัวหน้าครัวเรือนหลัก</p>
	{/if}
</div>
