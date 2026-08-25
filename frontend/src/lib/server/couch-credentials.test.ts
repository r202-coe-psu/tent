import { describe, it, expect } from 'vitest';
import { basicAuthHeader, couchUserFromUrl, parseCouchCredentialUrl } from './couch-credentials';

describe('parseCouchCredentialUrl', () => {
	it('splits scheme, credentials and host', () => {
		expect(parseCouchCredentialUrl('http://admin:password@localhost:5984')).toEqual({
			base: 'http://localhost:5984',
			user: 'admin',
			password: 'password'
		});
	});

	it('keeps https and drops a trailing slash', () => {
		expect(parseCouchCredentialUrl('https://writer:s3cret@couch.example.org/')).toEqual({
			base: 'https://couch.example.org',
			user: 'writer',
			password: 's3cret'
		});
	});

	it('percent-decodes the credentials', () => {
		// A password containing `@` must be encoded in the URL or the host split breaks.
		expect(parseCouchCredentialUrl('http://pub%5Fwriter:p%40ss%3Aword@couchdb:5984')).toEqual({
			base: 'http://couchdb:5984',
			user: 'pub_writer',
			password: 'p@ss:word'
		});
	});

	it('keeps a colon in the password (only the first one splits)', () => {
		expect(parseCouchCredentialUrl('http://admin:pa:ss@localhost:5984')?.password).toBe('pa:ss');
	});

	it('returns null for absent or malformed values', () => {
		expect(parseCouchCredentialUrl(undefined)).toBeNull();
		expect(parseCouchCredentialUrl(null)).toBeNull();
		expect(parseCouchCredentialUrl('')).toBeNull();
		// no credentials
		expect(parseCouchCredentialUrl('http://localhost:5984')).toBeNull();
		// no password
		expect(parseCouchCredentialUrl('http://admin@localhost:5984')).toBeNull();
		// unsupported scheme
		expect(parseCouchCredentialUrl('ftp://admin:password@localhost:5984')).toBeNull();
	});
});

describe('couchUserFromUrl', () => {
	it('returns just the username', () => {
		expect(couchUserFromUrl('http://public_writer:pw@couchdb:5984')).toBe('public_writer');
	});

	it('returns null when unset so provisioning can skip the grant', () => {
		expect(couchUserFromUrl(undefined)).toBeNull();
		expect(couchUserFromUrl('not-a-url')).toBeNull();
	});
});

describe('basicAuthHeader', () => {
	it('base64-encodes user:password', () => {
		expect(basicAuthHeader('admin', 'password')).toBe(
			`Basic ${Buffer.from('admin:password').toString('base64')}`
		);
	});
});
