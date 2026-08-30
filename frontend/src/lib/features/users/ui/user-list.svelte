<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import type { UserSummary } from '../data/users.api';
	import { Settings2, Trash2 } from '@lucide/svelte';
	import Building2 from '@lucide/svelte/icons/building-2';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import CircleSlash from '@lucide/svelte/icons/circle-slash';
	import Gem from '@lucide/svelte/icons/gem';
	import Globe from '@lucide/svelte/icons/globe';
	import HeartHandshake from '@lucide/svelte/icons/heart-handshake';
	import Shield from '@lucide/svelte/icons/shield';
	import * as Table from '$lib/components/ui/table/index.js';

	import {
		isAppSystemAdmin,
		isStaffOnly,
		roleOptionLabel,
		shelterCodeFromRoles,
		COUCH_ADMIN,
		SHELTER_MANAGER,
		SYSTEM_ADMIN
	} from '$lib/auth/roles';
	import { isVolunteerAccount } from '../domain/schema';

	let {
		users,
		isSA = false,
		shelterName = (code: string) => code,
		onedit,
		ondelete,
		pending = false
	}: {
		users: UserSummary[];
		isSA?: boolean;
		/** Resolves a shelter code to its display name; falls back to the code itself. */
		shelterName?: (code: string) => string;
		onedit: (user: UserSummary) => void;
		ondelete: (name: string) => void;
		pending?: boolean;
	} = $props();

	/** The one capability worth putting on a badge: manager/admin outrank the staff capabilities. */
	function primaryCapability(roles: readonly string[]): string | null {
		if (roles.includes(SYSTEM_ADMIN)) return SYSTEM_ADMIN;
		if (roles.includes(SHELTER_MANAGER)) return SHELTER_MANAGER;
		return roles.find((r) => !r.startsWith('shelter:') && r !== COUCH_ADMIN) ?? null;
	}
</script>

{#if users.length === 0}
	<div class="p-10 text-center text-xs text-muted-foreground">
		ไม่พบบัญชีผู้ใช้งานที่ตรงกับเงื่อนไข
	</div>
{:else}
	<div class="overflow-x-auto">
		<Table.Root>
			<Table.Header class="bg-muted/40">
				<Table.Row>
					<Table.Head
						class="h-11 py-0 pl-6 text-left text-2xs font-bold tracking-wider text-muted-foreground uppercase"
						>USERNAME</Table.Head
					>
					<Table.Head
						class="h-11 py-0 text-left text-2xs font-bold tracking-wider text-muted-foreground uppercase"
						>ชื่อ-สกุล</Table.Head
					>
					<Table.Head
						class="h-11 py-0 text-left text-2xs font-bold tracking-wider text-muted-foreground uppercase"
						>สังกัดศูนย์ + ROLE</Table.Head
					>
					<Table.Head
						class="h-11 py-0 text-left text-2xs font-bold tracking-wider text-muted-foreground uppercase"
						>ชนิดคน (R-AFFIL)</Table.Head
					>
					<Table.Head
						class="h-11 py-0 text-left text-2xs font-bold tracking-wider text-muted-foreground uppercase"
						>สถานะบัญชี</Table.Head
					>
					<Table.Head
						class="h-11 py-0 pr-6 text-right text-2xs font-bold tracking-wider text-muted-foreground uppercase"
						>การจัดการ</Table.Head
					>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each users as user (user.name)}
					{@const immutable = user.roles.includes(COUCH_ADMIN)}
					{@const platformWide = isAppSystemAdmin(user.roles)}
					{@const code = shelterCodeFromRoles(user.roles)}
					{@const capability = primaryCapability(user.roles)}
					{@const volunteer = isVolunteerAccount(user.affiliation_tags)}
					{@const active = user.active ?? true}
					<Table.Row class="transition-colors hover:bg-muted/40">
						<Table.Cell class="py-3 pl-6 font-mono text-sm font-medium">{user.name}</Table.Cell>
						<Table.Cell class="text-sm font-semibold text-foreground"
							>{user.display_name ?? user.name}</Table.Cell
						>
						<Table.Cell>
							<div class="flex flex-col items-start gap-1.5">
								<Badge
									variant="secondary"
									class={platformWide
										? 'rounded-md bg-violet-50 font-medium text-violet-800 hover:bg-violet-50'
										: 'rounded-md bg-slate-100 font-medium text-muted-foreground hover:bg-slate-100'}
								>
									{#if platformWide}
										<Globe class="mr-1 size-3" /> ทุกศูนย์ (Platform-wide)
									{:else if code}
										<Building2 class="mr-1 size-3" /> {shelterName(code)}
									{:else}
										<Building2 class="mr-1 size-3" /> ไม่ได้ระบุศูนย์
									{/if}
								</Badge>
								{#if capability}
									<Badge
										variant="secondary"
										class={platformWide
											? 'rounded-md bg-rose-50 font-medium text-rose-800 hover:bg-rose-50'
											: 'rounded-md bg-emerald-50 font-medium text-emerald-800 hover:bg-emerald-50'}
									>
										<Shield class="mr-1 size-3" />
										{roleOptionLabel(capability)}
									</Badge>
								{/if}
							</div>
						</Table.Cell>
						<Table.Cell>
							<!-- R-AFFIL-3: the badge reads the tag, never the RoleKey. -->
							<Badge
								variant="secondary"
								class={volunteer
									? 'rounded-md bg-amber-50 font-medium text-amber-800 hover:bg-amber-50'
									: 'rounded-md bg-blue-50 font-medium text-blue-800 hover:bg-blue-50'}
							>
								{#if volunteer}
									<HeartHandshake class="mr-1 size-3" /> อาสาสมัคร
								{:else}
									<Gem class="mr-1 size-3" /> เจ้าหน้าที่ประจำ
								{/if}
							</Badge>
						</Table.Cell>
						<Table.Cell>
							<Badge
								variant="secondary"
								class={active
									? 'rounded-md bg-emerald-50 font-medium text-emerald-800 hover:bg-emerald-50'
									: 'rounded-md bg-muted font-medium text-muted-foreground hover:bg-muted'}
							>
								{#if active}
									<CircleCheck class="mr-1 size-3" /> พร้อมใช้งาน
								{:else}
									<CircleSlash class="mr-1 size-3" /> ระงับการใช้งาน
								{/if}
							</Badge>
						</Table.Cell>
						<Table.Cell class="pr-6 text-right">
							<div class="flex items-center justify-end gap-2">
								<Button
									variant="secondary"
									size="sm"
									class="h-8 bg-blue-50 px-3 text-xs text-blue-800 hover:bg-blue-100"
									disabled={immutable || (!isSA && !isStaffOnly(user.roles))}
									onclick={() => onedit(user)}
								>
									<Settings2 class="mr-1 h-3 w-3" /> จัดการ
								</Button>
								<Button
									variant="outline"
									size="icon"
									aria-label={`ลบผู้ใช้ ${user.name}`}
									class="h-8 w-8 border-red-100 text-red-500 hover:bg-red-50 hover:text-red-600"
									disabled={pending || immutable || (!isSA && !isStaffOnly(user.roles))}
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
	</div>
{/if}
