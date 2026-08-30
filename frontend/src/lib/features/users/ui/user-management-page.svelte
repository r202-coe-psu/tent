<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { authStore } from '$lib/stores/auth.svelte';
	import {
		isAppSystemAdmin,
		isSystemAdmin,
		shelterCodeFromRoles,
		shelterScopeRole,
		SYSTEM_ADMIN
	} from '$lib/auth/roles';
	import UserFormDialog from './user-form-dialog.svelte';
	import UserList from './user-list.svelte';
	import { useUsers, useCreateUser, useUpdateUser, useDeleteUser } from '../application/queries';
	import {
		affiliationTagsFor,
		isVolunteerAccount,
		PLATFORM_WIDE,
		toDutyWindow,
		type CreateUserInput,
		type EditUserInput
	} from '../domain/schema';
	import type { UserSummary } from '../data/users.api';
	import { useQueryClient } from '@tanstack/svelte-query';
	import { useVolunteers, useUpdateVolunteer, type Volunteer } from '$lib/features/volunteers';
	import { UserPlus, Search } from '@lucide/svelte';
	import Gem from '@lucide/svelte/icons/gem';
	import HeartHandshake from '@lucide/svelte/icons/heart-handshake';
	import Info from '@lucide/svelte/icons/info';
	import { useShelters } from '$lib/features/shelters';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Combobox } from '$lib/components/ui/combobox/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';

	let {
		lockedShelterCode,
		compact = false,
		allowSystemAdminRole = false
	}: {
		/** When set, list and forms are scoped to this shelter — no picker. */
		lockedShelterCode?: string;
		/** Embedded in shelter settings: smaller heading so it doesn't clash. */
		compact?: boolean;
		/** Portal-only: SA may create/edit `system_admin` users. */
		allowSystemAdminRole?: boolean;
	} = $props();

	const roles = $derived(authStore.user?.roles ?? []);
	const isSA = $derived(isSystemAdmin(roles));
	const ownShelterCode = $derived(shelterCodeFromRoles(roles));
	const effectiveLock = $derived(
		lockedShelterCode || (!isSA ? (ownShelterCode ?? undefined) : undefined)
	);

	const usersQuery = useUsers();
	const createMutation = useCreateUser();
	const updateMutation = useUpdateUser();
	const deleteMutation = useDeleteUser();

	// CR-096 §2.3 — the link is two-way: `_users.volunteer_id` points at the profile, and the
	// profile's `user_name` points back, which is what the roster reads to show "มีบัญชีหลังบ้าน".
	const queryClient = useQueryClient();
	const volunteersQuery = useVolunteers({ status: 'active' });
	const linkVolunteerMutation = useUpdateVolunteer(queryClient);

	/**
	 * Write `volunteer.user_name` for the bound profile. Runs after the `_users` write succeeds, so
	 * a failure here leaves a valid login with a half-made link — reported as a warning toast
	 * rather than a save failure, since the account itself is fine (CR-096 open question #7).
	 */
	async function syncVolunteerLink(volunteerId: string | undefined, username: string) {
		if (!volunteerId) return;
		const profile: Volunteer | undefined = volunteersQuery.data?.find((v) => v._id === volunteerId);
		if (!profile || profile.user_name === username) return;
		try {
			await linkVolunteerMutation.mutateAsync({ ...profile, user_name: username });
		} catch (err) {
			toast.warning(
				`บันทึกบัญชีสำเร็จ แต่ผูกกับโปรไฟล์อาสาไม่สำเร็จ: ${
					err instanceof Error ? err.message : 'ไม่ทราบสาเหตุ'
				}`
			);
		}
	}

	let dialogOpen = $state(false);
	let editDialogOpen = $state(false);
	let deleteDialogOpen = $state(false);
	let demoteDialogOpen = $state(false);
	let searchQuery = $state('');
	/** Segmented filter over `affiliation_tags` (R-AFFIL-4), not over RoleKeys. */
	let personnelFilter = $state<'all' | 'staff' | 'volunteer'>('all');
	/** Shelter filter — '' means every shelter the caller can see. */
	let shelterFilter = $state('');
	let selectedUser = $state<UserSummary | null>(null);
	let userToDelete = $state<string | null>(null);
	let pendingDemote = $state<EditUserInput | null>(null);

	function rolesFromInput(input: { capability: string; shelter_id?: string }): string[] | null {
		if (input.capability === SYSTEM_ADMIN) return [SYSTEM_ADMIN];
		// `PLATFORM_WIDE` is a form sentinel, never a shelter code — the schema already rejects it
		// for any capability but `system_admin`, so reaching here with it means no valid scope.
		const code = effectiveLock ?? input.shelter_id;
		if (!code || code === PLATFORM_WIDE) return null;
		return [shelterScopeRole(code), input.capability];
	}

	/** Rejects on failure — UserFormDialog turns the reason into a Superforms error. */
	async function handleCreate(input: CreateUserInput) {
		const userRoles = rolesFromInput(input);
		if (!userRoles) throw new Error('A shelter code is required');
		await createMutation.mutateAsync({
			name: input.username,
			password: input.password,
			display_name: input.display_name,
			roles: userRoles,
			affiliation_tags: affiliationTagsFor(input.personnel_type),
			volunteer_id: input.volunteer_id ?? null,
			duty_window: toDutyWindow(input.duty_start, input.duty_end),
			active: input.active
		});
		await syncVolunteerLink(input.volunteer_id, input.username);
		toast.success(`User "${input.username}" created`);
		dialogOpen = false;
	}

	function handleEdit(user: UserSummary) {
		selectedUser = user;
		editDialogOpen = true;
	}

	/** Rejects on failure — the caller decides whether that becomes a form error or a toast. */
	async function applyUpdate(input: EditUserInput) {
		const target = selectedUser;
		if (!target) return;
		const userRoles = rolesFromInput(input);
		if (!userRoles) throw new Error('A shelter code is required');
		await updateMutation.mutateAsync({
			name: target.name,
			password: input.password || undefined,
			display_name: input.display_name,
			roles: userRoles,
			// Tags the form does not own (e.g. `governance`) survive the edit.
			affiliation_tags: affiliationTagsFor(input.personnel_type, target.affiliation_tags),
			volunteer_id: input.volunteer_id ?? null,
			duty_window: toDutyWindow(input.duty_start, input.duty_end),
			active: input.active
		});
		await syncVolunteerLink(input.volunteer_id, target.name);
		toast.success(`User "${target.name}" updated`);
		editDialogOpen = false;
		demoteDialogOpen = false;
		selectedUser = null;
		pendingDemote = null;
	}

	async function handleUpdate(input: EditUserInput) {
		if (!selectedUser) return;
		const wasSa = isAppSystemAdmin(selectedUser.roles);
		const willBeSa = input.capability === SYSTEM_ADMIN;
		if (wasSa && !willBeSa) {
			pendingDemote = input;
			demoteDialogOpen = true;
			return;
		}
		await applyUpdate(input);
	}

	/** The demote path runs from its own dialog, with no form listening — so it toasts. */
	function confirmDemote() {
		if (!pendingDemote) return;
		applyUpdate(pendingDemote).catch((err: unknown) =>
			toast.error(err instanceof Error ? err.message : 'ไม่สามารถลดสิทธิ์ผู้ดูแลระบบได้')
		);
	}

	function confirmDelete(name: string) {
		userToDelete = name;
		deleteDialogOpen = true;
	}

	function handleDelete() {
		if (!userToDelete) return;
		deleteMutation.mutate(userToDelete, {
			onSuccess: () => {
				toast.success(`User "${userToDelete}" deleted`);
				deleteDialogOpen = false;
				userToDelete = null;
			},
			onError: (err: Error) => toast.error(err.message)
		});
	}

	const deletingIsSa = $derived(
		Boolean(
			userToDelete &&
			usersQuery.data?.some((u) => u.name === userToDelete && isAppSystemAdmin(u.roles))
		)
	);

	const sheltersQuery = useShelters();
	const shelterNames = $derived(new Map((sheltersQuery.data ?? []).map((s) => [s.code, s.name])));
	function shelterName(code: string): string {
		return shelterNames.get(code) ?? code;
	}

	const shelterFilterItems = $derived([
		{ value: '', label: 'ทุกศูนย์พักพิง (ทุกมุมมอง)' },
		...(sheltersQuery.data ?? [])
			.map((s) => ({ value: s.code, label: s.name }))
			.sort((a, b) => a.label.localeCompare(b.label, 'th'))
	]);

	/** Everything the caller may see, before the search box and the two filters narrow it. */
	const scopedUsers = $derived(
		usersQuery.data?.filter((u: UserSummary) => !effectiveLock || u.shelter_id === effectiveLock) ??
			[]
	);

	const personnelCounts = $derived({
		all: scopedUsers.length,
		staff: scopedUsers.filter((u) => !isVolunteerAccount(u.affiliation_tags)).length,
		volunteer: scopedUsers.filter((u) => isVolunteerAccount(u.affiliation_tags)).length
	});

	const personnelTabs = $derived([
		{ key: 'all' as const, label: `ทั้งหมด (${personnelCounts.all})` },
		{ key: 'staff' as const, label: `เจ้าหน้าที่ประจำ (${personnelCounts.staff})` },
		{ key: 'volunteer' as const, label: `อาสาสมัคร (${personnelCounts.volunteer})` }
	]);

	const filteredUsers = $derived(
		scopedUsers.filter((u: UserSummary) => {
			if (shelterFilter && u.shelter_id !== shelterFilter) return false;
			if (personnelFilter !== 'all') {
				const volunteer = isVolunteerAccount(u.affiliation_tags);
				if (personnelFilter === 'volunteer' ? !volunteer : volunteer) return false;
			}
			if (!searchQuery.trim()) return true;
			// Identity only — name, surname, username. Shelter and personnel type have their own
			// controls beside the box, so folding them in here just made results unpredictable.
			const q = searchQuery.trim().toLowerCase();
			return u.name.toLowerCase().includes(q) || (u.display_name ?? '').toLowerCase().includes(q);
		})
	);
