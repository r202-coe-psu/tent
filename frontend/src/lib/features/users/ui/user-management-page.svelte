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
	import { adminResetPassword, type UserSummary } from '../data/users.api';
	import type { CreateUserInput, EditUserInput } from '../domain/schema';
	import { UserPlus, Search, KeyRound, Copy, Check, ShieldAlert } from '@lucide/svelte';
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
	let resetDialogOpen = $state(false);
	let resetResultDialogOpen = $state(false);

	let searchQuery = $state('');
	let selectedUser = $state<UserSummary | null>(null);
	let userToDelete = $state<string | null>(null);
	let pendingDemote = $state<EditUserInput | null>(null);
	let temporaryPassword = $state<string | null>(null);
	let copied = $state(false);
	let resetting = $state(false);

	function rolesFromInput(input: {
		capabilities?: string[];
		capability?: string;
		shelter_id?: string;
	}): string[] | null {
		const caps = input.capabilities ?? (input.capability ? [input.capability] : []);
		if (caps.includes(SYSTEM_ADMIN)) return [SYSTEM_ADMIN];
		const code = effectiveLock ?? input.shelter_id;
		if (!code) return null;
		return [shelterScopeRole(code), ...caps];
	}

	/** Rejects on failure — UserForm turns the reason into a Superforms error. */
	async function handleCreate(input: CreateUserInput) {
		const userRoles = rolesFromInput(input);
		if (!userRoles) throw new Error('กรุณาระบุศูนย์พักพิงที่สังกัด');
		await createMutation.mutateAsync({
			name: input.username,
			password: input.password,
			display_name: input.display_name,
			roles: userRoles,
			personnel_type: input.personnel_type,
			organization: input.organization,
			position: input.position,
			phone: input.phone,
			email: input.email,
			notes: input.notes,
			volunteer_id: input.volunteer_id,
			duty_window: input.duty_window,
			affiliation_tags: input.affiliation_tags
		});
		toast.success(`สร้างผู้ใช้งาน "${input.username}" สำเร็จ`);
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
		if (!userRoles) throw new Error('กรุณาระบุศูนย์พักพิงที่สังกัด');
		await updateMutation.mutateAsync({
			name: target.name,
			password: input.password || undefined,
			display_name: input.display_name,
			roles: userRoles,
			personnel_type: input.personnel_type,
			organization: input.organization,
			position: input.position,
			phone: input.phone,
			email: input.email,
			notes: input.notes,
			volunteer_id: input.volunteer_id,
			duty_window: input.duty_window,
			affiliation_tags: input.affiliation_tags
		});
		toast.success(`อัปเดตข้อมูลผู้ใช้งาน "${target.name}" สำเร็จ`);
		editDialogOpen = false;
		demoteDialogOpen = false;
		selectedUser = null;
		pendingDemote = null;
	}

	async function handleUpdate(input: EditUserInput) {
		if (!selectedUser) return;
		const wasSa = isAppSystemAdmin(selectedUser.roles);
		const willBeSa =
			input.capabilities?.includes(SYSTEM_ADMIN) || input.capability === SYSTEM_ADMIN;
		if (wasSa && !willBeSa) {
			pendingDemote = input;
			demoteDialogOpen = true;
			return;
		}
		await applyUpdate(input);
	}

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
				toast.success(`ลบผู้ใช้งาน "${userToDelete}" สำเร็จ`);
				deleteDialogOpen = false;
				userToDelete = null;
			},
			onError: (err: Error) => toast.error(err.message)
		});
	}

	function handleOpenReset(user: UserSummary) {
		selectedUser = user;
		resetDialogOpen = true;
	}

	async function handleConfirmReset() {
		if (!selectedUser) return;
		resetting = true;
		try {
			const res = await adminResetPassword(selectedUser.name);
			temporaryPassword = res.temporary_password;
			resetDialogOpen = false;
			resetResultDialogOpen = true;
			toast.success(`รีเซ็ตรหัสผ่านของ "${selectedUser.name}" เรียบร้อยแล้ว`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'ไม่สามารถรีเซ็ตรหัสผ่านได้');
		} finally {
			resetting = false;
		}
	}

	async function copyPassword() {
		if (!temporaryPassword) return;
		await navigator.clipboard.writeText(temporaryPassword);
		copied = true;
		toast.success('คัดลอกรหัสผ่านชั่วคราวแล้ว');
		setTimeout(() => (copied = false), 2500);
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
				(u.display_name && u.display_name.toLowerCase().includes(q)) ||
				(u.organization && u.organization.toLowerCase().includes(q)) ||
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
				<h2 class={compact ? 'text-lg font-bold' : 'text-2xl font-bold text-slate-900'}>
					จัดการผู้ใช้งาน (User Management)
				</h2>
				<p class="mt-1 text-sm text-muted-foreground">ค้นหา เพิ่ม และจัดการสิทธิ์บุคลากรในระบบ</p>
			</div>
		</div>

		<Dialog.Root bind:open={dialogOpen}>
			<Dialog.Trigger>
				{#snippet child({ props })}
					<Button
						{...props}
						class="rounded-lg bg-[#0f2d5c] px-5 py-5 font-semibold text-white hover:bg-[#0a1e3f]"
					>
						<span class="mr-2">+</span> เพิ่มผู้ใช้ใหม่
					</Button>
				{/snippet}
			</Dialog.Trigger>
			<Dialog.Content class="max-h-[90vh] overflow-y-auto rounded-2xl p-0 sm:max-w-[700px]">
				<Dialog.Header class="border-b border-slate-100 p-6 pb-2">
					<Dialog.Title class="text-xl font-bold text-slate-900">เพิ่มผู้ใช้ใหม่</Dialog.Title>
					<Dialog.Description class="text-xs text-slate-500">
						กำหนดบัญชีผู้ใช้งาน สังกัดองค์กร และบทบาทหน้าที่ในศูนย์พักพิง
					</Dialog.Description>
				</Dialog.Header>
				<div class="p-6">
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
			placeholder="ค้นหาชื่อ, เบอร์โทร, สังกัดองค์กร หรือบทบาท..."
			class="h-12 rounded-xl bg-white pl-11 text-base"
		/>
	</div>

	<div class="overflow-hidden rounded-2xl border bg-white shadow-xs">
		{#if usersQuery.isLoading}
			<div class="p-8 text-center text-sm text-muted-foreground">กำลังโหลดข้อมูลผู้ใช้งาน...</div>
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
				onresetpassword={handleOpenReset}
				pending={deleteMutation.isPending}
			/>
		{/if}
	</div>
</div>

<!-- Edit Dialog -->
<Dialog.Root bind:open={editDialogOpen}>
	<Dialog.Content class="max-h-[90vh] overflow-y-auto rounded-2xl p-0 sm:max-w-[700px]">
		<Dialog.Header class="border-b border-slate-100 p-6 pb-2">
			<Dialog.Title class="text-xl font-bold text-slate-900">แก้ไขข้อมูลผู้ใช้งาน</Dialog.Title>
		</Dialog.Header>
		<div class="p-6">
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

<!-- Reset Password Confirmation Dialog -->
<Dialog.Root bind:open={resetDialogOpen}>
	<Dialog.Content class="rounded-2xl p-6 sm:max-w-[440px]">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2 text-lg font-bold text-amber-700">
				<KeyRound class="size-5" /> ยืนยันการรีเซ็ตรหัสผ่านชั่วคราว
			</Dialog.Title>
			<Dialog.Description class="pt-2 text-sm leading-relaxed text-slate-600">
				ระบบจะสร้างรหัสผ่านชั่วคราวแบบจำง่าย (Memorable Passphrase) ให้กับผู้ใช้งาน
				<strong class="text-slate-900">{selectedUser?.display_name ?? selectedUser?.name}</strong>
				และจะบังคับให้ผู้ใช้ต้องตั้งรหัสผ่านใหม่ทันทีเมื่อเข้าสู่ระบบ
			</Dialog.Description>
		</Dialog.Header>
		<div class="mt-4 flex justify-end gap-3">
			<Button
				type="button"
				variant="outline"
				onclick={() => {
					resetDialogOpen = false;
					selectedUser = null;
				}}
			>
				ยกเลิก
			</Button>
			<Button
				class="bg-amber-600 text-white hover:bg-amber-700"
				disabled={resetting}
				onclick={handleConfirmReset}
			>
				{#if resetting}กำลังรีเซ็ต...{:else}ยืนยันรีเซ็ตรหัสผ่าน{/if}
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>

<!-- Reset Result Dialog -->
<Dialog.Root bind:open={resetResultDialogOpen}>
	<Dialog.Content class="rounded-2xl p-6 sm:max-w-[460px]">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2 text-lg font-bold text-emerald-700">
				✓ รหัสผ่านชั่วคราวถูกสร้างเรียบร้อยแล้ว
			</Dialog.Title>
			<Dialog.Description class="pt-2 text-sm text-slate-600">
				กรุณาคัดลอกหรือแจ้งรหัสผ่านชั่วคราวนี้ให้แก่ผู้ใช้งานเพื่อนำไปเข้าสู่ระบบ
			</Dialog.Description>
		</Dialog.Header>

		<div
			class="my-4 rounded-xl border-2 border-dashed border-amber-300 bg-amber-50/70 p-4 text-center"
		>
			<span class="text-xs font-bold tracking-wider text-amber-800 uppercase"
				>รหัสผ่านชั่วคราว (One-Time Passphrase)</span
			>
			<div class="mt-2 font-mono text-2xl font-extrabold tracking-wide text-slate-900 select-all">
				{temporaryPassword}
			</div>
		</div>

		<div class="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
			<ShieldAlert class="mt-0.5 size-4 shrink-0 text-amber-600" />
			<span>ผู้ใช้งานจะต้องตั้งรหัสผ่านใหม่ของตนเองทันทีในการเข้าสู่ระบบครั้งถัดไป</span>
		</div>

		<div class="mt-5 flex justify-end gap-3">
			<Button type="button" variant="outline" class="gap-1.5" onclick={copyPassword}>
				{#if copied}
					<Check class="size-4 text-emerald-600" />
					<span class="text-emerald-700">คัดลอกแล้ว</span>
				{:else}
					<Copy class="size-4" />
					<span>คัดลอกรหัสผ่าน</span>
				{/if}
			</Button>
			<Button
				class="bg-[#0f2d5c] text-white hover:bg-[#0a1e3f]"
				onclick={() => {
					resetResultDialogOpen = false;
					temporaryPassword = null;
					selectedUser = null;
				}}
			>
				เสร็จสิ้น
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>

<!-- Delete Dialog -->
<Dialog.Root bind:open={deleteDialogOpen}>
	<Dialog.Content class="rounded-2xl p-6 sm:max-w-[400px]">
		<Dialog.Header>
			<Dialog.Title class="text-lg font-bold text-red-600">ยืนยันการลบผู้ใช้งาน</Dialog.Title>
			<Dialog.Description class="pt-2 text-sm text-slate-500">
				คุณแน่ใจหรือไม่ว่าต้องการลบผู้ใช้งาน <strong class="text-slate-900">{userToDelete}</strong>?
				การดำเนินการนี้ไม่สามารถย้อนกลับได้
				{#if deletingIsSa}
					<span class="mt-2 block font-medium text-amber-700"
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
			>
				ยกเลิก
			</Button>
			<Button
				variant="destructive"
				disabled={deleteMutation.isPending}
				onclick={handleDelete}
				class="bg-red-600 text-white hover:bg-red-700"
			>
				{#if deleteMutation.isPending}กำลังลบ...{:else}ยืนยันการลบ{/if}
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>

<!-- Demote Dialog -->
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
			>
				ยกเลิก
			</Button>
			<Button
				disabled={updateMutation.isPending || !pendingDemote}
				onclick={confirmDemote}
				class="bg-[#0f2d5c] text-white hover:bg-[#0a1e3f]"
			>
				{#if updateMutation.isPending}กำลังบันทึก...{:else}ยืนยัน{/if}
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>
