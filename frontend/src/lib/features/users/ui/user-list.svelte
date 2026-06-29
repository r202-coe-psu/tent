<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import type { UserSummary } from '../data/users.api';
	import { Settings2, Trash2, CheckCircle2 } from '@lucide/svelte';
	import * as Table from '$lib/components/ui/table/index.js';

	import { isStaffOnly } from '$lib/auth/roles';

	let {
		users,
		isSA = false,
		onedit,
		ondelete,
		pending = false
	}: {
		users: UserSummary[];
		isSA?: boolean;
		onedit: (user: UserSummary) => void;
		ondelete: (name: string) => void;
		pending?: boolean;
	} = $props();
</script>

{#if users.length === 0}
	<div class="p-8 text-center text-sm text-muted-foreground">No users found.</div>
{:else}
	<Table.Root>
		<Table.Header class="bg-slate-50/50">
			<Table.Row>
				<Table.Head class="py-4 pl-10 text-left font-bold text-slate-700">USERNAME</Table.Head>
				<Table.Head class="py-4 text-left font-bold text-slate-700">ชื่อ-สกุล</Table.Head>
				<Table.Head class="py-4 text-left font-bold text-slate-700">ROLE</Table.Head>
				<Table.Head class="py-4 text-left font-bold text-slate-700">STATUS</Table.Head>
				<Table.Head class="py-4 text-center font-bold text-slate-700">จัดการ</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each users as user (user.name)}
				<Table.Row class="hover:bg-slate-50/50">
					<Table.Cell class="pl-10 font-medium">{user.name}</Table.Cell>
					<Table.Cell class="font-bold">
						{user.display_name ?? user.name}
					</Table.Cell>
					<Table.Cell>
						<Badge
							variant="secondary"
							class="rounded-md bg-slate-100 font-semibold text-slate-700 hover:bg-slate-100/80"
						>
							{user.roles.join(', ') || '—'}
						</Badge>
					</Table.Cell>
					<Table.Cell>
						<Badge
							variant="outline"
							class="rounded-md border-green-200 bg-green-50 font-normal text-green-700 hover:bg-green-50"
						>
							<CheckCircle2 class="mr-1 h-3 w-3" /> Active
						</Badge>
					</Table.Cell>
					<Table.Cell class="text-center">
						<div class="flex items-center justify-center gap-2">
							<Button
								variant="secondary"
								size="sm"
								class="h-8 bg-blue-50 px-3 text-xs text-blue-800 hover:bg-blue-100"
								disabled={!isSA && !isStaffOnly(user.roles)}
								onclick={() => onedit(user)}
							>
								<Settings2 class="mr-1 h-3 w-3" /> จัดการ
							</Button>
							<Button
								variant="outline"
								size="icon"
								class="h-8 w-8 border-red-100 text-red-500 hover:bg-red-50 hover:text-red-600"
								disabled={pending || (!isSA && !isStaffOnly(user.roles))}
								onclick={() => ondelete(user.name)}
							>
								<Trash2 class="h-4 w-4" />
							</Button>
						</div>
					</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
{/if}
