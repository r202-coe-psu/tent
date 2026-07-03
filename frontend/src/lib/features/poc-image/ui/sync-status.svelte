<script lang="ts">
	import { onMount } from 'svelte';
	import { namedLocalDb } from '$lib/db/pouch';
	import { COUCH_URL } from '$lib/db/couch';
	import { POC_DB } from '$lib/features/poc-image';

	interface SyncEvent {
		id: string;
		time: string;
		type: 'push' | 'pull' | 'paused' | 'active' | 'error' | 'complete';
		message: string;
	}

	let isOnline = $state(true);
	let isSyncing = $state(false);
	let syncDirection = $state<'push' | 'pull' | 'idle' | 'paused' | 'error'>('idle');
	let pendingDocs = $state(0);
	let syncLog = $state<SyncEvent[]>([]);
	let syncHandler = $state<PouchDB.Replication.Sync<object> | null>(null);

	let logCounter = 0;
	function log(type: SyncEvent['type'], message: string) {
		const time = new Date().toLocaleTimeString('th-TH');
		logCounter += 1;
		const id = `${time}_${logCounter}`;
		syncLog = [{ id, time, type, message }, ...syncLog].slice(0, 20);
	}

	function startSync() {
		const db = namedLocalDb(POC_DB);
		// COUCH_URL from $lib/db/couch already resolves PUBLIC_COUCH_PROXY or PUBLIC_COUCHDB_URL
		const remoteUrl = COUCH_URL.startsWith('/')
			? `${window.location.origin}${COUCH_URL}/${POC_DB}`
			: `${COUCH_URL}/${POC_DB}`;

		try {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const remote = new (db as any).constructor(remoteUrl, {
				fetch: (url: string, opts: RequestInit) => fetch(url, { ...opts, credentials: 'include' })
			});
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const handler = (db as any).sync(remote, { live: true, retry: true }) as PouchDB.Replication.Sync<object>;
			syncHandler = handler;

			handler.on('change', (info) => {
				isSyncing = true;
				const docs = (info as { change: { docs_written: number } }).change.docs_written;
				const dir = (info as { direction: string }).direction;
				if (dir === 'push') syncDirection = 'push';
				else if (dir === 'pull') syncDirection = 'pull';
				log(syncDirection as SyncEvent['type'], `${dir === 'push' ? '↑ Push' : '↓ Pull'} ${docs} doc(s)`);
				pendingDocs = Math.max(0, pendingDocs - docs);
			});

			handler.on('paused', () => {
				isSyncing = false;
				syncDirection = 'paused';
				log('paused', 'Sync paused (idle / offline)');
			});

			handler.on('active', () => {
				isSyncing = true;
				syncDirection = 'push';
				log('active', 'Sync resumed');
			});

			handler.on('error', (err) => {
				isSyncing = false;
				syncDirection = 'error';
				const msg = (err as Error)?.message || String(err);
				log('error', `Error: ${msg}`);
			});

			handler.on('complete', () => {
				isSyncing = false;
				syncDirection = 'idle';
				log('complete', 'Sync complete');
				syncHandler = null;
			});

			log('active', `Started sync → ${remoteUrl}`);
		} catch (err) {
			log('error', `Failed to start sync: ${(err as Error).message}`);
		}
	}

	function stopSync() {
		if (syncHandler) {
			(syncHandler as PouchDB.Replication.Sync<object>).cancel();
			syncHandler = null;
		}
		syncDirection = 'idle';
		isSyncing = false;
		log('complete', 'Sync stopped manually');
	}

	function toggleSync() {
		if (syncHandler) stopSync();
		else startSync();
	}

	onMount(() => {
		isOnline = navigator.onLine;
		startSync();
		return () => stopSync();
	});

	// Track document count for pending indicator
	$effect(() => {
		const db = namedLocalDb(POC_DB);
		const feed = db.changes({ live: true, since: 'now' });
		feed.on('change', () => {
			if (syncDirection !== 'push' && syncDirection !== 'pull') {
				pendingDocs += 1;
			}
		});
		return () => feed.cancel();
	});

	// $derived takes an expression, not a function wrapper
	const statusColor = $derived(
		!isOnline || syncDirection === 'error' ? '#ef4444'
		: syncDirection === 'paused' ? '#f59e0b'
		: isSyncing ? '#22c55e'
		: '#6b7280'
	);

	const statusLabel = $derived(
		!isOnline ? 'Offline'
		: syncDirection === 'error' ? 'Error'
		: syncDirection === 'push' ? 'Pushing ↑'
		: syncDirection === 'pull' ? 'Pulling ↓'
		: syncDirection === 'paused' ? 'Paused'
		: 'Idle'
	);
