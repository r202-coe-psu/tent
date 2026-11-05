/**
 * Isomorphic entry point for the images feature: the pure domain only.
 *
 * The barrel (`$lib/features/images`) also exports the browser CouchDB repository and
 * TanStack hooks, which server modules (BFF routes, kiosk server) must not load.
 */

export {
	IMAGE_SCHEMA_V,
	detectImageMime,
	isImageDoc,
	type ImageDoc,
	type ImageMime,
	type ImagePurpose
} from './domain/image';
