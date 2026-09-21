import { firstSentences } from './card';
import { entityTypeOf, resolveHref, targetFor } from './targets';

describe('typed targets: the application names the door, never the model', () => {
  it('knows a record by its code and resolves it to a page the application has', () => {
    expect(entityTypeOf('R-0037')).toBe('recipient');
    expect(entityTypeOf('E-26-0054')).toBe('embryo');
    expect(entityTypeOf('OX-26-0006')).toBe('signal');
    expect(entityTypeOf('CHK-26-0078')).toBeNull();
    expect(resolveHref('recipient', 'R-0037', 'checks')).toBe('/horses/R-0037?focus=checks');
    expect(resolveHref('signal', 'OX-26-0006')).toBe('/signals/OX-26-0006');
    expect(resolveHref('invoice', 'INV-26-0004')).toBe('/money?focus=INV-26-0004');
    expect(resolveHref('lot', 'LOT-26-0041')).toBe('/settlement');
  });

  it('offers no door for a record without a page, rather than a guessed one', () => {
    expect(targetFor({ label: 'Open CHK-26-0078', entityId: 'CHK-26-0078' })).toBeNull();
    expect(targetFor({ label: 'Show why', entityId: 'OX-26-0006', peek: 'xray' })).toMatchObject({
      entityType: 'signal',
      href: '/signals/OX-26-0006',
      peek: 'xray',
      focus: null,
    });
  });

  it('keeps an answer to whole sentences, and a rule reason to its first clause', () => {
    expect(firstSentences('R-0037 leaves in 2 days. The vet owns the next step. Nothing else.', 2)).toBe(
      'R-0037 leaves in 2 days. The vet owns the next step.',
    );
    expect(firstSentences('one clause without a stop')).toBe('one clause without a stop.');
    expect(firstSentences('')).toBe('');
  });
});
