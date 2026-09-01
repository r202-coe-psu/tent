import { describe, expect, it, vi } from 'vitest';

import {
	buildPublicWriterUserBody,
	ensurePublicWriter,
	publicWriterUserPath,
	type CouchReq
} from './ensure-public-writer';

describe('publicWriterUserPath', () => {
	it('builds the CouchDB _users doc id path', () => {
		expect(publicWriterUserPath('public_writer')).toBe(
			'/_users/org.couchdb.user:public_writer'
		);
	});
});

describe('buildPublicWriterUserBody', () => {
	it('creates a roleless user doc', () => {
		expect(buildPublicWriterUserBody('public_writer', 'secret')).toEqual({
			name: 'public_writer',
			password: 'secret',
			display_name: 'Public Writer (BFF)',
			roles: [],
			type: 'user',
			shelter_id: null,
			affiliation_tags: []
		});
	});
});

describe('ensurePublicWriter', () => {
	const writerUrl = 'http://public_writer:secret@couchdb:5984';

	it('skips when writer URL is unset', async () => {
		const couchReq = vi.fn() as unknown as CouchReq;
		await expect(ensurePublicWriter(couchReq, undefined)).resolves.toEqual({
			outcome: 'skipped'
		});
		expect(couchReq).not.toHaveBeenCalled();
	});

	it('creates the user when PUT returns 201', async () => {
		const couchReq = vi.fn(async () => ({ status: 201, data: { ok: true } })) as CouchReq;
		await expect(ensurePublicWriter(couchReq, writerUrl)).resolves.toEqual({
			outcome: 'created',
			username: 'public_writer'
		});
		expect(couchReq).toHaveBeenCalledWith(
			'PUT',
			'/_users/org.couchdb.user:public_writer',
			buildPublicWriterUserBody('public_writer', 'secret')
		);
	});

	it('treats 409 as already exists', async () => {
		const couchReq = vi.fn(async () => ({ status: 409, data: { error: 'conflict' } })) as CouchReq;
		await expect(ensurePublicWriter(couchReq, writerUrl)).resolves.toEqual({
			outcome: 'already_exists',
			username: 'public_writer'
		});
	});

	it('throws on unexpected PUT status', async () => {
		const couchReq = vi.fn(async () => ({ status: 500, data: null })) as CouchReq;
		await expect(ensurePublicWriter(couchReq, writerUrl)).rejects.toThrow(
			'PUT _users/public_writer failed (HTTP 500)'
		);
	});

	it('dry-run GET reports would_create when missing', async () => {
		const couchReq = vi.fn(async () => ({ status: 404, data: { error: 'not_found' } })) as CouchReq;
		await expect(ensurePublicWriter(couchReq, writerUrl, { dryRun: true })).resolves.toEqual({
			outcome: 'would_create',
			username: 'public_writer'
		});
		expect(couchReq).toHaveBeenCalledWith('GET', '/_users/org.couchdb.user:public_writer');
	});

	it('dry-run GET reports already_exists when present', async () => {
		const couchReq = vi.fn(async () => ({ status: 200, data: { name: 'public_writer' } })) as CouchReq;
		await expect(ensurePublicWriter(couchReq, writerUrl, { dryRun: true })).resolves.toEqual({
			outcome: 'already_exists',
			username: 'public_writer'
		});
	});
});
