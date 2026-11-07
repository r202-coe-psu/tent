import { describe, it, expect } from 'vitest';
import { isSameDestination, pathnameOf, safeInternalPath } from './back-link';

describe('pathnameOf', () => {
	it('keeps a bare path as it is', () => {
		expect(pathnameOf('/back-office/tickets')).toBe('/back-office/tickets');
	});

	it('drops the query string and the hash', () => {
		expect(pathnameOf('/back-office/tickets?status=draft')).toBe('/back-office/tickets');
		expect(pathnameOf('/back-office/tickets#top')).toBe('/back-office/tickets');
		expect(pathnameOf('/back-office/tickets?a=1#top')).toBe('/back-office/tickets');
	});
});

describe('safeInternalPath', () => {
	it('accepts an absolute path inside the app', () => {
		expect(safeInternalPath('/back-office/tickets')).toBe('/back-office/tickets');
		expect(safeInternalPath('/back-office/tickets?status=draft')).toBe(
			'/back-office/tickets?status=draft'
		);
	});

	it('trims surrounding whitespace', () => {
		expect(safeInternalPath('  /back-office/tickets  ')).toBe('/back-office/tickets');
	});

	it.each([null, undefined, '', '   '])('rejects the empty value %p', (value) => {
		expect(safeInternalPath(value)).toBeNull();
	});

	it.each([
		'https://evil.example/steal',
		'http://evil.example',
		'javascript:alert(1)',
		'back-office/tickets',
		'../back-office/tickets'
	])('rejects %s because it is not an absolute in-app path', (value) => {
		expect(safeInternalPath(value)).toBeNull();
	});

	it.each(['//evil.example/steal', '/\\evil.example/steal', '/\\\\evil.example'])(
		'rejects %s because the browser would read it as another origin',
		(value) => {
			expect(safeInternalPath(value)).toBeNull();
		}
	);

	it('rejects a path carrying control characters', () => {
		expect(safeInternalPath('/back\u0000office')).toBeNull();
		expect(safeInternalPath('/\t/evil.example')).toBeNull();
	});
});

describe('isSameDestination', () => {
	it('is true when the previous page is the page we are going back to', () => {
		expect(isSameDestination('/back-office/tickets', '/back-office/tickets')).toBe(true);
	});

	it('ignores the query string on either side', () => {
		expect(isSameDestination('/back-office/tickets', '/back-office/tickets?status=draft')).toBe(
			true
		);
	});

	it('is false for a different page', () => {
		expect(isSameDestination('/back-office/tickets/t-1', '/back-office/tickets')).toBe(false);
	});

	it.each([null, undefined])('is false when there is no previous page (%p)', (value) => {
		expect(isSameDestination(value, '/back-office/tickets')).toBe(false);
	});
});
