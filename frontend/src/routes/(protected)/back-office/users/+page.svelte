<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { authStore } from '$lib/stores/auth.svelte';
	import { isSystemAdmin, shelterCodeFromRoles, shelterScopeRole } from '$lib/auth/roles';
	import {
		CreateUserForm,
		UserList,
		useUsers,
		useCreateUser,
		useDeleteUser,
		type CreateUserInput
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
	const deleteMutation = useDeleteUser();

	let dialogOpen = $state(false);
	let searchQuery = $state('');

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

	function handleDelete(name: string) {
		deleteMutation.mutate(name, {
			onSuccess: () => toast.success(`User "${name}" deleted`),
			onError: (err: Error) => toast.error(err.message)
		});
	}

	const filteredUsers = $derived(
		usersQuery.data?.filter((u) => {
			if (!searchQuery) return true;
			const q = searchQuery.toLowerCase();
			return (
				u.name.toLowerCase().includes(q) ||
				u.roles.some((r) => r.toLowerCase().includes(q))
			);
		}) ?? []
	);
</script>

<div class="container mx-auto p-6 max-w-[1200px]">
	<div class="bg-card text-card-foreground shadow-sm rounded-2xl border p-6 min-h-[500px]">
		<!-- Header -->
		<div class="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
			<div class="flex items-center gap-4">
				<div class="text-blue-900/80">
					<UserPlus class="w-8 h-8" />
				</div>
				<div>
					<h1 class="text-2xl font-bold">จัดการผู้ใช้งาน (User Management)</h1>
					<p class="text-muted-foreground text-sm mt-1">ค้นหาและจัดการสิทธิ์ส่วนบุคคลในระบบ</p>
				</div>
			</div>
			
			<Dialog.Root bind:open={dialogOpen}>
				<Dialog.Trigger>
					{#snippet child({ props })}
						<Button {...props} class="bg-[#0f2d5c] hover:bg-[#0a1e3f] text-white rounded-xl px-6">
							<span class="mr-2">+</span> เพิ่มผู้ใช้
						</Button>
					{/snippet}
				</Dialog.Trigger>
				<Dialog.Content class="sm:max-w-[500px] p-0 overflow-hidden rounded-2xl">
					<Dialog.Header class="p-6 pb-2">
						<Dialog.Title class="text-xl font-bold">เพิ่มผู้ใช้ใหม่</Dialog.Title>
					</Dialog.Header>
					<div class="px-6 pb-6">
						<CreateUserForm
							onsubmit={handleCreate}
							oncancel={() => dialogOpen = false}
							{isSA}
							{shelterCode}
							pending={createMutation.isPending}
						/>
					</div>
				</Dialog.Content>
			</Dialog.Root>
		</div>

		<!-- Search -->
		<div class="bg-slate-50 p-4 rounded-2xl border mb-6">
			<div class="relative max-w-full">
				<Search class="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
				<Input
					bind:value={searchQuery}
					type="text"
					placeholder="ค้นหาชื่อ, Username หรือ Role..."
					class="pl-11 bg-white border-0 shadow-sm h-12 rounded-xl text-base"
				/>
			</div>
		</div>

		<!-- List -->
		<div class="bg-white rounded-2xl border overflow-hidden shadow-sm">
			{#if usersQuery.isLoading}
				<div class="p-8 text-center text-sm text-muted-foreground">Loading...</div>
			{:else if usersQuery.isError}
				<div class="p-8 text-center text-sm text-destructive">Error: {usersQuery.error?.message}</div>
			{:else}
				<UserList
					users={filteredUsers}
					ondelete={handleDelete}
					pending={deleteMutation.isPending}
				/>
			{/if}
		</div>
	</div>
</div>
