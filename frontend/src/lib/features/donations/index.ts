// Domain — documents
export type {
    DonationPreDeclaration
} from './domain/donation';

// Domain — input schemas + factories + transitions + guards
export {
    donationPreDeclarationInputSchema,
    isDonationPreDeclaration
} from './domain/donation';