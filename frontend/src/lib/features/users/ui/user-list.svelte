<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import type { UserSummary } from '../data/users.api';
	import { Settings2, Trash2, CheckCircle2 } from '@lucide/svelte';
	import * as Table from '$lib/components/ui/table/index.js';

	let {
		users,
		ondelete,
		pending = false
	}: {
		users: UserSummary[];
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
				<Table.Head class="font-bold text-slate-700">USERNAME</Table.Head>
				<Table.Head class="font-bold text-slate-700">ชื่อ-สกุล</Table.Head>
				<Table.Head class="font-bold text-slate-700">ROLE</Table.Head>
				<Table.Head class="font-bold text-slate-700">STATUS</Table.Head>
				<Table.Head class="text-right font-bold text-slate-700">จัดการ</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each users as user (user.name)}
				<Table.Row class="hover:bg-slate-50/50">
					<Table.Cell class="font-medium">{user.name}</Table.Cell>
					<Table.Cell class="font-bold">
						{user.name}
					</Table.Cell>
					<Table.Cell>
						<Badge variant="secondary" class="bg-slate-100 text-slate-700 hover:bg-slate-100/80 rounded-md font-normal">
							{user.roles.join(', ') || '—'}
						</Badge>
					</Table.Cell>
					<Table.Cell>
						<Badge variant="outline" class="bg-green-50 text-green-700 border-green-200 hover:bg-green-50 rounded-md font-normal">
							<CheckCircle2 class="w-3 h-3 mr-1" /> Active
						</Badge>
					</Table.Cell>
					<Table.Cell class="text-right">
						<div class="flex items-center justify-end gap-2">
							<Button variant="secondary" size="sm" class="bg-blue-50 text-blue-800 hover:bg-blue-100 text-xs px-3 h-8">
								<Settings2 class="w-3 h-3 mr-1" /> จัดการ
							</Button>
							<Button
								variant="outline"
								size="icon"
								class="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50 border-red-100"
								disabled={pending}
								onclick={() => ondelete(user.name)}
							>
								<Trash2 class="w-4 h-4" />
							</Button>
						</div>
					</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
{/if}
