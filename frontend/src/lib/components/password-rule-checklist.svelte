<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import X from '@lucide/svelte/icons/x';
	import { PASSWORD_RULES } from '$lib/auth/password-schema';

	/**
	 * The password policy as a live checklist under a password field (#1045): a met rule turns
	 * green, an unmet one stays red. Same rules and wording as the server message.
	 */
	let { password, class: className = '' }: { password: string; class?: string } = $props();

	const checks = $derived(
		PASSWORD_RULES.map((rule) => ({ ...rule, ok: rule.test(password.trim()) }))
	);
</script>

<ul class="grid grid-cols-1 gap-1 text-xs sm:grid-cols-2 {className}" aria-label="เงื่อนไขรหัสผ่าน">
	{#each checks as check (check.key)}
		<li class="flex items-center gap-1.5 {check.ok ? 'text-emerald-700' : 'text-destructive'}">
			{#if check.ok}
				<Check class="size-3.5 shrink-0" aria-hidden="true" />
			{:else}
				<X class="size-3.5 shrink-0" aria-hidden="true" />
			{/if}
			<span>{check.label}</span>
			<span class="sr-only">{check.ok ? '(ผ่าน)' : '(ยังไม่ผ่าน)'}</span>
		</li>
	{/each}
</ul>
