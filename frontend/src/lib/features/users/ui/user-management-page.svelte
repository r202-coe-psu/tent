<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { authStore } from '$lib/stores/auth.svelte';
	import {
		isAppSystemAdmin,
		isSystemAdmin,
		roleDisplayLabel,
		shelterCodeFromRoles,
		shelterCodesFromRoles,
		assignmentsFromRoles
	} from '$lib/auth/roles';
	import UserList from './user-list.svelte';
	import { useUsers, useDeleteUser } from '../application/queries';
	import {
		adminResetPassword,
		unlinkGoogleMfa,
		unlinkThaidMfa,
		type UserSummary
	} from '../data/users.api';
	import { usersKeys } from '../application/queries';
	import {
		usersListBaseFromPathname,
		withUsersView
	} from '../domain/user-edit-path';
	import { UserPlus, Search, KeyRound, Copy, Check, ShieldAlert, Unlink } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { useQueryClient } from '@tanstack/svelte-query';

	let {
		lockedShelterCode,
		compact = false
	}: {
		/** When set, list and forms are scoped to this shelter — no picker. */
		lockedShelterCode?: string;
		/** Embedded in shelter settings: smaller heading so it doesn't clash. */
		compact?: boolean;
	} = $props();

	const roles = $derived(authStore.user?.roles ?? []);
	const isSA = $derived(isSystemAdmin(roles));
	const ownShelterCode = $derived(shelterCodeFromRoles(roles));
	const effectiveLock = $derived(
		lockedShelterCode || (!isSA ? (ownShelterCode ?? undefined) : undefined)
	);

	const queryClient = useQueryClient();
	const usersQuery = useUsers();
	const deleteMutation = useDeleteUser();

	let deleteDialogOpen = $state(false);
	let resetDialogOpen = $state(false);
	let resetResultDialogOpen = $state(false);
	let unlinkMfaDialogOpen = $state(false);
	let unlinkMfaProvider = $state<'google' | 'thaid'>('google');

	let searchQuery = $state('');
	let selectedUser = $state<UserSummary | null>(null);
	let userToDelete = $state<string | null>(null);
	let temporaryPassword = $state<string | null>(null);
	let copied = $state(false);
	let resetting = $state(false);
	let unlinkingMfa = $state(false);

	function editHref(user: UserSummary): string {
		const listBase = usersListBaseFromPathname(page.url.pathname);
		const from = withUsersView(page.url.pathname, page.url.search);
		const path =
			listBase === '/system-management/users'
				? resolve(`/system-management/users/${encodeURIComponent(user.name)}`)
				: resolve(`/back-office/users/${encodeURIComponent(user.name)}`);
		return `${path}?from=${encodeURIComponent(from)}`;
	}

	function goCreate() {
		const listBase = usersListBaseFromPathname(page.url.pathname);
		const from = withUsersView(page.url.pathname, page.url.search);
		const path =
			listBase === '/system-management/users'
				? resolve('/system-management/users/new')
				: resolve('/back-office/users/new');
		void goto(`${path}?from=${encodeURIComponent(from)}`);
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

	function handleOpenUnlinkMfa(user: UserSummary, provider: 'google' | 'thaid' = 'google') {
		selectedUser = user;
		unlinkMfaProvider = provider;
		unlinkMfaDialogOpen = true;
	}

	async function handleConfirmUnlinkMfa() {
		if (!selectedUser) return;
		unlinkingMfa = true;
		try {
			if (unlinkMfaProvider === 'thaid') {
				await unlinkThaidMfa(selectedUser.name);
				toast.success(`ถอด ThaID MFA ของ "${selectedUser.name}" แล้ว`);
			} else {
				await unlinkGoogleMfa(selectedUser.name);
				toast.success(`ถอด Google MFA ของ "${selectedUser.name}" แล้ว`);
			}
			unlinkMfaDialogOpen = false;
			selectedUser = null;
			await queryClient.invalidateQueries({ queryKey: usersKeys.all });
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'ถอด MFA ไม่สำเร็จ');
		} finally {
			unlinkingMfa = false;
		}
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
			if (effectiveLock && !shelterCodesFromRoles(u.roles).includes(effectiveLock)) return false;
			if (!searchQuery) return true;
			const q = searchQuery.toLowerCase();
			return (
				u.name.toLowerCase().includes(q) ||
				(u.display_name && u.display_name.toLowerCase().includes(q)) ||
				(u.organization && u.organization.toLowerCase().includes(q)) ||
				u.roles.some(
					(r: string) =>
						r.toLowerCase().includes(q) || roleDisplayLabel(r).toLowerCase().includes(q)
				) ||
				assignmentsFromRoles(u.roles).some((a) => a.shelter_code.toLowerCase().includes(q))
			);
		}) ?? []
	);
