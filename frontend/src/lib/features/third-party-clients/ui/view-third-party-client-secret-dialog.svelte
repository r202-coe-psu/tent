<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import Copy from '@lucide/svelte/icons/copy';
	import { toast } from 'svelte-sonner';
	import {
		revealThirdPartyClientSecretSchema,
		thirdPartyClientDisplayName,
		type ThirdPartyClient
	} from '../domain/third-party-client';
	import { useRevealThirdPartyClientSecret } from '../application/queries';

	let {
		open = $bindable(false),
		target = null
	}: {
		open?: boolean;
		target?: ThirdPartyClient | null;
	} = $props();

	const revealMutation = useRevealThirdPartyClientSecret();

	let password = $state('');
	let revealedSecret = $state<string | null>(null);

	function reset() {
		password = '';
		revealedSecret = null;
	}

	// Always require the password again — never carry a revealed secret across opens.
	function handleOpenChange(next: boolean) {
		open = next;
		if (!next) reset();
	}

	function handleReveal() {
		if (!target) return;
		const parsed = revealThirdPartyClientSecretSchema.safeParse({ password });
		if (!parsed.success) {
			toast.error(parsed.error.issues[0]?.message ?? 'Password is required');
			return;
		}

		revealMutation.mutate(
			{ id: target.id, password: parsed.data.password },
			{
				onSuccess: (secret) => {
					revealedSecret = secret;
					password = '';
				},
				onError: (err) => {
					toast.error(err instanceof Error ? err.message : 'Failed to reveal secret');
					password = '';
				}
			}
		);
	}

	async function copySecret() {
		if (!revealedSecret) return;
		try {
			await navigator.clipboard.writeText(revealedSecret);
			toast.success('Client secret copied to clipboard');
		} catch {
			toast.error('Could not copy to clipboard');
		}
	}
</script>

<Dialog.Root bind:open={() => open, handleOpenChange}>
	<Dialog.Content class="overflow-hidden p-0 sm:max-w-[480px]">
		<div class="border-b border-border bg-muted/30 p-6 pb-4">
			<Dialog.Title class="text-xl">View client secret</Dialog.Title>
			<Dialog.Description class="mt-1.5">
				{#if target}
					{thirdPartyClientDisplayName(target)} — confirm it's you before the secret is shown again.
				{/if}
			</Dialog.Description>
		</div>
		<div class="grid gap-4 p-6">
			{#if revealedSecret}
				<div class="grid gap-1.5">
					<span class="text-xs font-semibold text-muted-foreground">Client secret</span>
					<div
						class="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 font-mono text-sm break-all"
					>
						<span class="flex-1 select-all">{revealedSecret}</span>
						<Button
							type="button"
							variant="secondary"
							size="icon"
							class="shrink-0"
							onclick={copySecret}
							aria-label="Copy client secret"
						>
							<Copy class="h-4 w-4" />
						</Button>
					</div>
				</div>
			{:else}
				<div class="grid gap-2">
					<Label for="tpc-reveal-password" class="text-sm font-semibold">Your password</Label>
					<Input
						id="tpc-reveal-password"
						type="password"
						bind:value={password}
						placeholder="••••••••"
						onkeydown={(e) => {
							if (e.key === 'Enter') handleReveal();
						}}
					/>
				</div>
			{/if}
		</div>
		<div class="flex items-center justify-end gap-2 border-t border-border bg-muted/30 p-4">
			<Button variant="ghost" onclick={() => handleOpenChange(false)}>
				{revealedSecret ? 'Done' : 'Cancel'}
			</Button>
			{#if !revealedSecret}
				<Button onclick={handleReveal} disabled={revealMutation.isPending} class="min-w-[100px]">
					{#if revealMutation.isPending}
						Verifying…
					{:else}
						Reveal
					{/if}
				</Button>
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
