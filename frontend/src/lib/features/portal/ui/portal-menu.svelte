<script lang="ts">
	import { resolve } from '$app/paths';
	import Globe from '@lucide/svelte/icons/globe';
	import {
		PORTAL_PUBLIC_LINK,
		canSeePortalPublicLink,
		filterPortalMenu,
		type PortalFeatures
	} from '../domain/portal-menu';
	import PortalDepartmentSection from './portal-department-section.svelte';

	interface Props {
		roles: readonly string[];
		selectedShelterCode: string | null | undefined;
		features: PortalFeatures;
	}

	let { roles, selectedShelterCode, features }: Props = $props();

	const departments = $derived(
		filterPortalMenu({ roles, shelterCode: selectedShelterCode, features })
	);
	const showPublicLink = $derived(canSeePortalPublicLink(roles));
</script>

<div class="space-y-6">
	{#if departments.length > 0}
		{#each departments as department (department.id)}
			<PortalDepartmentSection {department} {selectedShelterCode} />
		{/each}
	{:else}
		<div
			class="rounded-xl border border-slate-200/80 bg-white p-6 text-center text-base text-slate-600 shadow-2xs"
		>
			ยังไม่มีเมนูสำหรับบทบาทของคุณในศูนย์นี้
		</div>
	{/if}

	{#if showPublicLink}
		<footer class="border-t border-slate-200/80 pt-4">
			<a
				href={resolve(PORTAL_PUBLIC_LINK.href)}
				class="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-medium text-slate-600 underline-offset-4 hover:text-slate-900 hover:underline focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none"
			>
				<Globe class="size-4" aria-hidden="true" />
				{PORTAL_PUBLIC_LINK.label}
			</a>
		</footer>
	{/if}
</div>
