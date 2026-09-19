<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { authStore } from '$lib/stores/auth.svelte';
	import { formatRoleList, COUCH_ADMIN } from '$lib/auth/roles';
	import {
		fetchAuthStatus,
		updateOwnProfile,
		googleOAuthStartHref,
		unlinkGoogleMfa,
		thaidOAuthStartHref,
		unlinkThaidMfa,
		type AuthStatus
	} from '$lib/features/users';
	import { ownProfileSchema, type OwnProfileInput } from '../domain/profile-schema';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import Link2 from '@lucide/svelte/icons/link-2';
	import Unlink from '@lucide/svelte/icons/unlink';
	import Pencil from '@lucide/svelte/icons/pencil';

	let profile = $state<AuthStatus | null>(null);
	let loading = $state(true);
	let loadError = $state<string | null>(null);

	let editing = $state(false);
	let saving = $state(false);
	let fieldErrors = $state<Partial<Record<keyof OwnProfileInput, string>>>({});

	let form = $state({
		display_name: '',
		phone: '',
		email: '',
		organization: '',
		position: ''
	});

	let unlinkOpen = $state(false);
	let unlinking = $state(false);
	let unlinkThaidOpen = $state(false);
	let unlinkingThaid = $state(false);

	const displayTitle = $derived(profile?.display_name?.trim() || profile?.name?.trim() || '—');
	const initials = $derived(computeInitials(displayTitle, profile?.name));
	const roleBadges = $derived(roleLines(profile?.roles));
	const personnelLabel = $derived(personnelTypeLabel(profile?.personnel_type));
	const isImmutable = $derived(Boolean(profile?.roles?.includes(COUCH_ADMIN)));

	function computeInitials(title: string, username?: string | null): string {
		const source = title !== '—' ? title : (username ?? '');
		const parts = source.trim().split(/\s+/).filter(Boolean);
		if (parts.length === 0) return '?';
		if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
		return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
	}

	function roleLines(roles: string[] | undefined): string[] {
		const formatted = formatRoleList(roles);
		return formatted
			.split(/\n|,/)
			.map((s) => s.trim())
			.filter(Boolean);
	}

	function personnelTypeLabel(type: AuthStatus['personnel_type']): string {
		if (type === 'staff') return 'พนักงาน';
		if (type === 'volunteer') return 'อาสาสมัคร';
		return '—';
	}

	function displayOrDash(value: string | null | undefined): string {
		const trimmed = value?.trim();
		return trimmed ? trimmed : '—';
	}

	function syncFormFromProfile(data: AuthStatus) {
		form = {
			display_name: data.display_name?.trim() || '',
			phone: data.phone?.trim() || '',
			email: data.email?.trim() || '',
			organization: data.organization?.trim() || '',
			position: data.position?.trim() || ''
		};
		fieldErrors = {};
	}

	async function refreshProfile() {
		loading = true;
		loadError = null;
		try {
			profile = await fetchAuthStatus();
			if (!editing) syncFormFromProfile(profile);
		} catch (err) {
			profile = null;
			loadError = err instanceof Error ? err.message : 'โหลดข้อมูลโปรไฟล์ไม่สำเร็จ';
		} finally {
			loading = false;
		}
	}

	function startEdit() {
		if (!profile) return;
		syncFormFromProfile(profile);
		editing = true;
	}

	function cancelEdit() {
		if (profile) syncFormFromProfile(profile);
		editing = false;
		fieldErrors = {};
	}

	async function handleSave() {
		const parsed = ownProfileSchema.safeParse(form);
		if (!parsed.success) {
			const next: Partial<Record<keyof OwnProfileInput, string>> = {};
			for (const issue of parsed.error.issues) {
				const key = issue.path[0];
				if (typeof key === 'string' && !(key in next)) {
					next[key as keyof OwnProfileInput] = issue.message;
				}
			}
			fieldErrors = next;
			toast.error('กรุณาตรวจสอบข้อมูลที่กรอก');
			return;
		}

		fieldErrors = {};
		saving = true;
		try {
			const result = await updateOwnProfile({
				display_name: parsed.data.display_name,
				phone: parsed.data.phone || null,
				email: parsed.data.email || null,
				organization: parsed.data.organization || null,
				position: parsed.data.position || null
			});
			authStore.setDisplayName(result.display_name);
			toast.success('บันทึกโปรไฟล์สำเร็จ');
			editing = false;
			await refreshProfile();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'บันทึกโปรไฟล์ไม่สำเร็จ');
		} finally {
			saving = false;
		}
	}

	const hasGoogle = $derived(
		Boolean(profile?.mfa_provider_email || profile?.mfa_providers?.includes('google'))
	);
	const hasThaid = $derived(
		Boolean(
			profile?.mfa_thaid_name ||
			profile?.mfa_thaid_pid_masked ||
			profile?.mfa_providers?.includes('thaid')
		)
	);

	async function handleUnlink() {
		unlinking = true;
		try {
			await unlinkGoogleMfa();
			toast.success('ถอดการผูก Google MFA แล้ว');
			unlinkOpen = false;
			await refreshProfile();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'ถอดการผูกไม่สำเร็จ');
		} finally {
			unlinking = false;
		}
	}

	async function handleUnlinkThaid() {
		unlinkingThaid = true;
		try {
			await unlinkThaidMfa();
			toast.success('ถอดการผูก ThaID MFA แล้ว');
			unlinkThaidOpen = false;
			await refreshProfile();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'ถอดการผูกไม่สำเร็จ');
		} finally {
			unlinkingThaid = false;
		}
	}

	onMount(async () => {
		const mfa = page.url.searchParams.get('mfa');
		if (mfa === 'linked') {
			toast.success('ผูกบัญชี Google สำหรับ MFA สำเร็จ');
		} else if (mfa === 'conflict') {
			toast.error('บัญชี Google นี้ถูกผูกกับผู้ใช้อื่นแล้ว');
		} else if (mfa === 'thaid_linked') {
			toast.success('ผูกบัญชี ThaID สำหรับ MFA สำเร็จ');
		} else if (mfa === 'thaid_conflict') {
			toast.error('บัญชี ThaID นี้ถูกผูกกับผู้ใช้อื่นแล้ว');
		}
		await refreshProfile();
	});