</script>

<svelte:window bind:online={isOnline} />

<div class="sync-panel">
	<div class="sync-header">
		<div class="sync-indicator">
			<span class="dot" style:background-color={statusColor}></span>
			<span class="status-label">{statusLabel}</span>
		</div>
		<div class="sync-controls">
			{#if pendingDocs > 0}
				<span class="pending-badge">{pendingDocs} pending</span>
			{/if}
			<button
				class="sync-toggle"
				class:active={!!syncHandler}
				onclick={toggleSync}
				title={syncHandler ? 'Stop sync' : 'Start sync'}
			>
				{#if isSyncing}
					<span class="spinner">⟳</span>
				{:else}
					⇄
				{/if}
				{syncHandler ? 'Stop' : 'Start'} Sync
			</button>
		</div>
	</div>

	<div class="log-header">
		<span>Sync Log</span>
		<button class="clear-btn" onclick={() => (syncLog = [])}>Clear</button>
	</div>

	<div class="sync-log">
		{#if syncLog.length === 0}
			<p class="empty-log">ยังไม่มี sync event…</p>
		{:else}
			{#each syncLog as entry (entry.id)}
				<div class="log-entry log-{entry.type}">
					<span class="log-time">{entry.time}</span>
					<span class="log-msg">{entry.message}</span>
				</div>
			{/each}
		{/if}
	</div>
</div>

<style>
	.sync-panel {
		background: #1a1a2e;
		border: 1px solid #2d2d4e;
		border-radius: 12px;
		padding: 16px;
		font-family: 'JetBrains Mono', 'Consolas', monospace;
		font-size: 13px;
	}

	.sync-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 12px;
	}

	.sync-indicator {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		transition: background-color 0.3s;
		box-shadow: 0 0 8px currentColor;
	}

	.status-label {
		color: #e2e8f0;
		font-weight: 600;
		letter-spacing: 0.05em;
	}

	.sync-controls {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.pending-badge {
		background: #7c3aed;
		color: white;
		font-size: 11px;
		padding: 2px 8px;
		border-radius: 10px;
		font-weight: 700;
	}

	.sync-toggle {
		display: flex;
		align-items: center;
		gap: 6px;
		background: #2d2d4e;
		color: #a5b4fc;
		border: 1px solid #4338ca;
		padding: 6px 12px;
		border-radius: 8px;
		cursor: pointer;
		font-size: 12px;
		font-weight: 600;
		transition: all 0.2s;
	}

	.sync-toggle:hover {
		background: #4338ca;
		color: white;
	}

	.sync-toggle.active {
		background: #065f46;
		border-color: #10b981;
		color: #6ee7b7;
	}

	.spinner {
		display: inline-block;
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
	}

	.log-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		color: #64748b;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		margin-bottom: 8px;
		padding-bottom: 6px;
		border-bottom: 1px solid #1e293b;
	}

	.clear-btn {
		background: none;
		border: none;
		color: #475569;
		cursor: pointer;
		font-size: 11px;
		padding: 2px 6px;
		border-radius: 4px;
	}

	.clear-btn:hover {
		color: #94a3b8;
	}

	.sync-log {
		max-height: 180px;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.empty-log {
		color: #475569;
		text-align: center;
		padding: 16px;
		margin: 0;
		font-style: italic;
	}

	.log-entry {
		display: flex;
		gap: 10px;
		padding: 4px 6px;
		border-radius: 4px;
		font-size: 12px;
	}

	.log-time {
		color: #475569;
		white-space: nowrap;
		flex-shrink: 0;
	}

	.log-msg {
		color: #94a3b8;
	}

	.log-error .log-msg { color: #fca5a5; }
	.log-push .log-msg { color: #86efac; }
	.log-pull .log-msg { color: #93c5fd; }
	.log-paused .log-msg { color: #fcd34d; }
	.log-active .log-msg { color: #6ee7b7; }
	.log-complete .log-msg { color: #a5b4fc; }
</style>
