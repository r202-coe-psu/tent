import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../.env');

function loadEnv(): Record<string, string> {
	if (!existsSync(envPath)) return {};
	const lines = readFileSync(envPath, 'utf8').split('\n');
	const env: Record<string, string> = {};
	for (const line of lines) {
		const m = line.match(/^([^#=]+)=(.*)$/);
		if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
	}
	return env;
}

const env = loadEnv();
const rawAdminUrl =
	process.env.COUCHDB_ADMIN_URL || env.COUCHDB_ADMIN_URL || 'http://admin:password@127.0.0.1:5984';

function parseCouchCredentialUrl(rawUrl: string): { url: string; authHeader: string } {
	const parsed = new URL(rawUrl);
	const user = decodeURIComponent(parsed.username);
	const pass = decodeURIComponent(parsed.password);
	parsed.username = '';
	parsed.password = '';
	const base = parsed.toString().replace(/\/$/, '');
	const authHeader = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
	return { url: base, authHeader };
}

const { url: COUCH_BASE, authHeader: AUTH_HEADER } = parseCouchCredentialUrl(rawAdminUrl);

async function couchReq(
	method: string,
	path: string,
	body?: unknown
): Promise<{ status: number; data: unknown }> {
	const res = await fetch(`${COUCH_BASE}${path}`, {
		method,
		headers: {
			'Content-Type': 'application/json',
			Authorization: AUTH_HEADER
		},
		body: body !== undefined ? JSON.stringify(body) : undefined
	});
	const data = await res.json().catch(() => ({}));
	return { status: res.status, data };
}

function hashSecret(secret: string): string {
	return createHash('sha256').update(secret).digest('hex');
}

export async function seedScannerDevice(): Promise<void> {
	const REGISTRY_DB = 'registry';

	// Ensure registry DB exists
	const { status: headStatus } = await couchReq('GET', `/${REGISTRY_DB}`);
	if (headStatus === 404) {
		await couchReq('PUT', `/${REGISTRY_DB}`);
		console.log(`  + Created DB: ${REGISTRY_DB}`);
	}

	const deviceId = 'kiosk-test';
	const secret = 'kisok-test-secret';
	const secretHash = hashSecret(secret);
	const secretPrefix = secret.slice(0, 16) + '...';
	const docId = `scanner_device:${deviceId}`;

	const { status: getStatus, data: existingDoc } = await couchReq(
		'GET',
		`/${REGISTRY_DB}/${encodeURIComponent(docId)}`
	);

	const rev = getStatus === 200 ? (existingDoc as { _rev: string })._rev : undefined;
	const nowIso = new Date().toISOString();

	const scannerDoc = {
		_id: docId,
		...(rev ? { _rev: rev } : {}),
		type: 'scanner_device',
		schema_v: 1,
		device_id: deviceId,
		name: 'Kiosk Test Scanner',
		shelter_code: 'SH001',
		station_name: 'จุดสแกน Kiosk ทดสอบ (Kiosk Test)',
		secret: secret,
		secret_hash: secretHash,
		secret_prefix: secretPrefix,
		status: 'active',
		last_seen_at: null,
		created_at:
			getStatus === 200 ? (existingDoc as { created_at?: string }).created_at || nowIso : nowIso,
		updated_at: nowIso,
		created_by: 'seed'
	};

	const { status: putStatus, data: putData } = await couchReq(
		'PUT',
		`/${REGISTRY_DB}/${encodeURIComponent(docId)}`,
		scannerDoc
	);

	if (putStatus === 201 || putStatus === 200) {
		console.log('✅ Seed Scanner Device Success (Registry):');
		console.log(`   - DB: ${REGISTRY_DB}`);
		console.log(`   - Doc ID: ${docId}`);
		console.log(`   - Device ID: ${deviceId}`);
		console.log(`   - Secret: ${secret}`);
		console.log(`   - Shelter: SH001`);
		console.log(`   - Station: จุดสแกน Kiosk ทดสอบ (Kiosk Test)`);
		console.log(`   - Status: active`);
	} else {
		console.error('❌ Failed to seed scanner device:', putStatus, putData);
		process.exit(1);
	}
}

// Auto-run if executed directly
if (
	import.meta.url === `file://${process.argv[1]}` ||
	process.argv[1]?.endsWith('seed-scanner.ts')
) {
	seedScannerDevice().catch((err) => {
		console.error('Unhandled error in seedScannerDevice:', err);
		process.exit(1);
	});
}