</script>

<div class="min-h-full bg-[#F8FAFC] px-4 py-6 sm:px-6">
	<div class="mx-auto flex max-w-4xl flex-col gap-6">
		{#if loading && !profile}
			<p class="text-base text-slate-500">กำลังโหลดโปรไฟล์...</p>
		{:else if loadError && !profile}
			<div
				class="rounded-xl border border-red-200 bg-white p-4 text-base text-red-900 shadow-2xs"
				role="alert"
			>
				<p class="font-semibold">โหลดข้อมูลไม่สำเร็จ</p>
				<p class="mt-1 text-sm text-red-800">{loadError}</p>
				<Button class="mt-4 min-h-11" variant="outline" onclick={refreshProfile}>
					ลองอีกครั้ง
				</Button>
			</div>
		{:else if profile}
			<!-- Hero / identity -->
			<section class="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs sm:p-6">
				<div class="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
					<div class="flex items-start gap-4">
						<div
							class="flex size-16 shrink-0 items-center justify-center rounded-full bg-[#0A2647] text-lg font-bold text-white"
							aria-hidden="true"
						>
							{initials}
						</div>
						<div class="min-w-0 space-y-2">
							<h1 class="text-2xl font-bold text-[#0A2647]">{displayTitle}</h1>
							<p class="text-base text-slate-500">{profile.name}</p>
							<div class="flex flex-wrap items-center gap-2">
								{#each roleBadges as badge (badge)}
									<Badge
										variant="outline"
										class="border-slate-200/80 bg-slate-50 text-xs font-semibold text-slate-800"
									>
										{badge}
									</Badge>
								{/each}
								<span
									class="inline-flex items-center rounded-full border border-slate-200/80 bg-white px-2.5 py-0.5 text-xs font-semibold text-slate-600"
								>
									{personnelLabel}
								</span>
							</div>
						</div>
					</div>
					{#if !editing && !isImmutable}
						<Button
							class="min-h-11 w-full gap-2 bg-[#0A2647] text-white hover:bg-[#051930] sm:w-auto"
							onclick={startEdit}
						>
							<Pencil class="size-4" />
							แก้ไขข้อมูล
						</Button>
					{/if}
				</div>
			</section>

			<!-- Contact & affiliation -->
			<section class="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs sm:p-6">
				<h2 class="mb-4 text-lg font-bold text-slate-900 sm:text-xl">ข้อมูลติดต่อและสังกัด</h2>

				{#if editing}
					<form
						class="space-y-4"
						onsubmit={(e) => {
							e.preventDefault();
							void handleSave();
						}}
					>
						<div class="grid gap-4 sm:grid-cols-2">
							<div class="space-y-2 sm:col-span-2">
								<Label for="profile-display-name" class="text-sm font-semibold text-slate-700">
									ชื่อที่แสดง
								</Label>
								<Input
									id="profile-display-name"
									class="min-h-11"
									bind:value={form.display_name}
									disabled={saving}
									autocomplete="name"
									aria-invalid={fieldErrors.display_name ? 'true' : undefined}
								/>
								{#if fieldErrors.display_name}
									<p class="text-sm text-red-600">{fieldErrors.display_name}</p>
								{/if}
							</div>
							<div class="space-y-2">
								<Label for="profile-phone" class="text-sm font-semibold text-slate-700">
									เบอร์โทรศัพท์
								</Label>
								<Input
									id="profile-phone"
									class="min-h-11"
									bind:value={form.phone}
									disabled={saving}
									inputmode="tel"
									autocomplete="tel"
									placeholder="0XXXXXXXXX"
									aria-invalid={fieldErrors.phone ? 'true' : undefined}
								/>
								{#if fieldErrors.phone}
									<p class="text-sm text-red-600">{fieldErrors.phone}</p>
								{/if}
							</div>
							<div class="space-y-2">
								<Label for="profile-email" class="text-sm font-semibold text-slate-700">
									อีเมล
								</Label>
								<Input
									id="profile-email"
									type="email"
									class="min-h-11"
									bind:value={form.email}
									disabled={saving}
									autocomplete="email"
									aria-invalid={fieldErrors.email ? 'true' : undefined}
								/>
								{#if fieldErrors.email}
									<p class="text-sm text-red-600">{fieldErrors.email}</p>
								{/if}
							</div>
							<div class="space-y-2">
								<Label for="profile-organization" class="text-sm font-semibold text-slate-700">
									หน่วยงาน / องค์กร
								</Label>
								<Input
									id="profile-organization"
									class="min-h-11"
									bind:value={form.organization}
									disabled={saving}
									autocomplete="organization"
									aria-invalid={fieldErrors.organization ? 'true' : undefined}
								/>
								{#if fieldErrors.organization}
									<p class="text-sm text-red-600">{fieldErrors.organization}</p>
								{/if}
							</div>
							<div class="space-y-2">
								<Label for="profile-position" class="text-sm font-semibold text-slate-700">
									ตำแหน่ง
								</Label>
								<Input
									id="profile-position"
									class="min-h-11"
									bind:value={form.position}
									disabled={saving}
									autocomplete="organization-title"
									aria-invalid={fieldErrors.position ? 'true' : undefined}
								/>
								{#if fieldErrors.position}
									<p class="text-sm text-red-600">{fieldErrors.position}</p>
								{/if}
							</div>
						</div>
						<div class="flex flex-col gap-3 pt-2 sm:flex-row sm:justify-end">
							<Button
								type="button"
								variant="outline"
								class="min-h-11 w-full sm:w-auto"
								disabled={saving}
								onclick={cancelEdit}
							>
								ยกเลิก
							</Button>
							<Button
								type="submit"
								class="min-h-11 w-full bg-[#0A2647] text-white hover:bg-[#051930] sm:w-auto"
								disabled={saving}
							>
								{saving ? 'กำลังบันทึก...' : 'บันทึก'}
							</Button>
						</div>
					</form>
				{:else}
					<dl class="grid gap-4 sm:grid-cols-2">
						<div class="space-y-1">
							<dt class="text-sm font-semibold text-slate-700">เบอร์โทรศัพท์</dt>
							<dd class="text-base text-slate-900">{displayOrDash(profile.phone)}</dd>
						</div>
						<div class="space-y-1">
							<dt class="text-sm font-semibold text-slate-700">อีเมล</dt>
							<dd class="text-base text-slate-900">{displayOrDash(profile.email)}</dd>
						</div>
						<div class="space-y-1">
							<dt class="text-sm font-semibold text-slate-700">หน่วยงาน / องค์กร</dt>
							<dd class="text-base text-slate-900">{displayOrDash(profile.organization)}</dd>
						</div>
						<div class="space-y-1">
							<dt class="text-sm font-semibold text-slate-700">ตำแหน่ง</dt>
							<dd class="text-base text-slate-900">{displayOrDash(profile.position)}</dd>
						</div>
					</dl>
				{/if}
			</section>

			<!-- Security / MFA Linked Accounts -->
			<section class="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs sm:p-6">
				<div class="mb-4">
					<h2 class="flex items-center gap-2 text-lg font-bold text-slate-900 sm:text-xl">
						<ShieldCheck class="size-5 text-[#0A2647]" />
						ความปลอดภัย — การผูกบัญชี (MFA)
					</h2>
					<p class="text-sm text-slate-500">ผูกบัญชีเพื่อยืนยันตัวตนแบบหลายขั้นตอน</p>
				</div>

				<div class="grid max-w-sm grid-cols-2 gap-3 sm:max-w-md sm:gap-4">
					<!-- Google MFA Card -->
					<div
						class="flex aspect-square flex-col items-center justify-between rounded-2xl border p-3.5 text-center shadow-2xs transition-all sm:p-4 {hasGoogle
							? 'border-emerald-200 bg-emerald-50/20'
							: 'border-slate-200/80 bg-white'}"
					>
						<!-- Top: Icon & Name -->
						<div class="flex flex-col items-center gap-1.5 pt-0.5">
							<div
								class="flex size-11 items-center justify-center rounded-xl border border-slate-100 bg-white p-2 shadow-2xs"
							>
								<svg class="size-7" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
									<path
										d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
										fill="#4285F4"
									/>
									<path
										d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
										fill="#34A853"
									/>
									<path
										d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
										fill="#FBBC05"
									/>
									<path
										d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
										fill="#EA4335"
									/>
								</svg>
							</div>
							<span class="text-sm font-bold text-slate-800">Google</span>
						</div>

						<!-- Center: Status & Linked Info -->
						<div class="flex w-full min-w-0 flex-col items-center gap-0.5 px-1">
							{#if hasGoogle}
								<span
									class="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800"
								>
									<span class="size-1.5 rounded-full bg-emerald-500"></span>
									ผูกบัญชีแล้ว
								</span>
								<p
									class="w-full truncate text-xs text-slate-600"
									title={profile.mfa_provider_email || ''}
								>
									{profile.mfa_provider_email || 'เชื่อมต่อแล้ว'}
								</p>
							{:else if isImmutable}
								<span class="text-xs text-slate-400">ไม่รองรับ</span>
							{:else}
								<span
									class="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500"
								>
									ยังไม่ได้ผูก
								</span>
								<p class="text-xs text-slate-400">—</p>
							{/if}
						</div>

						<!-- Bottom: Action Button -->
						<div class="w-full">
							{#if hasGoogle}
								<Button
									variant="outline"
									class="h-8 w-full border-red-200 text-xs font-medium text-red-600 hover:bg-red-50 hover:text-red-700"
									onclick={() => (unlinkOpen = true)}
								>
									<Unlink class="mr-1 size-3.5" />
									ยกเลิกการผูก
								</Button>
							{:else if !isImmutable}
								<Button
									href={googleOAuthStartHref('link')}
									class="h-8 w-full bg-[#0A2647] text-xs font-semibold text-white hover:bg-[#051930]"
								>
									<Link2 class="mr-1 size-3.5" />
									ผูกบัญชี
								</Button>
							{/if}
						</div>
					</div>

					<!-- ThaID MFA Card -->
					<div
						class="flex aspect-square flex-col items-center justify-between rounded-2xl border p-3.5 text-center shadow-2xs transition-all sm:p-4 {hasThaid
							? 'border-emerald-200 bg-emerald-50/20'
							: 'border-slate-200/80 bg-white'}"
					>
						<!-- Top: Icon & Name -->
						<div class="flex flex-col items-center gap-1.5 pt-0.5">
							<div
								class="flex size-11 items-center justify-center rounded-xl border border-slate-100 bg-white p-1 shadow-2xs"
							>
								<img src="/thaid-logo.png" alt="ThaID" class="size-9 rounded-lg object-contain" />
							</div>
							<span class="text-sm font-bold text-slate-800">ThaID</span>
						</div>

						<!-- Center: Status & Linked Info -->
						<div class="flex w-full min-w-0 flex-col items-center gap-0.5 px-1">
							{#if hasThaid}
								<span
									class="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800"
								>
									<span class="size-1.5 rounded-full bg-emerald-500"></span>
									ผูกบัญชีแล้ว
								</span>
								<p
									class="w-full truncate text-xs text-slate-600"
									title={[profile.mfa_thaid_name, profile.mfa_thaid_pid_masked]
										.filter(Boolean)
										.join(' • ')}
								>
									{profile.mfa_thaid_pid_masked || profile.mfa_thaid_name || 'เชื่อมต่อแล้ว'}
								</p>
							{:else if isImmutable}
								<span class="text-xs text-slate-400">ไม่รองรับ</span>
							{:else}
								<span
									class="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500"
								>
									ยังไม่ได้ผูก
								</span>
								<p class="text-xs text-slate-400">—</p>
							{/if}
						</div>

						<!-- Bottom: Action Button -->
						<div class="w-full">
							{#if hasThaid}
								<Button
									variant="outline"
									class="h-8 w-full border-red-200 text-xs font-medium text-red-600 hover:bg-red-50 hover:text-red-700"
									onclick={() => (unlinkThaidOpen = true)}
								>
									<Unlink class="mr-1 size-3.5" />
									ยกเลิกการผูก
								</Button>
							{:else if !isImmutable}
								<Button
									href={thaidOAuthStartHref('link')}
									class="h-8 w-full bg-[#0A2647] text-xs font-semibold text-white hover:bg-[#051930]"
								>
									<Link2 class="mr-1 size-3.5" />
									ผูกบัญชี
								</Button>
							{/if}
						</div>
					</div>
				</div>

				<!-- Unlink Confirmation Dialogs -->
				<Dialog.Root bind:open={unlinkOpen}>
					<Dialog.Content class="sm:max-w-md">
						<Dialog.Header>
							<Dialog.Title>ถอดการผูก Google MFA?</Dialog.Title>
							<Dialog.Description>
								หลังถอดแล้ว จะไม่ต้องยืนยัน Google ตอนเข้าสู่ระบบ จนกว่าจะผูกใหม่
							</Dialog.Description>
						</Dialog.Header>
						<div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
							<Button variant="outline" class="min-h-11" onclick={() => (unlinkOpen = false)}>
								ยกเลิก
							</Button>
							<Button
								variant="destructive"
								class="min-h-11"
								disabled={unlinking}
								onclick={handleUnlink}
							>
								{unlinking ? 'กำลังถอด...' : 'ยืนยันถอดการผูก'}
							</Button>
						</div>
					</Dialog.Content>
				</Dialog.Root>

				<Dialog.Root bind:open={unlinkThaidOpen}>
					<Dialog.Content class="sm:max-w-md">
						<Dialog.Header>
							<Dialog.Title>ถอดการผูก ThaID MFA?</Dialog.Title>
							<Dialog.Description>
								หลังถอดแล้ว จะไม่ต้องยืนยัน ThaID ตอนเข้าสู่ระบบ จนกว่าจะผูกใหม่
							</Dialog.Description>
						</Dialog.Header>
						<div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
							<Button variant="outline" class="min-h-11" onclick={() => (unlinkThaidOpen = false)}>
								ยกเลิก
							</Button>
							<Button
								variant="destructive"
								class="min-h-11"
								disabled={unlinkingThaid}
								onclick={handleUnlinkThaid}
							>
								{unlinkingThaid ? 'กำลังถอด...' : 'ยืนยันถอดการผูก'}
							</Button>
						</div>
					</Dialog.Content>
				</Dialog.Root>
			</section>

			<!-- Read-only note -->
			<p class="text-sm text-slate-500">
				ไม่สามารถแก้ไขชื่อผู้ใช้หรือบทบาทได้ที่นี่ — ติดต่อผู้ดูแลระบบหากต้องการเปลี่ยนแปลง
			</p>
		{/if}
	</div>
</div>
