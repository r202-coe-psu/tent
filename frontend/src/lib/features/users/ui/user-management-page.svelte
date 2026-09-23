<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { authStore } from '$lib/stores/auth.svelte';
	import {
		isAppSystemAdmin,
		isSystemAdmin,
		isShelterManager,
		roleDisplayLabel,
		shelterCodeFromRoles,
		shelterCodesFromRoles,
		parseCompoundCapability,
		SA_GRANTABLE_CAPABILITIES,
		SYSTEM_ADMIN,
		SHELTER_MANAGER
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
	import { UserPlus, KeyRound, Copy, Check, ShieldAlert, Unlink } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import PaginationControls from '$lib/components/pagination-controls.svelte';
	import { useQueryClient } from '@tanstack/svelte-query';
	import { useShelters } from '$lib/features/shelters';

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
	const sheltersQuery = useShelters();

	let deleteDialogOpen = $state(false);
	let resetDialogOpen = $state(false);
	let resetResultDialogOpen = $state(false);
	let unlinkMfaDialogOpen = $state(false);
	let unlinkMfaProvider = $state<'google' | 'thaid'>('google');

	const PAGE_SIZE = 10;
	let currentPage = $state(1);

	// draft (bound to inputs)
	let usernameDraft = $state('');
	let phoneDraft = $state('');
	let nameDraft = $state('');
	let shelterDraft = $state('');
	let roleDraft = $state('');
	let typeDraft = $state('');

	// applied (used by filteredUsers)
	let usernameFilter = $state('');
	let phoneFilter = $state('');
	let nameFilter = $state('');
	let shelterFilter = $state('');
	let roleFilter = $state('');
	let typeFilter = $state('');

	let selectedUser = $state<UserSummary | null>(null);
	let userToDelete = $state<string | null>(null);
	let temporaryPassword = $state<string | null>(null);
	let copied = $state(false);
	let resetting = $state(false);
	let unlinkingMfa = $state(false);

	const shelterFilterOptions = $derived([
		{ value: '', label: 'ทั้งหมด' },
		...(sheltersQuery.data ?? []).map((s) => ({
			value: s.code,
			label: `${s.code} — ${s.name}`
		}))
	]);

	const roleFilterOptions = [
		{ value: '', label: 'ทั้งหมด' },
		...SA_GRANTABLE_CAPABILITIES.map((cap) => ({
			value: cap,
			label: roleDisplayLabel(cap)
		}))
	];

	const typeFilterOptions = [
		{ value: '', label: 'ทั้งหมด' },
		{ value: 'staff', label: 'เจ้าหน้าที่' },
		{ value: 'volunteer', label: 'จิตอาสา' }
	];

	function applyFilters() {
		usernameFilter = usernameDraft;
		phoneFilter = phoneDraft;
		nameFilter = nameDraft;
		shelterFilter = shelterDraft;
		roleFilter = roleDraft;
		typeFilter = typeDraft;
		currentPage = 1;
	}

	/** Match bare or compound capability — do not use hasStaffCapability (SA would match all). */
	function userMatchesRoleFilter(userRoles: readonly string[], filter: string): boolean {
		if (!filter) return true;
		if (filter === SYSTEM_ADMIN) return isAppSystemAdmin(userRoles);
		if (filter === SHELTER_MANAGER) return isShelterManager(userRoles);
		if (userRoles.includes(filter)) return true;
		return userRoles.some((r) => parseCompoundCapability(r)?.capability === filter);
	}

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

			if (
				!effectiveLock &&
				shelterFilter &&
				!shelterCodesFromRoles(u.roles).includes(shelterFilter)
			) {
				return false;
			}

			const usernameQ = usernameFilter.trim().toLowerCase();
			if (usernameQ && !u.name.toLowerCase().includes(usernameQ)) return false;

			const phoneQ = phoneFilter.trim();
			if (phoneQ) {
				if (!u.phone) return false;
				if (!u.phone.includes(phoneQ)) return false;
			}

			const nameQ = nameFilter.trim().toLowerCase();
			if (nameQ && !(u.display_name ?? '').toLowerCase().includes(nameQ)) return false;

			if (!userMatchesRoleFilter(u.roles, roleFilter)) return false;

			if (typeFilter) {
				const personnelType = u.personnel_type ?? 'staff';
				if (personnelType !== typeFilter) return false;
			}

			return true;
		}) ?? []
	);

	const totalPages = $derived(Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE)));
	const pagedUsers = $derived(
		filteredUsers.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
	);

	$effect(() => {
		const normalizedPage = Math.max(1, Math.min(currentPage, totalPages));
		if (currentPage !== normalizedPage) currentPage = normalizedPage;
	});
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

	<form
		class={compact ? 'mb-4' : 'mb-6'}
		onsubmit={(e) => {
			e.preventDefault();
			applyFilters();
		}}
	>
		<div class="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
			<div class="w-full min-w-0 space-y-2">
				<label for="user-username-filter" class="text-xs font-semibold text-foreground"
					>ชื่อผู้ใช้</label
				>
				<Input
					id="user-username-filter"
					type="search"
					placeholder="ค้นหาชื่อผู้ใช้..."
					bind:value={usernameDraft}
					class="h-11 rounded-xl bg-background shadow-xs"
				/>
			</div>

			<div class="w-full min-w-0 space-y-2">
				<label for="user-phone-filter" class="text-xs font-semibold text-foreground"
					>เบอร์โทร</label
				>
				<Input
					id="user-phone-filter"
					type="search"
					placeholder="ค้นหาเบอร์โทร..."
					bind:value={phoneDraft}
					class="h-11 rounded-xl bg-background shadow-xs"
				/>
			</div>

			<div class="w-full min-w-0 space-y-2">
				<label for="user-name-filter" class="text-xs font-semibold text-foreground"
					>ชื่อ-นามสกุล</label
				>
				<Input
					id="user-name-filter"
					type="search"
					placeholder="ค้นหาชื่อ-นามสกุล..."
					bind:value={nameDraft}
					class="h-11 rounded-xl bg-background shadow-xs"
				/>
			</div>

			{#if !effectiveLock}
				<div class="w-full min-w-0 space-y-2">
					<label for="user-shelter-filter" class="text-xs font-semibold text-foreground"
						>ศูนย์อพยพ</label
					>
					<Select.Root type="single" bind:value={shelterDraft}>
						<Select.Trigger
							id="user-shelter-filter"
							class="h-11 w-full min-w-0 rounded-xl bg-background px-3 shadow-xs"
							aria-label="ศูนย์อพยพ"
						>
							<span class="truncate">
								{shelterFilterOptions.find((option) => option.value === shelterDraft)?.label ??
									'ทั้งหมด'}
							</span>
						</Select.Trigger>
						<Select.Content>
							{#each shelterFilterOptions as option (option.value)}
								<Select.Item value={option.value} label={option.label} />
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
			{/if}

			<div class="w-full min-w-0 space-y-2">
				<label for="user-role-filter" class="text-xs font-semibold text-foreground">บทบาท</label>
				<Select.Root type="single" bind:value={roleDraft}>
					<Select.Trigger
						id="user-role-filter"
						class="h-11 w-full min-w-0 rounded-xl bg-background px-3 shadow-xs"
						aria-label="บทบาท"
					>
						<span class="truncate">
							{roleFilterOptions.find((option) => option.value === roleDraft)?.label ?? 'ทั้งหมด'}
						</span>
					</Select.Trigger>
					<Select.Content>
						{#each roleFilterOptions as option (option.value)}
							<Select.Item value={option.value} label={option.label} />
						{/each}
					</Select.Content>
				</Select.Root>
			</div>

			<div class="w-full min-w-0 space-y-2">
				<label for="user-type-filter" class="text-xs font-semibold text-foreground">ประเภท</label>
				<Select.Root type="single" bind:value={typeDraft}>
					<Select.Trigger
						id="user-type-filter"
						class="h-11 w-full min-w-0 rounded-xl bg-background px-3 shadow-xs"
						aria-label="ประเภท"
					>
						<span class="truncate">
							{typeFilterOptions.find((option) => option.value === typeDraft)?.label ?? 'ทั้งหมด'}
						</span>
					</Select.Trigger>
					<Select.Content>
						{#each typeFilterOptions as option (option.value)}
							<Select.Item value={option.value} label={option.label} />
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
		</div>

		<div class="mt-3 flex justify-end">
			<Button
				type="submit"
				class="h-11 w-full rounded-xl bg-[#0f2d5c] px-6 font-semibold text-white hover:bg-[#0a1e3f] sm:w-auto"
			>
				ค้นหา
			</Button>
		</div>
	</form>

	<div class="overflow-hidden rounded-2xl border bg-white shadow-xs">
		{#if usersQuery.isLoading}
			<div class="p-8 text-center text-sm text-muted-foreground">กำลังโหลดข้อมูลผู้ใช้งาน...</div>
		{:else if usersQuery.isError}
			<div class="p-8 text-center text-sm text-destructive">
				Error: {usersQuery.error?.message}
			</div>
		{:else}
			<UserList
				users={pagedUsers}
				{isSA}
				{editHref}
				ondelete={confirmDelete}
				onresetpassword={handleOpenReset}
				onunlinkmfa={handleOpenUnlinkMfa}
				pending={deleteMutation.isPending || unlinkingMfa}
			/>
			<PaginationControls bind:page={currentPage} count={filteredUsers.length} perPage={PAGE_SIZE} />
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
