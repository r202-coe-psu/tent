<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import type { UserSummary } from '../data/users.api';
	import { Settings2, Trash2, KeyRound, Building, Users } from '@lucide/svelte';
	import * as Table from '$lib/components/ui/table/index.js';

	import { formatRoleList, isStaffOnly, COUCH_ADMIN } from '$lib/auth/roles';

	let {
		users,
		isSA = false,
		editHref,
		ondelete,
		onresetpassword,
		pending = false
	}: {
		users: UserSummary[];
		isSA?: boolean;
		editHref: (user: UserSummary) => string;
		ondelete: (name: string) => void;
		onresetpassword?: (user: UserSummary) => void;
		pending?: boolean;
	} = $props();
</script>

{#if users.length === 0}
	<div class="p-8 text-center text-sm text-muted-foreground">ไม่พบข้อมูลผู้ใช้งาน</div>
{:else}
	<Table.Root>
		<Table.Header class="bg-slate-50/70">
			<Table.Row>
				<Table.Head class="py-4 pl-6 text-left font-bold text-slate-700"
					>ชื่อผู้ใช้ / เบอร์โทร</Table.Head
				>
				<Table.Head class="py-4 text-left font-bold text-slate-700">ชื่อ-สกุล</Table.Head>
				<Table.Head class="py-4 text-left font-bold text-slate-700">ประเภท / สังกัด</Table.Head>
				<Table.Head class="py-4 text-left font-bold text-slate-700">บทบาทในระบบ</Table.Head>
				<Table.Head class="py-4 text-center font-bold text-slate-700">จัดการ</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each users as user (user.name)}
				{@const immutable = user.roles.includes(COUCH_ADMIN)}
				{@const canEdit = !immutable && (isSA || isStaffOnly(user.roles))}
				{@const isVolunteer = user.personnel_type === 'volunteer'}
				<Table.Row class="hover:bg-slate-50/50">
					<Table.Cell class="pl-6 font-medium">
						<span class="font-mono text-slate-800">{user.name}</span>
					</Table.Cell>
					<Table.Cell>
						<div class="flex flex-col">
							<span class="font-bold text-slate-900">{user.display_name ?? user.name}</span>
							{#if user.position}
								<span class="text-xs text-slate-500">{user.position}</span>
							{/if}
						</div>
					</Table.Cell>
					<Table.Cell class="py-3 whitespace-normal">
						<div class="flex flex-col items-start gap-2">
							{#if isVolunteer}
								<Badge
									variant="outline"
									class="h-auto gap-1.5 border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700"
								>
									<Users class="size-3.5 shrink-0" /> จิตอาสา
								</Badge>
							{:else}
								<Badge
									variant="outline"
									class="h-auto gap-1.5 border-blue-300 bg-blue-50 px-2.5 py-1 text-xs text-blue-700"
								>
									<Building class="size-3.5 shrink-0" /> เจ้าหน้าที่
								</Badge>
							{/if}
							{#if user.organization}
								<span class="max-w-[200px] pl-0.5 text-sm leading-snug text-slate-600"
									>{user.organization}</span
								>
							{/if}
						</div>
					</Table.Cell>
					<Table.Cell class="whitespace-normal">
						<div class="flex flex-col items-start gap-1">
							{#each formatRoleList(user.roles).split('\n') as line (line)}
								<Badge
									variant="secondary"
									class="h-auto max-w-full rounded-md bg-slate-100 font-semibold whitespace-normal text-slate-700 hover:bg-slate-100/80"
								>
									{line}
								</Badge>
							{/each}
						</div>
					</Table.Cell>
					<Table.Cell class="text-center">
						<div class="flex items-center justify-center gap-1.5">
							{#if onresetpassword}
								<Button
									variant="outline"
									size="sm"
									class="h-8 border-amber-200 bg-amber-50/60 px-2.5 text-xs text-amber-900 hover:bg-amber-100"
									disabled={!canEdit}
									onclick={() => onresetpassword(user)}
									title="รีเซ็ตรหัสผ่านชั่วคราว"
								>
									<KeyRound class="mr-1 h-3.5 w-3.5 text-amber-700" /> รีเซ็ตรหัส
								</Button>
							{/if}
							<Button
								variant="secondary"
								size="sm"
								class="h-8 bg-blue-50 px-2.5 text-xs text-blue-800 hover:bg-blue-100"
								disabled={!canEdit}
								href={canEdit ? editHref(user) : undefined}
							>
								<Settings2 class="mr-1 h-3.5 w-3.5" /> แก้ไข
							</Button>
							<Button
								variant="outline"
								size="icon"
								class="h-8 w-8 border-red-100 text-red-500 hover:bg-red-50 hover:text-red-600"
								disabled={pending || !canEdit}
								onclick={() => ondelete(user.name)}
								title="ลบผู้ใช้"
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
