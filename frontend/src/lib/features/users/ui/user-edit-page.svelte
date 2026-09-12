<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { authStore } from '$lib/stores/auth.svelte';
	import {
		isAppSystemAdmin,
		isStaffOnly,
		isSystemAdmin,
		shelterCodeFromRoles,
		shelterCodesFromRoles,
		SYSTEM_ADMIN,
		rolesFromAssignments,
		COUCH_ADMIN,
		type ShelterAssignment
	} from '$lib/auth/roles';
	import UserForm from './user-form.svelte';
	import { useUsers, useUpdateUser } from '../application/queries';
	import type { EditUserInput, ShelterAssignmentInput } from '../domain/schema';
	import { safeReturnPath } from '../domain/user-edit-path';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import UserCog from '@lucide/svelte/icons/user-cog';

	let {
		name,
		lockedShelterCode,
		allowSystemAdminRole = false,
		backHref
	}: {
		name: string;
		lockedShelterCode?: string;
		allowSystemAdminRole?: boolean;
		backHref: string;
	} = $props();

	const roles = $derived(authStore.user?.roles ?? []);
	const isSA = $derived(isSystemAdmin(roles));
	const ownShelterCode = $derived(shelterCodeFromRoles(roles));
	const effectiveLock = $derived(
		lockedShelterCode || (!isSA ? (ownShelterCode ?? undefined) : undefined)
	);
	const usersQuery = useUsers();
	const updateMutation = useUpdateUser();

	let demoteDialogOpen = $state(false);
	let pendingDemote = $state<EditUserInput | null>(null);

	const selectedUser = $derived(usersQuery.data?.find((u) => u.name === name) ?? null);
	const outOfScope = $derived(
		Boolean(
			selectedUser &&
			effectiveLock &&
			!shelterCodesFromRoles(selectedUser.roles).includes(effectiveLock)
		)
	);
	const immutable = $derived(Boolean(selectedUser?.roles.includes(COUCH_ADMIN)));
	const forbidden = $derived(Boolean(selectedUser && !isSA && !isStaffOnly(selectedUser.roles)));

	function rolesFromInput(input: {
		is_system_admin?: boolean;
		assignments?: ShelterAssignmentInput[];
		capabilities?: string[];
		capability?: string;
		shelter_id?: string;
	}): string[] | null {
		if (input.is_system_admin || input.capabilities?.includes(SYSTEM_ADMIN)) {
			return [SYSTEM_ADMIN];
		}
		if (input.assignments && input.assignments.length > 0) {
			return rolesFromAssignments(input.assignments as ShelterAssignment[]);
		}
		const caps = (input.capabilities ?? (input.capability ? [input.capability] : [])).filter(
			(c) => c !== SYSTEM_ADMIN
		) as ShelterAssignment['capabilities'];
		const code = effectiveLock ?? input.shelter_id;
		if (!code || caps.length === 0) return null;
		return rolesFromAssignments([{ shelter_code: code, capabilities: caps }]);
	}

	function goBack() {
		const from = safeReturnPath(page.url.searchParams.get('from'), '');
		if (from.startsWith('/back-office/shelters/edit/')) {
			const path = from.split('?')[0] ?? '';
			const id = path.slice('/back-office/shelters/edit/'.length);
			if (from.includes('view=users')) {
				return goto(resolve(`/back-office/shelters/edit/${id}?view=users`));
			}
			return goto(resolve(`/back-office/shelters/edit/${id}`));
		}
		if (from.startsWith('/portal/system-management/shelters/edit/')) {
			const path = from.split('?')[0] ?? '';
			const id = path.slice('/portal/system-management/shelters/edit/'.length);
			if (from.includes('view=users')) {
				return goto(resolve(`/portal/system-management/shelters/edit/${id}?view=users`));
			}
			return goto(resolve(`/portal/system-management/shelters/edit/${id}`));
		}
		if (backHref === '/portal/system-management/users') {
			return goto(resolve('/portal/system-management/users'));
		}
		return goto(resolve('/back-office/users'));
	}

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
		demoteDialogOpen = false;
		pendingDemote = null;
		await goBack();
	}

	async function handleUpdate(input: EditUserInput) {
		if (!selectedUser) return;
		const wasSa = isAppSystemAdmin(selectedUser.roles);
		const willBeSa = Boolean(
			input.is_system_admin ||
			input.capabilities?.includes(SYSTEM_ADMIN) ||
			input.capability === SYSTEM_ADMIN
		);
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
</script>

<svelte:head>
	<title>แก้ไขข้อมูลผู้ใช้งาน — SmartShelter</title>
</svelte:head>

<div class="container mx-auto max-w-[1200px] p-6">
	<button
		type="button"
		class="mb-4 inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground hover:underline"
		onclick={() => goBack()}
	>
		<ArrowLeft class="size-4" />
		<span>กลับไปหน้ารายชื่อผู้ใช้งาน</span>
	</button>

	<div class="mb-6 flex items-center gap-4">
		<div class="text-blue-900/80">
			<UserCog class="h-8 w-8" />
		</div>
		<div class="min-w-0">
			<h1 class="text-2xl font-bold text-slate-900">แก้ไขข้อมูลผู้ใช้งาน</h1>
			<p class="mt-1 truncate text-sm text-muted-foreground">
				{selectedUser?.display_name ?? name}
				{#if selectedUser && selectedUser.display_name}
					<span class="text-slate-400"> · </span>
					<span class="font-mono">{selectedUser.name}</span>
				{/if}
			</p>
		</div>
	</div>

	<div class="rounded-2xl border bg-white shadow-xs">
		{#if usersQuery.isLoading}
			<div class="p-8 text-center text-sm text-muted-foreground">กำลังโหลดข้อมูลผู้ใช้งาน...</div>
		{:else if usersQuery.isError}
			<div class="p-8 text-center text-sm text-destructive">
				Error: {usersQuery.error?.message}
			</div>
		{:else if !selectedUser || outOfScope}
			<div class="p-8 text-center text-sm text-muted-foreground">ไม่พบผู้ใช้งานนี้</div>
		{:else if immutable || forbidden}
			<div class="p-8 text-center text-sm text-muted-foreground">
				บัญชีนี้ไม่สามารถแก้ไขจากหน้านี้ได้
			</div>
		{:else}
			<UserForm
				user={selectedUser}
				onsubmit={handleUpdate}
				oncancel={() => goBack()}
				{isSA}
				{allowSystemAdminRole}
				lockedShelterCode={effectiveLock ?? null}
				pending={updateMutation.isPending}
				layout="page"
			/>
		{/if}
	</div>
</div>

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
