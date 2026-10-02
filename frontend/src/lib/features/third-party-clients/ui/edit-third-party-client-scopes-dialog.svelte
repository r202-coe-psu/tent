<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import { toast } from 'svelte-sonner';
	import {
		GRANTABLE_SCOPES,
		SCOPE_LABEL,
		SENSITIVE_SCOPES,
		thirdPartyClientDisplayName,
		updateThirdPartyClientScopesSchema,
		type GrantableScope,
		type ThirdPartyClient
	} from '../domain/third-party-client';
	import { useUpdateThirdPartyClientScopes } from '../application/queries';

	let {
		open = $bindable(false),
		target = null
	}: {
		open?: boolean;
		target?: ThirdPartyClient | null;
	} = $props();

	const updateMutation = useUpdateThirdPartyClientScopes();

	let selectedScopes = $state<GrantableScope[]>([]);

	// Re-seed from the target's current scopes each time a (different) client opens.
	$effect(() => {
		if (target) selectedScopes = [...(target.allowed_scopes as GrantableScope[])];
	});

	function handleOpenChange(next: boolean) {
		open = next;
	}

	function toggleScope(scope: GrantableScope, checked: boolean) {
		selectedScopes = checked
			? [...selectedScopes, scope]
			: selectedScopes.filter((s) => s !== scope);
	}

	function handleSave() {
		if (!target) return;
		const parsed = updateThirdPartyClientScopesSchema.safeParse({
			allowed_scopes: selectedScopes
		});
		if (!parsed.success) {
			toast.error(parsed.error.issues[0]?.message ?? 'Invalid input');
			return;
		}

		updateMutation.mutate(
			{ id: target.id, input: parsed.data },
			{
				onSuccess: () => {
					toast.success('Scopes updated');
					open = false;
				},
				onError: (err) => {
					toast.error(err instanceof Error ? err.message : 'Failed to update scopes');
				}
			}
		);
	}
</script>

<Dialog.Root bind:open={() => open, handleOpenChange}>
	<Dialog.Content class="overflow-hidden p-0 sm:max-w-[480px]">
		<div class="border-b border-border bg-muted/30 p-6 pb-4">
			<Dialog.Title class="text-xl">Edit scopes</Dialog.Title>
			<Dialog.Description class="mt-1.5">
				{#if target}
					{thirdPartyClientDisplayName(target)} — takes effect on the next token this client mints. Tokens
					already issued keep their old scopes until they expire.
				{/if}
			</Dialog.Description>
		</div>
		<div class="grid max-h-[70vh] gap-2 overflow-y-auto p-6">
			{#each GRANTABLE_SCOPES as scope (scope)}
				<div class="rounded-lg border border-border bg-background text-sm">
					<label class="flex items-center gap-3 p-3">
						<Checkbox
							checked={selectedScopes.includes(scope)}
							onCheckedChange={(v) => toggleScope(scope, v === true)}
						/>
						<span>{SCOPE_LABEL[scope]}</span>
					</label>
					{#if SENSITIVE_SCOPES.includes(scope)}
						<div
							class="flex items-start gap-2 rounded-b-lg border-t border-amber-200 bg-amber-50 p-3 text-amber-900"
						>
							<ShieldAlert class="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
							<p class="text-xs leading-normal">
								Grants access to individual occupant records (PDPA-sensitive). Grant only with
								written approval on file for this module.
							</p>
						</div>
					{/if}
				</div>
			{/each}
		</div>
		<div class="flex items-center justify-end gap-2 border-t border-border bg-muted/30 p-4">
			<Button variant="ghost" onclick={() => handleOpenChange(false)}>Cancel</Button>
			<Button onclick={handleSave} disabled={updateMutation.isPending} class="min-w-[100px]">
				{#if updateMutation.isPending}
					Saving…
				{:else}
					Save
				{/if}
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>
