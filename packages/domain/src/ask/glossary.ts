/**
 * The vocabulary the assistant must speak. Definitions marked `public` come from the
 * operation's own published glossary and service pages; `general` are industry terms.
 * The list is injected into the assistant's instructions and rendered in the UI so people
 * can correct it — corrections become eval cases, not silent prompt edits.
 */

export interface GlossaryEntry {
  term: string;
  aliases?: string[];
  definition: string;
  source: 'public' | 'general';
  /** What the assistant must NOT do around this term. */
  boundary?: string;
}

export const GLOSSARY: readonly GlossaryEntry[] = [
  {
    term: 'donor mare',
    aliases: ['donor'],
    definition: "The mare that provides the oocyte or embryo and is the foal's genetic dam.",
    source: 'public',
  },
  {
    term: 'recipient mare',
    aliases: ['recip', 'recip mare'],
    definition:
      'The mare that receives an embryo, carries the pregnancy, foals, and nurses until weaning. Identified by her recip number.',
    source: 'public',
  },
  { term: 'stallion', definition: 'The sire. Contracts are written per stallion per season.', source: 'general' },
  {
    term: 'booking fee',
    aliases: ['deposit'],
    definition: 'Non-refundable amount that holds a breeding slot. Applied toward the total.',
    source: 'public',
  },
  {
    term: 'chute fee',
    aliases: ['shoot fee'],
    definition: 'The handling fee charged with the stud fee; covers collection and office work.',
    source: 'public',
  },
  {
    term: 'stud fee',
    aliases: ['stallion fee', 'breeding fee'],
    definition:
      "The stallion's fee. Deposit + stud fee + chute fee must all be paid before semen ships. On ICSI contracts it is due when the pregnancy reaches 45–60 days.",
    source: 'public',
  },
  {
    term: 'fresh/cooled',
    definition:
      'Semen collected and shipped chilled for use within days. Contracts must be used in the season purchased.',
    source: 'public',
  },
  { term: 'frozen', definition: 'Cryopreserved semen or embryos stored in liquid nitrogen tanks.', source: 'general' },
  {
    term: 'ICSI',
    definition:
      'Intracytoplasmic sperm injection: one sperm cell injected into an oocyte at an outside laboratory. Oocytes are aspirated on Mondays; results return in seven to ten days. ICSI contracts are good for one year.',
    source: 'public',
  },
  {
    term: 'aspiration',
    aliases: ['OPU', 'oocyte aspiration'],
    definition: "Ultrasound-guided collection of oocytes from the donor mare's ovaries while she stands sedated.",
    source: 'public',
  },
  {
    term: 'flush',
    aliases: ['embryo recovery'],
    definition: "Recovering an embryo from the donor mare's uterus about a week after ovulation.",
    source: 'public',
  },
  {
    term: 'embryo transfer',
    aliases: ['ET', 'transfer', 'implant'],
    definition: 'Placing an embryo into a synchronized recipient mare.',
    source: 'public',
  },
  {
    term: 'vitrification',
    aliases: ['thaw', 'thawed'],
    definition: 'Freezing an embryo for later transfer; a thawed embryo is transferred immediately after warming.',
    source: 'public',
  },
  {
    term: 'synchronization',
    aliases: ['set up', 'set-up'],
    definition:
      'Aligning a recipient\'s cycle with the embryo\'s age. "Set up" recips are the candidates for a transfer day; more are set up than will be used.',
    source: 'public',
  },
  {
    term: 'collection day',
    definition:
      'A day semen is collected and shipped — every other day, February through July. Order by 5 PM the day before; cancel by 8 AM the day of.',
    source: 'public',
  },
  {
    term: 'cultured clean',
    definition: 'A negative uterine culture on the mare before semen ships.',
    source: 'public',
  },
  {
    term: 'heartbeat check',
    aliases: ['24-day check', 'day 24'],
    definition:
      'The ultrasound around day 24 that confirms a heartbeat. It starts the recip lease fee and daily board.',
    source: 'public',
  },
  {
    term: 'pregnancy check',
    aliases: ['preg check', 'ultrasound'],
    definition:
      'Scheduled ultrasounds: about day 14, day 24 (heartbeat), 45–60 days (ICSI stallion fee due), 55 days (purchased embryo confirmed), then monthly.',
    source: 'public',
  },
  {
    term: 'open',
    definition: 'Not pregnant. An open recip after transfer entitles the client to a redo or a lease-fee credit.',
    source: 'public',
  },
  {
    term: 'live foal',
    aliases: ['LFG', 'live foal guarantee'],
    definition:
      'A foal standing and nursing without assistance. Guarantee terms vary by program and are not stated here.',
    source: 'public',
    boundary: 'Never state LFG terms; they are unknown.',
  },
  {
    term: 'board',
    definition: 'Daily care charge for a recip mare, starting at the heartbeat check.',
    source: 'public',
  },
  {
    term: 'return deadline',
    aliases: ['December 1'],
    definition:
      'Leased recip mares come back open and in good flesh by December 1 of the foal year; otherwise a purchase fee applies.',
    source: 'public',
  },
  {
    term: 'progesterone',
    aliases: ['Regumate'],
    definition: 'Hormone support for the pregnancy, typically through day 150. A clinical decision.',
    source: 'public',
    boundary: 'Do not advise on dosing, protocols, or whether to continue; refer to the vet.',
  },
  {
    term: 'papers',
    aliases: ['registration certificate', 'AQHA papers'],
    definition: 'Breed-registry certificate. Released only after payment clears.',
    source: 'public',
  },
  {
    term: 'Coggins',
    definition: 'The EIA blood test required for travel; the in-house diagnostics lab offers a rapid version.',
    source: 'public',
  },
  { term: 'wet mare', definition: 'A mare with a foal at side.', source: 'public' },
  {
    term: 'fitting',
    aliases: ['sale prep'],
    definition: '90–120 days of conditioning and presentation before a sale.',
    source: 'public',
  },
  { term: 'hip', aliases: ['lot'], definition: "A horse's number in a sale catalog.", source: 'general' },
  {
    term: 'settle by Monday',
    definition:
      'Auction purchases are paid to the sale cashier by 5 PM Central the Monday after the sale; papers release when payment clears.',
    source: 'public',
  },
];

export function glossaryForPrompt(): string {
  return GLOSSARY.map((g) => {
    const aliases = g.aliases?.length ? ` (also: ${g.aliases.join(', ')})` : '';
    const boundary = g.boundary ? ` BOUNDARY: ${g.boundary}` : '';
    return `- ${g.term}${aliases}: ${g.definition}${boundary}`;
  }).join('\n');
}

export function lookupTerm(word: string): GlossaryEntry | undefined {
  const needle = word.trim().toLowerCase();
  return GLOSSARY.find((g) => g.term === needle || g.aliases?.some((a) => a.toLowerCase() === needle));
}
