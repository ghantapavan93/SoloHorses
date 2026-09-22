import { ImageResponse } from 'next/og';

/**
 * The card a link to this site shows in a message or a feed: the product's name, the one line
 * that says what it is, and the disclosure. Typography and the palette only — the operation's
 * identity is a palette and a register, never a mark or a photograph, and every name here is
 * synthetic.
 */
export const alt = 'Daysheet — one mare, every handoff. Unofficial candidate prototype, synthetic data.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** The host the card names: the hosting platform's, or the configured web URL's; never a guess. */
const host = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? new URL(process.env.WEB_URL ?? 'http://localhost:3100').host;

export default function Image() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '64px 72px',
        background: 'linear-gradient(135deg, #0e0d0d 0%, #1a1412 70%, #2a1c15 100%)',
        color: '#f3ede6',
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 22, letterSpacing: 6, color: '#d48a60' }}>
        <div style={{ width: 40, height: 2, background: '#d48a60' }} />
        DAYSHEET
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ fontSize: 88, lineHeight: 1, letterSpacing: -3, fontWeight: 600 }}>One mare, every handoff.</div>
        <div style={{ fontSize: 30, color: '#b8ada3', maxWidth: 980, lineHeight: 1.3 }}>
          Five systems each hold a piece of her day. An assistant that reads them together, explains with evidence, and
          prepares the next step for a person to approve.
        </div>
      </div>
      <div
        style={{ display: 'flex', justifyContent: 'space-between', fontSize: 20, color: '#8a7f75', letterSpacing: 2 }}
      >
        <div>UNOFFICIAL CANDIDATE PROTOTYPE · SYNTHETIC DATA</div>
        <div>{host}</div>
      </div>
    </div>,
    size,
  );
}