</script>

<div class={['mx-auto', compact ? 'max-w-none' : 'container max-w-[1200px] p-6']}>
	<div
		class={[
			'flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center',
			compact ? 'mb-4' : 'mb-8'
		]}
	>
		<div class="flex items-center gap-3">
			<div class="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
				<UserPlus class={compact ? 'h-5 w-5' : 'h-5.5 w-5.5'} />
			</div>
			<div class="min-w-0">
				<h2 class={['font-bold tracking-tight text-foreground', compact ? 'text-lg' : 'text-2xl']}>
					จัดการผู้ใช้งาน (User Management)
				</h2>
				<p class="mt-0.5 text-xs text-muted-foreground">ค้นหาและจัดการสิทธิ์ส่วนบุคคลในระบบ</p>
			</div>
		</div>

		<Button
			onclick={() => (dialogOpen = true)}
			class="h-11 rounded-xl bg-[#0f2d5c] px-5 font-semibold text-white shadow-xs transition-colors hover:bg-[#0a1e3f]"
		>
			<UserPlus class="mr-1.5 size-4" /> เพิ่มผู้ใช้
		</Button>
	</div>

	<!-- These are the real, persisted accounts — distinct from the RBAC preview switcher in the
	     sidebar, which only swaps the viewing lens. Operators confuse the two, so say it here. -->
	<div
		class={[
			'flex items-start gap-3 rounded-2xl border border-primary/15 bg-primary/5 p-4',
			compact ? 'mb-4' : 'mb-6'
		]}
	>
		<Info class="mt-0.5 size-4.5 shrink-0 text-primary" />
		<div class="min-w-0">
			<p class="flex flex-wrap items-center gap-2 text-sm font-bold text-foreground">
				ฐานข้อมูลบัญชีผู้ใช้ถาวรของระบบ (Permanent System Accounts)
				<Badge
					variant="secondary"
					class="rounded-md bg-primary/10 text-2xs font-semibold tracking-wide text-primary uppercase"
				>
					Admin Level
				</Badge>
			</p>
			<p class="mt-1 text-xs leading-relaxed text-muted-foreground">
				หน้านี้ใช้สำหรับบันทึกและจัดการบัญชีผู้ใช้งานจริงในระบบ (บันทึกลงฐานข้อมูลถาวร)
				กำหนดสังกัดศูนย์พักพิงและบทบาทสิทธิ์ (Role) ตามโครงสร้างความปลอดภัย — แยกต่างหากจากเมนู
				"จำลองสิทธิ์ผู้ใช้งาน (RBAC)" บน Sidebar
				ซึ่งเป็นเพียงเครื่องมือสลับมุมมองทดสอบการแสดงผลชั่วคราว
			</p>
		</div>
	</div>

	<div class={['flex flex-col gap-3 lg:flex-row lg:items-center', compact ? 'mb-4' : 'mb-6']}>
		<div class="relative min-w-0 flex-1">
			<Search
				class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
			/>
			<Input
				type="search"
				bind:value={searchQuery}
				placeholder="ค้นหาด้วยชื่อ, นามสกุล หรือ Username..."
				class="h-11 rounded-xl bg-background pl-9 shadow-xs"
			/>
		</div>

		<!-- Only the portal reads every shelter; the back-office page is locked to one, so a picker
		     there would be a control with a single possible value. -->
		{#if !effectiveLock}
			<Combobox
				items={shelterFilterItems}
				bind:value={shelterFilter}
				placeholder="ทุกศูนย์พักพิง (ทุกมุมมอง)"
				searchPlaceholder="ค้นหาศูนย์พักพิง..."
				emptyText="ไม่พบศูนย์พักพิง"
				class="h-11 w-full rounded-xl bg-background shadow-xs lg:w-72"
			/>
		{/if}

		<!-- R-AFFIL-4: filter by personnel type within the caller's shelter scope. -->
		<div class="flex shrink-0 gap-1 rounded-xl bg-muted p-1">
			{#each personnelTabs as tab (tab.key)}
				<Button
					type="button"
					variant="ghost"
					size="sm"
					aria-pressed={personnelFilter === tab.key}
					onclick={() => (personnelFilter = tab.key)}
					class={[
						'h-9 rounded-lg px-3 text-xs font-semibold transition-colors',
						personnelFilter === tab.key
							? 'bg-background text-foreground shadow-xs hover:bg-background'
							: 'text-muted-foreground hover:bg-background/60'
					]}
				>
					{#if tab.key === 'staff'}<Gem class="mr-1 size-3.5" />{/if}
					{#if tab.key === 'volunteer'}<HeartHandshake class="mr-1 size-3.5" />{/if}
					{tab.label}
				</Button>
			{/each}
		</div>
	</div>

	<div class="overflow-hidden rounded-2xl border border-border bg-background shadow-xs">
		{#if usersQuery.isLoading}
			<div class="p-10 text-center text-xs text-muted-foreground">กำลังโหลดรายชื่อผู้ใช้งาน...</div>
		{:else if usersQuery.isError}
			<div class="p-10 text-center text-xs text-destructive">
				โหลดข้อมูลไม่สำเร็จ: {usersQuery.error?.message}
			</div>
		{:else}
			<UserList
				users={filteredUsers}
				{isSA}
				{shelterName}
				onedit={handleEdit}
				ondelete={confirmDelete}
				pending={deleteMutation.isPending}
			/>
		{/if}
	</div>
</div>

<!-- `{#key}`: the form seeds itself once per mount (untrack), so a new target needs a new instance. -->
{#if dialogOpen}
	<UserFormDialog
		bind:open={dialogOpen}
		onsubmit={handleCreate}
		{isSA}
		{allowSystemAdminRole}
		lockedShelterCode={effectiveLock ?? null}
		pending={createMutation.isPending}
	/>
{/if}

{#if editDialogOpen && selectedUser}
	{#key selectedUser.name}
		<UserFormDialog
			bind:open={
				() => editDialogOpen,
				(v) => {
					editDialogOpen = v;
					if (!v) selectedUser = null;
				}
			}
			user={selectedUser}
			onsubmit={handleUpdate}
			{isSA}
			{allowSystemAdminRole}
			lockedShelterCode={effectiveLock ?? null}
			pending={updateMutation.isPending}
		/>
	{/key}
{/if}

<Dialog.Root bind:open={deleteDialogOpen}>
	<Dialog.Content class="rounded-2xl p-6 sm:max-w-[400px]">
		<Dialog.Header>
			<Dialog.Title class="text-lg font-bold text-red-600">ยืนยันการลบผู้ใช้งาน</Dialog.Title>
			<Dialog.Description class="pt-2 text-sm text-slate-500">
				คุณแน่ใจหรือไม่ว่าต้องการลบผู้ใช้งาน <strong class="text-slate-900">{userToDelete}</strong>?
				การดำเนินการนี้ไม่สามารถย้อนกลับได้
				{#if deletingIsSa}
					<span class="mt-2 block"
						>บัญชีนี้เป็นผู้ดูแลระบบ — ลบได้เฉพาะเมื่อยังมี SA คนอื่นในระบบ</span
					>
				{/if}
			</Dialog.Description>
		</Dialog.Header>
		<div class="mt-2 flex justify-end gap-4 pt-4">
			<Button
				type="button"
				variant="outline"
				onclick={() => {
					deleteDialogOpen = false;
					userToDelete = null;
				}}
				class="rounded-lg"
			>
				ยกเลิก
			</Button>
			<Button
				variant="destructive"
				disabled={deleteMutation.isPending}
				onclick={handleDelete}
				class="rounded-lg bg-red-600 text-white hover:bg-red-700"
			>
				{#if deleteMutation.isPending}กำลังลบ...{:else}ยืนยันการลบ{/if}
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={demoteDialogOpen}>
	<Dialog.Content class="rounded-2xl p-6 sm:max-w-[400px]">
		<Dialog.Header>
			<Dialog.Title class="text-lg font-bold">ยืนยันการลดสิทธิ์ผู้ดูแลระบบ</Dialog.Title>
			<Dialog.Description class="pt-2 text-sm text-slate-500">
				จะลดสิทธิ์ <strong class="text-slate-900">{selectedUser?.name}</strong>
				จากผู้ดูแลระบบเป็นบทบาทของศูนย์ ทำได้เฉพาะเมื่อยังมี SA คนอื่นในระบบ
			</Dialog.Description>
		</Dialog.Header>
		<div class="mt-2 flex justify-end gap-4 pt-4">
			<Button
				type="button"
				variant="outline"
				onclick={() => {
					demoteDialogOpen = false;
					pendingDemote = null;
				}}
				class="rounded-lg"
			>
				ยกเลิก
			</Button>
			<Button
				disabled={updateMutation.isPending || !pendingDemote}
				onclick={confirmDemote}
				class="rounded-lg bg-[#0f2d5c] text-white hover:bg-[#0a1e3f]"
			>
				{#if updateMutation.isPending}กำลังบันทึก...{:else}ยืนยัน{/if}
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>
