import { describe, it, expect } from 'vitest';
import { parseCredentialPaste } from './AuthPage';

describe('parseCredentialPaste', () => {
    it('splits the blob we hand reviewers', () => {
        expect(parseCredentialPaste('Email: yc-review@alphagravity.app Password: ycreview2026x'))
            .toEqual({ email: 'yc-review@alphagravity.app', password: 'ycreview2026x' });
    });

    it('handles newlines and label variants', () => {
        expect(parseCredentialPaste('e-mail = a@b.co\n\npass: s3cret'))
            .toEqual({ email: 'a@b.co', password: 's3cret' });
    });

    it('returns null for an ordinary paste so the browser handles it', () => {
        expect(parseCredentialPaste('yc-review@alphagravity.app')).toBeNull();
        expect(parseCredentialPaste('ycreview2026x')).toBeNull();
        expect(parseCredentialPaste('Email: a@b.co')).toBeNull();
    });
});
