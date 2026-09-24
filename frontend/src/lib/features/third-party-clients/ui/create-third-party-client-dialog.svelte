<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as RadioGroup from '$lib/components/ui/radio-group/index.js';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import { toast } from 'svelte-sonner';
	import {
		CLIENT_DESCRIPTION_MAX_LENGTH,
		CLIENT_NAME_MAX_LENGTH,
		DEFAULT_SCOPES_BY_MODULE,
		GRANTABLE_SCOPES,
		PARTNER_MODULES,
		PARTNER_MODULE_LABEL,
		SCOPE_LABEL,
		SENSITIVE_SCOPES,
		createThirdPartyClientSchema,
		isPartnerModule,
		type CreatedThirdPartyClient,
		type GrantableScope,
		type PartnerModule
	} from '../domain/third-party-client';
	import { useCreateThirdPartyClient } from '../application/queries';

	let {
		open = $bindable(false),
		oncreated
	}: {
		open?: boolean;
		oncreated: (created: CreatedThirdPartyClient) => void;
	} = $props();

	const createMutation = useCreateThirdPartyClient();

	let name = $state('');
	let description = $state('');
	let moduleName = $state<PartnerModule | ''>('');
	let selectedScopes = $state<GrantableScope[]>([]);

	function resetForm() {
		name = '';
		description = '';
		moduleName = '';
		selectedScopes = [];
	}

	function handleOpenChange(next: boolean) {
		open = next;
		if (!next) resetForm();
	}

	function handleModuleChange(next: string) {
		if (!isPartnerModule(next)) return;
		moduleName = next;
		selectedScopes = [...DEFAULT_SCOPES_BY_MODULE[next]];
	}

	function toggleScope(scope: GrantableScope, checked: boolean) {
		selectedScopes = checked
			? [...selectedScopes, scope]
			: selectedScopes.filter((s) => s !== scope);
	}

	function handleCreate() {
		const parsed = createThirdPartyClientSchema.safeParse({
			name,
			description,
			module_name: moduleName,
			allowed_scopes: selectedScopes
		});
		if (!parsed.success) {
			const first = parsed.error.issues[0]?.message ?? 'Invalid input';
			toast.error(first);
			return;
		}

		createMutation.mutate(parsed.data, {
			onSuccess: (created) => {
				toast.success('Third-party client created');
				open = false;
				resetForm();
				oncreated(created);
			},
			onError: (err) => {
				toast.error(err instanceof Error ? err.message : 'Failed to create client');
			}
		});
	}
</script>

<Dialog.Root bind:open={() => open, handleOpenChange}>
	<Dialog.Content class="overflow-hidden p-0 sm:max-w-[520px]">
		<div class="border-b border-border bg-muted/30 p-6 pb-4">
			<Dialog.Title class="text-xl">Create partner OAuth2 client</Dialog.Title>
			<Dialog.Description class="mt-1.5">
				The client ID and secret are generated for you. The full secret is shown once after creation
				— store it securely, it cannot be recovered.
			</Dialog.Description>
		</div>
		<div class="grid max-h-[70vh] gap-5 overflow-y-auto p-6">
			<div class="grid gap-2">
				<Label for="tpc-name" class="text-sm font-semibold"
					>Name <span class="text-destructive">*</span></Label
				>
				<Input
					id="tpc-name"
					bind:value={name}
					maxlength={CLIENT_NAME_MAX_LENGTH}
					placeholder="e.g. EOC จังหวัดสงขลา"
					class="focus-visible:ring-primary"
				/>
				<p class="text-xs text-muted-foreground">ต้องไม่ซ้ำกับ client อื่น</p>
			</div>
			<div class="grid gap-2">
				<Label for="tpc-description" class="text-sm font-semibold">Description</Label>
				<Textarea
					id="tpc-description"
					bind:value={description}
					maxlength={CLIENT_DESCRIPTION_MAX_LENGTH}
					rows={3}
					placeholder="คำอธิบายเพิ่มเติมเกี่ยวกับคีย์นี้ (ไม่บังคับ)"
				/>
			</div>
			<div class="grid gap-2">
				<span id="tpc-module-label" class="text-sm font-semibold"
					>Module <span class="text-destructive">*</span></span
				>
				<RadioGroup.Root
					value={moduleName}
					onValueChange={handleModuleChange}
					aria-labelledby="tpc-module-label"
					class="grid gap-2 sm:grid-cols-2"
				>
					{#each PARTNER_MODULES as module (module)}
						<label
							for="tpc-module-{module}"
							class="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg border border-border px-3 text-sm {moduleName ===
							module
								? 'border-primary bg-primary/5 font-semibold'
								: ''}"
						>
							<RadioGroup.Item value={module} id="tpc-module-{module}" class="size-4" />
							{PARTNER_MODULE_LABEL[module]}
						</label>
					{/each}
				</RadioGroup.Root>
				<p class="text-xs text-muted-foreground">
					เลือก module แล้วระบบจะตั้ง scopes เริ่มต้นให้ — ปรับเพิ่ม/ลดได้
				</p>
			</div>
			<div class="grid gap-2">
				<span class="text-sm font-semibold">Scopes <span class="text-destructive">*</span></span>
				<div class="grid gap-2">
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
			</div>
		</div>
		<div class="flex items-center justify-end gap-2 border-t border-border bg-muted/30 p-4">
			<Button variant="ghost" onclick={() => handleOpenChange(false)}>Cancel</Button>
			<Button onclick={handleCreate} disabled={createMutation.isPending} class="min-w-[120px]">
				{#if createMutation.isPending}
					<div
						class="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent"
					></div>
					Creating…
				{:else}
					Create client
				{/if}
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>
