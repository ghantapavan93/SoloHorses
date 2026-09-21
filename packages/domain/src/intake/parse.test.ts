import { describe, expect, it } from 'vitest';
import { classifyInbound, parseIntakeMessage, parseLooseDate } from './parse';
import { formatIntakeConfirmation, formatIntakeQuestion } from './reply';

const opts = { referenceYear: 2026 };

describe('parseIntakeMessage — ICSI texts as vets actually write them', () => {
  it('reads a tidy ICSI text', () => {
    const p = parseIntakeMessage(
      'Cross: Ironwood Cat x Miss Tally, ICSI 9/14, 2 embryos, Tue by 1pm, Dr. Ortega',
      opts,
    );
    expect(p.kind).toBe('ICSI');
    expect(p.sireName).toBe('Ironwood Cat');
    expect(p.damName).toBe('Miss Tally');
    expect(p.eventDate).toBe('2026-09-14');
    expect(p.embryoCount).toBe(2);
    expect(p.expectedArrival).toMatch(/Tue by 1pm/i);
    expect(p.sendingVet).toBe('Dr. Ortega');
    expect(p.missing).toEqual([]);
    expect(p.confidence).toBe(1);
  });

  it('reads a lowercase, run-on text', () => {
    const p = parseIntakeMessage(
      'hey its dr patel sending 3 embryos smooth talkin stranger x lil red hen icsi on 4/6 fedex tomorrow',
      opts,
    );
    expect(p.kind).toBe('ICSI');
    expect(p.sireName?.toLowerCase()).toBe('smooth talkin stranger');
    expect(p.damName?.toLowerCase()).toBe('lil red hen');
    expect(p.eventDate).toBe('2026-04-06');
    expect(p.embryoCount).toBe(3);
    expect(p.expectedArrival?.toLowerCase()).toContain('tomorrow');
  });

  it('reports what is missing instead of guessing', () => {
    const p = parseIntakeMessage('Sending one embryo from Metallic Rebel x Sweet Little Cat this week', opts);
    expect(p.kind).toBe('UNKNOWN');
    expect(p.sireName).toBe('Metallic Rebel');
    expect(p.damName).toBe('Sweet Little Cat');
    expect(p.embryoCount).toBe(1);
    expect(p.eventDate).toBeNull();
    // UNKNOWN kind only requires the cross; the office will ask about the rest.
    expect(p.missing).toEqual([]);
  });

  it('strips a counted preamble before the cross', () => {
    const p = parseIntakeMessage(
      'Two blasts coming from Blue Mesa Boonlight x Lena Juniper, Dr. Lindqvist, ICSI 4/13, fedex tomorrow',
      opts,
    );
    expect(p.sireName).toBe('Blue Mesa Boonlight');
    expect(p.damName).toBe('Lena Juniper');
    expect(p.embryoCount).toBe(2);
    expect(p.eventDate).toBe('2026-04-13');
    expect(p.sendingVet).toBe('Dr. Lindqvist');
  });

  it('handles "out of Dam by Sire"', () => {
    const p = parseIntakeMessage('ICSI embryo out of Playgun Lena by High Brow Cat, fertilized 5/2, 1 embryo', opts);
    expect(p.sireName).toBe('High Brow Cat');
    expect(p.damName).toBe('Playgun Lena');
    expect(p.eventDate).toBe('2026-05-02');
  });
});

describe('parseIntakeMessage — flush and frozen', () => {
  it('reads a fresh flush with an ovulation date', () => {
    const p = parseIntakeMessage(
      'Fresh flush: Once In A Blu Boon x Docs Starlight. Ovulated 3/18, flushing Wed, arriving Thu by noon',
      opts,
    );
    expect(p.kind).toBe('FLUSH');
    expect(p.eventDate).toBe('2026-03-18');
    expect(p.expectedArrival?.toLowerCase()).toContain('wed');
  });

  it('reads a frozen embryo with a tank location', () => {
    const p = parseIntakeMessage(
      'Frozen embryo Woody Be Tuff x Shiney Little Cat, tank 3 slot 12 at our clinic, want it in a recip late April',
      opts,
    );
    expect(p.kind).toBe('THAWED');
    expect(p.storage).toBe('tank 3 slot 12');
    expect(p.missing).toEqual([]);
  });

  it('flags a frozen embryo with no stated location as incomplete', () => {
    const p = parseIntakeMessage('Have a frozen embryo Cat Ichi x Sassy Pepto to send', opts);
    expect(p.kind).toBe('THAWED');
    expect(p.storage).toBe('frozen (location not stated)');
  });
});

describe('parseLooseDate', () => {
  it('parses numeric and named forms', () => {
    expect(parseLooseDate('9/14', 2026)).toBe('2026-09-14');
    expect(parseLooseDate('9/14/26', 2026)).toBe('2026-09-14');
    expect(parseLooseDate('09-14-2025', 2026)).toBe('2025-09-14');
    expect(parseLooseDate('Sep 14', 2026)).toBe('2026-09-14');
    expect(parseLooseDate('nothing here', 2026)).toBeNull();
  });
  it('rejects impossible dates', () => {
    expect(parseLooseDate('14/40', 2026)).toBeNull();
  });
});

describe('classifyInbound', () => {
  it('honours carrier keywords first', () => {
    expect(classifyInbound('STOP')).toBe('STOP');
    expect(classifyInbound('stop please')).toBe('STOP');
    expect(classifyInbound('HELP')).toBe('HELP');
  });
  it('recognises intake texts', () => {
    expect(classifyInbound('2 embryos coming Tue')).toBe('INTAKE');
    expect(classifyInbound('Thanks!')).toBe('OTHER');
  });
});

describe('replies', () => {
  it('confirms with IDs and the cross as understood', () => {
    const p = parseIntakeMessage(
      'Cross: Ironwood Cat x Miss Tally, ICSI 9/14, 2 embryos, Tue by 1pm, Dr. Ortega',
      opts,
    );
    const reply = formatIntakeConfirmation({ embryoIds: ['E-26-2077', 'E-26-2078'], parse: p });
    expect(reply).toBe(
      'Received E-26-2077, E-26-2078 · Ironwood Cat x Miss Tally · 2 ICSI embryos · expected Tue by 1pm. Reply with corrections. Reply STOP to opt out.',
    );
    expect(reply.length).toBeLessThanOrEqual(320);
  });
  it('asks for the missing fields by their barn names', () => {
    const p = parseIntakeMessage('ICSI embryos Ironwood Cat x Miss Tally', opts);
    expect(formatIntakeQuestion(p)).toContain('ICSI date');
    expect(formatIntakeQuestion(p)).toContain('number of embryos');
  });
});
