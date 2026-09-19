<script lang="ts">
	import IdCard from '@lucide/svelte/icons/id-card';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { ThaiDAutofillProfile } from '../../domain/thaid-profile';

	interface Props {
		disabled?: boolean;
		onautofill?: (profile: ThaiDAutofillProfile) => void;
	}

	let {
		disabled = false,
		onautofill: _onautofill
	}: Props = $props();

	let isRedirecting = $state(false);

	function handleRealConnect() {
		if (isRedirecting) return;
		isRedirecting = true;
		const currentUrl = new URL(window.location.href);
		currentUrl.searchParams.delete('error');
		currentUrl.searchParams.delete('thaid');
		const returnTo = currentUrl.pathname + (currentUrl.search ? currentUrl.search : '');
		window.location.href = `/api/v1/auth/oauth/thaid/start?mode=register&return_to=${encodeURIComponent(returnTo)}`;
	}
</script>

<div class="rounded-xl border border-primary/20 bg-primary/5 p-3.5 sm:p-4">
	<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex items-start gap-2.5">
			<div
				class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
			>
				<IdCard class="size-4" />
			</div>
			<div>
				<div class="flex items-center gap-2">
					<span class="text-sm font-semibold text-foreground">ดึงข้อมูลด้วย ThaiD</span>
				</div>
				<p class="mt-0.5 text-xs text-muted-foreground">
					เชื่อมต่อและดึงข้อมูลทะเบียนราษฎร์อัตโนมัติ
				</p>
			</div>
		</div>

		<Button
			type="button"
			variant="outline"
			size="sm"
			disabled={disabled || isRedirecting}
			onclick={handleRealConnect}
			class="min-h-10 border-primary/30 text-primary hover:bg-primary/10"
		>
			{#if isRedirecting}
				<Loader2 class="mr-1.5 size-4 animate-spin" />
				<span>กำลังเชื่อมต่อ ThaiD...</span>
			{:else}
				<Sparkles class="mr-1.5 size-4" />
				<span>เชื่อมต่อ ThaiD</span>
			{/if}
		</Button>
	</div>
</div>
