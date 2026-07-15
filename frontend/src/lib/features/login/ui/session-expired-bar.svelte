<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { authStore } from '$lib/stores/auth.svelte';
	import ReauthDialog from './reauth-dialog.svelte';

	let dialogOpen = $state(false);
</script>

{#if authStore.needsReauth}
	<div
		class="flex items-center justify-between gap-4 border-b border-amber-300 bg-amber-50 px-6 py-2 text-sm text-amber-900"
		role="status"
	>
		<span class="inline-flex items-center gap-2">
			<span
				class="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase"
			>
				<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-600"></span>
				Session หมดอายุ
			</span>
			<span>กรุณาเข้าสู่ระบบอีกครั้งเพื่อใช้งานต่อ</span>
		</span>
		<Button
			variant="outline"
			size="sm"
			class="shrink-0 border-amber-400 bg-white text-amber-950 hover:bg-amber-100"
			onclick={() => (dialogOpen = true)}
		>
			Login
		</Button>
	</div>
{/if}

<ReauthDialog bind:open={dialogOpen} />
