<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { resolve } from '$app/paths';
</script>

<div class="container mx-auto max-w-2xl p-6">
	<h1 class="mb-2 text-3xl font-bold">CouchDB Lab</h1>
	<p class="mb-6 text-muted-foreground">SvelteKit SPA + PouchDB live-sync + CouchDB</p>
	<Button href={resolve('/login')}>Login</Button>
</div>
