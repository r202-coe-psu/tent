<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { authStore } from '$lib/stores/auth.svelte';
	import { isSystemAdmin, shelterCodeFromRoles, shelterScopeRole } from '$lib/auth/roles';
	import {
		CreateUserForm,
		EditUserForm,
		UserList,
		useUsers,
		useCreateUser,
		useUpdateUser,
		useDeleteUser,
		type CreateUserInput,
		type EditUserInput,
		type UserSummary
	} from '$lib/features/users';
	import { UserPlus, Search } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';

	const roles = $derived(authStore.user?.roles ?? []);
	const isSA = $derived(isSystemAdmin(roles));
	const shelterCode = $derived(shelterCodeFromRoles(roles));

	const usersQuery = useUsers();
	const createMutation = useCreateUser();
	const updateMutation = useUpdateUser();
	const deleteMutation = useDeleteUser();

	let dialogOpen = $state(false);
	let editDialogOpen = $state(false);
	let deleteDialogOpen = $state(false);
	let searchQuery = $state('');
	let selectedUser = $state<UserSummary | null>(null);
	let userToDelete = $state<string | null>(null);

	function handleCreate(input: CreateUserInput) {
		const code = isSA ? input.shelter_id : shelterCode;
		if (!code) {
			toast.error('A shelter code is required');
			return;
		}
		// Build the canonical roles[]: shelter scope + capability (server re-validates).
		const userRoles = [shelterScopeRole(code), input.capability];
		createMutation.mutate(
			{
				name: input.username,
				password: input.password,
				display_name: input.display_name,
				roles: userRoles,
				affiliation_tags: input.affiliation_tags
			},
			{
				onSuccess: () => {
					toast.success(`User "${input.username}" created`);
					dialogOpen = false;
				},
				onError: (err: Error) => toast.error(err.message)
			}
		);
	}

	function handleEdit(user: UserSummary) {
		selectedUser = user;
		editDialogOpen = true;
	}

	function handleUpdate(input: EditUserInput) {
		if (!selectedUser) return;
		const code = isSA ? input.shelter_id : shelterCode;
		if (!code) {
			toast.error('A shelter code is required');
			return;
		}
		const userRoles = [shelterScopeRole(code), input.capability];
		updateMutation.mutate(
			{
				name: selectedUser.name,
				password: input.password || undefined,
				display_name: input.display_name,
				roles: userRoles,
				affiliation_tags: input.affiliation_tags
			},
			{
				onSuccess: () => {
					toast.success(`User "${selectedUser?.name}" updated`);
					editDialogOpen = false;
					selectedUser = null;
				},
				onError: (err: Error) => toast.error(err.message)
			}
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

	const filteredUsers = $derived(
		usersQuery.data?.filter((u: UserSummary) => {
			if (!searchQuery) return true;
			const q = searchQuery.toLowerCase();
			return u.name.toLowerCase().includes(q) || u.roles.some((r: string) => r.toLowerCase().includes(q));
		}) ?? []
	);
</script>

<div class="container mx-auto max-w-[1200px] p-6">
	<div class="min-h-[500px] rounded-2xl border bg-card p-6 text-card-foreground shadow-sm">
		<!-- Header -->
		<div class="mb-8 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
			<div class="flex items-center gap-4">
				<div class="text-blue-900/80">
					<UserPlus class="h-8 w-8" />
				</div>
				<div>
					<h1 class="text-2xl font-bold">จัดการผู้ใช้งาน (User Management)</h1>
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
						<CreateUserForm
							onsubmit={handleCreate}
							oncancel={() => (dialogOpen = false)}
							{isSA}
							{shelterCode}
							pending={createMutation.isPending}
						/>
					</div>
				</Dialog.Content>
			</Dialog.Root>
		</div>

		<!-- Search -->
		<div class="mb-6 rounded-2xl border bg-slate-50 p-4">
			<div class="relative max-w-full">
				<Search class="absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
				<Input
					bind:value={searchQuery}
					type="text"
					placeholder="ค้นหาชื่อ, Username หรือ Role..."
					class="h-12 rounded-xl border-0 bg-white pl-11 text-base shadow-sm"
				/>
			</div>
		</div>

		<!-- List -->
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
					onedit={handleEdit}
					ondelete={confirmDelete}
					pending={deleteMutation.isPending}
				/>
			{/if}
		</div>
	</div>
</div>

<!-- Edit Dialog -->
<Dialog.Root bind:open={editDialogOpen}>
	<Dialog.Content class="overflow-hidden rounded-2xl p-0 sm:max-w-[500px]">
		<Dialog.Header class="p-6 pb-2">
			<Dialog.Title class="text-xl font-bold">แก้ไขข้อมูลผู้ใช้งาน</Dialog.Title>
		</Dialog.Header>
		<div class="px-6 pb-6">
			{#if selectedUser}
				<EditUserForm
					user={selectedUser}
					onsubmit={handleUpdate}
					oncancel={() => {
						editDialogOpen = false;
						selectedUser = null;
					}}
					{isSA}
					{shelterCode}
					pending={updateMutation.isPending}
				/>
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>

<!-- Confirm Delete Dialog -->
<Dialog.Root bind:open={deleteDialogOpen}>
	<Dialog.Content class="sm:max-w-[400px] p-6 rounded-2xl">
		<Dialog.Header>
			<Dialog.Title class="text-lg font-bold text-red-600">ยืนยันการลบผู้ใช้งาน</Dialog.Title>
			<Dialog.Description class="pt-2 text-sm text-slate-500">
				คุณแน่ใจหรือไม่ว่าต้องการลบผู้ใช้งาน <strong class="text-slate-900">{userToDelete}</strong>?
				การดำเนินการนี้ไม่สามารถย้อนกลับได้
			</Dialog.Description>
		</Dialog.Header>
		<div class="flex gap-4 pt-4 mt-2 justify-end">
			<Button type="button" variant="outline" onclick={() => { deleteDialogOpen = false; userToDelete = null; }} class="rounded-lg">
				ยกเลิก
			</Button>
			<Button
				variant="destructive"
				disabled={deleteMutation.isPending}
				onclick={handleDelete}
				class="bg-red-600 hover:bg-red-700 text-white rounded-lg"
			>
				{#if deleteMutation.isPending}กำลังลบ...{:else}ยืนยันการลบ{/if}
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>
