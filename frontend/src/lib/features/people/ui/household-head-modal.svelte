<script lang="ts">
	import X from '@lucide/svelte/icons/x';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import type { Evacuee, Household } from '../domain/people';

	let {
		show,
		household,
		members,
		onClose,
		onSelectNewHead
	}: {
		show: boolean;
		household: Household;
		members: Evacuee[];
		onClose: () => void;
		onSelectNewHead: (evacueeId: string) => Promise<void>;
	} = $props();
</script>

{#if show}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-xs"
	>
		<div
			class="w-full max-w-md animate-in space-y-4 rounded-3xl border border-border bg-card p-6 shadow-xl duration-150 zoom-in-95 fade-in"
		>
			<div class="flex items-center justify-between border-b border-border pb-2.5">
				<h3 class="text-lg font-bold text-slate-900 dark:text-slate-50">
					เลือกหัวหน้าครอบครัวคนใหม่
				</h3>
				<button
					onclick={onClose}
					class="cursor-pointer rounded-lg p-1 text-muted-foreground transition-colors hover:text-foreground"
				>
					<X class="size-5" />
				</button>
			</div>

			<div class="max-h-[300px] space-y-2 overflow-y-auto py-2">
				{#if members.length === 0}
					<p class="py-4 text-center text-sm text-muted-foreground italic">ไม่มีรายชื่อสมาชิก</p>
				{:else}
					{#each members as m (m._id)}
						<div
							class="flex items-center justify-between rounded-2xl border border-border bg-slate-50/50 p-3 dark:bg-slate-900/30"
						>
							<div>
								<p class="font-bold text-slate-800 dark:text-slate-100">
									{m.first_name}
									{m.last_name}
								</p>
								{#if m._id === household.head_evacuee_id}
									<Badge class="bg-green-600 text-white">หัวหน้าปัจจุบัน</Badge>
								{/if}
							</div>

							<Button
								disabled={m._id === household.head_evacuee_id}
								size="sm"
								onclick={() => onSelectNewHead(m._id)}
							>
								เลือกเป็นหัวหน้า
							</Button>
						</div>
					{/each}
				{/if}
			</div>

			<div class="flex justify-end gap-2 border-t border-border pt-4">
				<Button variant="outline" onclick={onClose} class="w-full">ยกเลิก</Button>
			</div>
		</div>
	</div>
{/if}
