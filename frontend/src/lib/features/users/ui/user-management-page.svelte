<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { authStore } from '$lib/stores/auth.svelte';
	import {
		isAppSystemAdmin,
		isSystemAdmin,
		roleDisplayLabel,
		shelterCodeFromRoles,
		shelterScopeRole,
		SYSTEM_ADMIN
	} from '$lib/auth/roles';
	import UserForm from './user-form.svelte';
	import UserList from './user-list.svelte';
	import { useUsers, useCreateUser, useUpdateUser, useDeleteUser } from '../application/queries';
	import type { CreateUserInput, EditUserInput } from '../domain/schema';
	import type { UserSummary } from '../data/users.api';
	import { UserPlus, Search } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
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

	let dialogOpen = $state(false);
	let editDialogOpen = $state(false);
	let deleteDialogOpen = $state(false);
	let demoteDialogOpen = $state(false);
	let searchQuery = $state('');
	let selectedUser = $state<UserSummary | null>(null);
	let userToDelete = $state<string | null>(null);
	let pendingDemote = $state<EditUserInput | null>(null);

	function rolesFromInput(input: { capability: string; shelter_id?: string }): string[] | null {
		if (input.capability === SYSTEM_ADMIN) return [SYSTEM_ADMIN];
		const code = effectiveLock ?? input.shelter_id;
		if (!code) return null;
		return [shelterScopeRole(code), input.capability];
	}

	/** Rejects on failure — UserForm turns the reason into a Superforms error. */
	async function handleCreate(input: CreateUserInput) {
		const userRoles = rolesFromInput(input);
		if (!userRoles) throw new Error('A shelter code is required');
		await createMutation.mutateAsync({
			name: input.username,
			password: input.password,
			display_name: input.display_name,
			roles: userRoles,
			affiliation_tags: input.affiliation_tags
		});
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
			affiliation_tags: input.affiliation_tags
		});
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

	const filteredUsers = $derived(
		usersQuery.data?.filter((u: UserSummary) => {
			if (effectiveLock && u.shelter_id !== effectiveLock) return false;
			if (!searchQuery) return true;
			const q = searchQuery.toLowerCase();
			return (
				u.name.toLowerCase().includes(q) ||
				u.roles.some(
					(r: string) =>
						r.toLowerCase().includes(q) || roleDisplayLabel(r).toLowerCase().includes(q)
				)
			);
		}) ?? []
	);
</script>

<div class={['mx-auto', compact ? 'max-w-none' : 'container max-w-[1200px] p-6']}>
	<div
		class={[
			'flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center',
			compact ? 'mb-4' : 'mb-8'
		]}
	>
		<div class="flex items-center gap-4">
			<div class="text-blue-900/80">
				<UserPlus class={compact ? 'h-6 w-6' : 'h-8 w-8'} />
			</div>
			<div>
				<h2 class={compact ? 'text-lg font-bold' : 'text-2xl font-bold'}>
					จัดการผู้ใช้งาน (User Management)
				</h2>
				<p class="mt-1 text-sm text-muted-foreground">ค้นหาและจัดการสิทธิ์ส่วนบุคคลในระบบ</p>
			</div>
		</div>

		<Dialog.Root bind:open={dialogOpen}>
			<Dialog.Trigger>
				{#snippet child({ props })}
					<Button
						{...props}
						class="rounded-lg bg-[#0f2d5c] px-5 py-5 font-semibold text-white hover:bg-[#0a1e3f]"
					>
						<span class="mr-2">+</span> เพิ่มผู้ใช้
					</Button>
				{/snippet}
			</Dialog.Trigger>
			<Dialog.Content class="overflow-hidden rounded-2xl p-0 sm:max-w-[500px]">
				<Dialog.Header class="p-6 pb-2">
					<Dialog.Title class="bg-base-300 rounded-t-xl text-xl font-bold"
						>เพิ่มผู้ใช้ใหม่</Dialog.Title
					>
				</Dialog.Header>
				<div class="px-6 pb-6">
					<UserForm
						onsubmit={handleCreate}
						oncancel={() => (dialogOpen = false)}
						{isSA}
						{allowSystemAdminRole}
						lockedShelterCode={effectiveLock ?? null}
						pending={createMutation.isPending}
					/>
				</div>
			</Dialog.Content>
		</Dialog.Root>
	</div>

	<div class={['relative max-w-full', compact ? 'mb-4' : 'mb-6']}>
		<Search class="absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
		<Input
			bind:value={searchQuery}
			type="text"
			placeholder="ค้นหาชื่อ, Username หรือ Role..."
			class="h-12 rounded-xl pl-11 text-base"
		/>
	</div>

	<div class="overflow-hidden rounded-2xl border bg-white shadow-sm">
		{#if usersQuery.isLoading}
			<div class="p-8 text-center text-sm text-muted-foreground">Loading...</div>
		{:else if usersQuery.isError}
			<div class="p-8 text-center text-sm text-destructive">
				Error: {usersQuery.error?.message}
			</div>
		{:else}
			<UserList
				users={filteredUsers}
				{isSA}
				onedit={handleEdit}
				ondelete={confirmDelete}
				pending={deleteMutation.isPending}
			/>
		{/if}
	</div>
</div>

<Dialog.Root bind:open={editDialogOpen}>
	<Dialog.Content class="overflow-hidden rounded-2xl p-0 sm:max-w-[500px]">
		<Dialog.Header class="p-6 pb-2">
			<Dialog.Title class="text-xl font-bold">แก้ไขข้อมูลผู้ใช้งาน</Dialog.Title>
		</Dialog.Header>
		<div class="px-6 pb-6">
			{#if selectedUser}
				<UserForm
					user={selectedUser}
					onsubmit={handleUpdate}
					oncancel={() => {
						editDialogOpen = false;
						selectedUser = null;
					}}
					{isSA}
					{allowSystemAdminRole}
					lockedShelterCode={effectiveLock ?? null}
					pending={updateMutation.isPending}
				/>
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>

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
