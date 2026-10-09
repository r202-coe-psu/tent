<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Building2 from '@lucide/svelte/icons/building-2';
	import Cloud from '@lucide/svelte/icons/cloud';
	import User from '@lucide/svelte/icons/user';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { maskNationalId } from '../../domain/people';
	import type { InstantDuplicateMatch } from '../../domain/instant-duplicate';

	let {
		open = $bindable(false),
		matches = [],
		thaiId = '',
		ondismiss
	}: {
		open?: boolean;
		matches: InstantDuplicateMatch[];
		thaiId?: string;
		ondismiss: () => void;
	} = $props();

	const primaryMatch = $derived(matches[0] ?? null);

	function handleProceedNotThisPerson() {
		open = false;
		ondismiss();
	}

	async function handleNavigateToExisting(actionUrl: string) {
		open = false;
		await goto(resolve(actionUrl as `/${string}`));
	}
</script>

<AlertDialog.Root
	bind:open
	onOpenChange={(next) => {
		if (!next) {
			ondismiss();
		}
	}}
>
	<AlertDialog.Content class="max-w-lg">
		<AlertDialog.Header class="space-y-2">
			<div class="flex items-center gap-2 text-amber-600 dark:text-amber-500">
				<AlertTriangle class="size-5 shrink-0" />
				<AlertDialog.Title class="text-lg font-bold text-slate-900 dark:text-slate-100">
					พบข้อมูลซ้ำในระบบ
				</AlertDialog.Title>
			</div>
			<AlertDialog.Description class="text-sm text-slate-600 dark:text-slate-400">
				ตรวจพบเลขบัตรประชาชน <strong
					class="font-semibold text-slate-900 tabular-nums dark:text-slate-100"
					>{maskNationalId(thaiId || primaryMatch?.nationalId)}</strong
				> มีข้อมูลผู้ประสบภัยอยู่ในระบบแล้ว กรุณาตรวจสอบก่อนกรอกข้อมูลซ้ำ
			</AlertDialog.Description>
		</AlertDialog.Header>

		{#if matches.length > 0}
			<div class="my-2 space-y-2.5">
				{#each matches as match, index (match.id + index)}
					<div
						class="flex flex-col gap-2 rounded-xl border border-amber-200/80 bg-amber-50/60 p-3.5 text-sm dark:border-amber-900/50 dark:bg-amber-950/20"
					>
						<div class="flex flex-wrap items-start justify-between gap-2">
							<div class="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
								<User class="size-4 shrink-0 text-amber-700 dark:text-amber-400" />
								<span>{match.name}</span>
							</div>
							<div class="flex items-center gap-1.5">
								{#if match.source === 'local'}
									<Badge
										variant="outline"
										class="gap-1 border-blue-300 bg-blue-50 text-2xs text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300"
									>
										<Building2 class="size-3" />
										<span>ศูนย์นี้</span>
									</Badge>
								{:else}
									<Badge
										variant="outline"
										class="gap-1 border-purple-300 bg-purple-50 text-2xs text-purple-800 dark:border-purple-800 dark:bg-purple-950 dark:text-purple-300"
									>
										<Cloud class="size-3" />
										<span>คิวกลาง</span>
									</Badge>
								{/if}
								<Badge variant="secondary" class="text-2xs font-medium">
									{match.statusLabel}
								</Badge>
							</div>
						</div>

						<div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
							<span
								>เลขบัตรประชาชน: <span class="font-mono tabular-nums"
									>{maskNationalId(match.nationalId)}</span
								></span
							>
						</div>

						{#if matches.length > 1}
							<div class="pt-1">
								<Button
									type="button"
									size="sm"
									variant="secondary"
									class="h-8 gap-1 text-xs"
									onclick={() => handleNavigateToExisting(match.actionUrl)}
								>
									<span>{match.actionLabel}</span>
									<ArrowRight class="size-3.5" />
								</Button>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}

		<AlertDialog.Footer class="gap-2 sm:gap-2">
			<Button
				type="button"
				variant="outline"
				class="h-10 rounded-xl"
				onclick={handleProceedNotThisPerson}
			>
				ไม่ใช่คนนี้ / กรอกต่อ
			</Button>
			{#if primaryMatch}
				<Button
					type="button"
					variant="default"
					class="h-10 gap-1.5 rounded-xl bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-600 dark:hover:bg-amber-700"
					onclick={() => handleNavigateToExisting(primaryMatch.actionUrl)}
				>
					<span>ไปที่ข้อมูลเดิม / เช็คอิน</span>
					<ArrowRight class="size-4" />
				</Button>
			{/if}
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