</script>

<div class={['mx-auto', compact ? 'max-w-none' : 'container max-w-[1200px] p-4 sm:p-6']}>
	<div
		class={[
			'flex flex-col items-stretch justify-between gap-4 sm:flex-row sm:items-center',
			compact ? 'mb-4' : 'mb-8'
		]}
	>
		<div class="flex min-w-0 items-center gap-4">
			<div class="shrink-0 text-blue-900/80">
				<UserPlus class={compact ? 'h-6 w-6' : 'h-8 w-8'} />
			</div>
			<div class="min-w-0">
				<h2 class={compact ? 'text-lg font-bold' : 'text-xl font-bold text-slate-900 sm:text-2xl'}>
					จัดการผู้ใช้งาน (User Management)
				</h2>
				<p class="mt-1 text-sm text-muted-foreground">ค้นหา เพิ่ม และจัดการสิทธิ์บุคลากรในระบบ</p>
			</div>
		</div>

		<Button
			class="w-full shrink-0 rounded-lg bg-[#0f2d5c] px-5 py-5 font-semibold text-white hover:bg-[#0a1e3f] sm:w-auto"
			onclick={goCreate}
		>
			<span class="mr-2">+</span> เพิ่มผู้ใช้ใหม่
		</Button>
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
				{editHref}
				ondelete={confirmDelete}
				onresetpassword={handleOpenReset}
				onunlinkmfa={handleOpenUnlinkMfa}
				pending={deleteMutation.isPending || unlinkingMfa}
			/>
		{/if}
	</div>
</div>

<!-- Unlink MFA Confirmation Dialog -->
<Dialog.Root bind:open={unlinkMfaDialogOpen}>
	<Dialog.Content class="rounded-2xl p-6 sm:max-w-[440px]">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2 text-lg font-bold text-red-700">
				<Unlink class="size-5" /> ถอดการผูก {unlinkMfaProvider === 'thaid' ? 'ThaID' : 'Google'} MFA
			</Dialog.Title>
			<Dialog.Description class="pt-2 text-sm leading-relaxed text-slate-600">
				จะถอดการผูก {unlinkMfaProvider === 'thaid' ? 'ThaID' : 'Google'} ของ
				<strong class="text-slate-900">{selectedUser?.display_name ?? selectedUser?.name}</strong>
				{#if unlinkMfaProvider === 'thaid' && (selectedUser?.mfa_thaid_name || selectedUser?.mfa_thaid_pid_masked)}
					({[selectedUser.mfa_thaid_name, selectedUser.mfa_thaid_pid_masked]
						.filter(Boolean)
						.join(' • ')})
				{:else if unlinkMfaProvider === 'google' && selectedUser?.mfa_google_email}
					({selectedUser.mfa_google_email})
				{/if}
				— หลังถอดแล้วผู้ใช้จะไม่ต้องยืนยันตัวตนด้วย {unlinkMfaProvider === 'thaid'
					? 'ThaID'
					: 'Google'} จนกว่าจะผูกใหม่
			</Dialog.Description>
		</Dialog.Header>
		<div class="mt-4 flex justify-end gap-3">
			<Button
				type="button"
				variant="outline"
				onclick={() => {
					unlinkMfaDialogOpen = false;
					selectedUser = null;
				}}
			>
				ยกเลิก
			</Button>
			<Button variant="destructive" disabled={unlinkingMfa} onclick={handleConfirmUnlinkMfa}>
				{#if unlinkingMfa}กำลังถอด...{:else}ยืนยันถอด MFA{/if}
			</Button>
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
			<div class="mt-2 break-all font-mono text-2xl font-extrabold tracking-wide text-slate-900 select-all">
				{temporaryPassword}
			</div>
		</div>

		<div class="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
			<ShieldAlert class="mt-0.5 size-4 shrink-0 text-amber-600" />
			<span>ผู้ใช้งานจะต้องตั้งรหัสผ่านใหม่ของตนเองทันทีในการเข้าสู่ระบบครั้งถัดไป</span>
		</div>

		<div class="mt-5 flex flex-col-reverse justify-end gap-3 sm:flex-row">
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
		<div class="mt-2 flex flex-col-reverse justify-end gap-3 pt-4 sm:flex-row sm:gap-4">
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
