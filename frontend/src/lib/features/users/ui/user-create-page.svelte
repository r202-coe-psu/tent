<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { authStore } from '$lib/stores/auth.svelte';
	import {
		isSystemAdmin,
		shelterCodeFromRoles,
		SYSTEM_ADMIN,
		rolesFromAssignments,
		type ShelterAssignment
	} from '$lib/auth/roles';
	import UserForm from './user-form.svelte';
	import { useCreateUser } from '../application/queries';
	import type { CreateUserInput, ShelterAssignmentInput } from '../domain/schema';
	import { safeReturnPath } from '../domain/user-edit-path';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import Copy from '@lucide/svelte/icons/copy';
	import Check from '@lucide/svelte/icons/check';

	let {
		lockedShelterCode,
		allowSystemAdminRole = false,
		backHref
	}: {
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
	const createMutation = useCreateUser();

	let credentialsDialogOpen = $state(false);
	let createdUsername = $state('');
	let createdPassword = $state('');
	let copied = $state(false);

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
		if (from.startsWith('/system-management/shelters/edit/')) {
			const path = from.split('?')[0] ?? '';
			const id = path.slice('/system-management/shelters/edit/'.length);
			if (from.includes('view=users')) {
				return goto(resolve(`/system-management/shelters/edit/${id}?view=users`));
			}
			return goto(resolve(`/system-management/shelters/edit/${id}`));
		}
		if (backHref === '/system-management/users') {
			return goto(resolve('/system-management/users'));
		}
		return goto(resolve('/back-office/users'));
	}

	async function handleCreate(input: CreateUserInput) {
		const userRoles = rolesFromInput(input);
		if (!userRoles) throw new Error('กรุณาระบุศูนย์พักพิงที่สังกัด');
		const result = await createMutation.mutateAsync({
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
		toast.success(
			result.merged
				? `เพิ่มสิทธิ์ในศูนย์นี้ให้ "${input.username}" แล้ว (บัญชีมีอยู่เดิม)`
				: `สร้างผู้ใช้งาน "${input.username}" สำเร็จ`
		);
		createdUsername = input.username;
		createdPassword = input.password;
		copied = false;
		credentialsDialogOpen = true;
	}

	async function copyCredentialsAndClose() {
		const text = `Username: ${createdUsername}\nPassword: ${createdPassword}`;
		await navigator.clipboard.writeText(text);
		copied = true;
		toast.success('คัดลอก Username และรหัสผ่านแล้ว');
		credentialsDialogOpen = false;
	}

	function onCredentialsOpenChange(open: boolean) {
		if (open) {
			credentialsDialogOpen = true;
			return;
		}
		const shouldReturn = Boolean(createdUsername);
		credentialsDialogOpen = false;
		createdUsername = '';
		createdPassword = '';
		copied = false;
		if (shouldReturn) void goBack();
	}
</script>

<svelte:head>
	<title>เพิ่มผู้ใช้ใหม่ — SmartShelter</title>
</svelte:head>

<div class="container mx-auto max-w-[1200px] p-4 sm:p-6">
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
			<UserPlus class="h-8 w-8" />
		</div>
		<div class="min-w-0">
			<h1 class="text-xl font-bold text-slate-900 sm:text-2xl">เพิ่มผู้ใช้ใหม่</h1>
			<p class="mt-1 text-sm text-muted-foreground">
				กำหนดบัญชีผู้ใช้งาน สังกัดองค์กร และบทบาทหน้าที่ในศูนย์พักพิง
			</p>
		</div>
	</div>

	<div class="rounded-2xl border bg-white shadow-xs">
		<UserForm
			onsubmit={handleCreate}
			oncancel={() => goBack()}
			{isSA}
			{allowSystemAdminRole}
			lockedShelterCode={effectiveLock ?? null}
			pending={createMutation.isPending}
			layout="page"
		/>
	</div>
</div>

<Dialog.Root open={credentialsDialogOpen} onOpenChange={onCredentialsOpenChange}>
	<Dialog.Content class="rounded-2xl p-4 sm:max-w-[460px] sm:p-6">
		<Dialog.Header>
			<Dialog.Title class="text-lg font-bold text-emerald-700">สร้างบัญชีเรียบร้อยแล้ว</Dialog.Title
			>
			<Dialog.Description class="pt-2 text-sm text-slate-600">
				คัดลอก Username และรหัสผ่านเพื่อแจ้งผู้ใช้งาน — กดคัดลอกแล้วจะปิดหน้าต่างนี้
			</Dialog.Description>
		</Dialog.Header>

		<div
			class="my-4 space-y-3 rounded-xl border-2 border-dashed border-emerald-300 bg-emerald-50/70 p-4"
		>
			<div>
				<span class="text-xs font-bold tracking-wider text-emerald-800 uppercase">Username</span>
				<div
					class="mt-1 font-mono text-lg font-extrabold tracking-wide break-all text-slate-900 select-all"
				>
					{createdUsername}
				</div>
			</div>
			<div>
				<span class="text-xs font-bold tracking-wider text-emerald-800 uppercase">Password</span>
				<div
					class="mt-1 font-mono text-lg font-extrabold tracking-wide break-all text-slate-900 select-all"
				>
					{createdPassword}
				</div>
			</div>
		</div>

		<div class="flex justify-end">
			<Button
				type="button"
				class="w-full gap-1.5 bg-[#0f2d5c] text-white hover:bg-[#0a1e3f] sm:w-auto"
				onclick={copyCredentialsAndClose}
			>
				{#if copied}
					<Check class="size-4 text-emerald-300" />
					<span>คัดลอกแล้ว</span>
				{:else}
					<Copy class="size-4" />
					<span>คัดลอก Username และรหัสผ่าน</span>
				{/if}
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>
