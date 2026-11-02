<script lang="ts">
	/**
	 * The system-access button for one volunteer (#1044), shared by the people tab and a job's
	 * applicants. Its label follows the account: give access, edit it, or give it again once it
	 * ended. SA / SM manage an existing account on the users page; a coordinator edits or revokes
	 * it in `volunteer-access-dialog.svelte`. Access is given only to a volunteer whose identity
	 * is verified in this shelter: before that the button opens the identity check instead.
	 */
	import KeyRound from '@lucide/svelte/icons/key-round';
	import SearchCheck from '@lucide/svelte/icons/search-check';
	import UserPen from '@lucide/svelte/icons/user-pen';
	import { toast } from 'svelte-sonner';
	import { resolve } from '$app/paths';
	import { canAccessVolunteerBackoffice, isShelterManager, isSystemAdmin } from '$lib/auth/roles';
	import { authStore } from '$lib/stores/auth.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import VolunteerAccessDialog from './volunteer-access-dialog.svelte';
	import VolunteerQualificationDialog from './volunteer-qualification-dialog.svelte';
	import { identityVerificationStatus } from '../domain/verification';
	import type { VolunteerAccessStatus } from '../domain/volunteer-access-status';
	import type { Volunteer } from '../domain/volunteer.schema';

	let {
		volunteer,
		status,
		shelterLine,
		class: className = ''
	}: {
		volunteer: Volunteer;
		status: VolunteerAccessStatus;
		shelterLine: string;
		class?: string;
	} = $props();

	/** Said when a grant is attempted before the identity check (#1044). */
	const VERIFY_FIRST = 'ต้องยืนยันตัวตนอาสาสมัครก่อนจึงจะออกสิทธิ์ได้';

	const roles = $derived(authStore.user?.roles ?? []);
	// SM/SA grant any role; a volunteer_coordinator a limited, timed one (#955). The BFF enforces
	// both, so no other role sees a button that would 403.
	const canGrant = $derived(canAccessVolunteerBackoffice(roles, volunteer.shelter_code));
	const isManager = $derived(
		isSystemAdmin(roles) || isShelterManager(roles, volunteer.shelter_code)
	);
	// An existing account is managed on the users page, which only SA/SM can open. A coordinator
	// keeps the dialog: it lists the grants to change or revoke (#955 FR-8). An account whose role
	// here ended has lost this shelter's scope, so only SA still reaches it there; a shelter
	// manager leaves it to the coordinator's "ออกสิทธิ์อีกครั้ง".
	const managesOnUsersPage = $derived(
		isManager && status.kind !== 'none' && (status.kind !== 'lapsed' || isSystemAdmin(roles))
	);
	const managerCannotReach = $derived(isManager && !managesOnUsersPage && status.kind === 'lapsed');
	// A closed profile is reopened first (card button "เปิดใช้งานอีกครั้ง"): no access button
	// (CR-221 FR-9, FR-21). An account an admin disabled gives a coordinator nothing to press:
	// a save would be refused (FR-9, FR-23).
	const profileClosed = $derived(volunteer.status === 'inactive');
	const accountSuspended = $derived(status.kind === 'deactivated' && !isManager);
	const hidesAccessButton = $derived(
		!managesOnUsersPage && !managerCannotReach && (profileClosed || accountSuspended)
	);
	const verified = $derived(identityVerificationStatus(volunteer) === 'verified');
	const label = $derived(
		status.kind === 'active'
			? 'แก้ไขสิทธิ์ใช้งาน'
			: status.kind === 'lapsed'
				? 'ออกสิทธิ์อีกครั้ง'
				: status.kind === 'deactivated'
					? 'จัดการสิทธิ์ใช้งาน'
					: 'ออกสิทธิ์ใช้งานระบบ'
	);
	// Only giving access needs the identity check; editing or revoking an existing role does not.
	const needsVerification = $derived(!verified && status.kind !== 'active');

	let accessOpen = $state(false);
	let verifyOpen = $state(false);

	function openAccess() {
		if (needsVerification) {
			toast.error(VERIFY_FIRST);
			verifyOpen = true;
			return;
		}
		accessOpen = true;
	}
</script>

{#if canGrant}
	<div class="flex flex-col gap-1 {className}">
		{#if managesOnUsersPage && status.kind !== 'none'}
			<Button
				size="sm"
				variant="outline"
				class="gap-1.5"
				href={resolve(
					`/back-office/users/${encodeURIComponent(status.loginName)}` as '/back-office/users'
				)}
			>
				<KeyRound class="h-3.5 w-3.5" />
				จัดการบัญชีผู้ใช้
			</Button>
		{:else if managerCannotReach}
			<p class="text-xs text-muted-foreground">
				ให้ผู้ประสานงานจิตอาสาออกสิทธิ์อีกครั้ง หรือผู้ดูแลระบบจัดการบัญชี
			</p>
		{:else if accountSuspended}
			<p class="text-xs text-muted-foreground">บัญชีถูกระงับโดยผู้ดูแลระบบ</p>
		{:else if profileClosed}
			<!-- Nothing here: the card's "เปิดใช้งานอีกครั้ง" is the way back. -->
		{:else if needsVerification}
			<Button
				size="sm"
				class="gap-1.5 bg-amber-600 text-white hover:bg-amber-700"
				onclick={openAccess}
			>
				<SearchCheck class="h-3.5 w-3.5" />
				ยืนยันตัวตนก่อนออกสิทธิ์
			</Button>
		{:else if status.kind === 'active'}
			<!-- Editing an existing role reads as a secondary action, unlike giving access. -->
			<Button
				size="sm"
				variant="outline"
				class="gap-1.5 border-primary-dark/40 text-primary-dark hover:bg-primary-dark/5"
				onclick={openAccess}
			>
				<UserPen class="h-3.5 w-3.5" />
				{label}
			</Button>
		{:else}
			<Button
				size="sm"
				class="gap-1.5 bg-primary-dark text-white hover:bg-primary-dark/90"
				onclick={openAccess}
			>
				<KeyRound class="h-3.5 w-3.5" />
				{label}
			</Button>
		{/if}
	</div>

	{#if !managesOnUsersPage && !managerCannotReach && !hidesAccessButton}
		<VolunteerAccessDialog bind:open={accessOpen} {volunteer} {shelterLine} />
	{/if}
	<VolunteerQualificationDialog bind:open={verifyOpen} {volunteer} {shelterLine} />
{/if}
