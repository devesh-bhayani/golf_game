import type { PrivateGameState } from '../../../server/src/shared-types';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

const globalStyles = `
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(12px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  @keyframes flipReveal {
    0%   { transform: scaleX(1); }
    45%  { transform: scaleX(0); }
    55%  { transform: scaleX(0); }
    100% { transform: scaleX(1); }
  }
  @keyframes slotPulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(209, 168, 69, 0.5); }
    50%       { box-shadow: 0 0 0 6px rgba(209, 168, 69, 0); }
  }
  @keyframes snapPulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(207, 90, 66, 0.65); }
    50%       { box-shadow: 0 0 0 7px rgba(207, 90, 66, 0); }
  }
  @keyframes confettiFall {
    0%   { transform: translateY(0) rotate(0deg) scaleX(1);    opacity: 1; }
    60%  { opacity: 1; }
    100% { transform: translateY(100vh) rotate(720deg) scaleX(0.5); opacity: 0; }
  }
  @keyframes deckShake {
    0%,100% { transform: translateX(0); }
    20%     { transform: translateX(-4px) rotate(-2deg); }
    40%     { transform: translateX(4px)  rotate(2deg); }
    60%     { transform: translateX(-3px) rotate(-1deg); }
    80%     { transform: translateX(3px)  rotate(1deg); }
  }
  @keyframes viewEnter {
    from { opacity: 0; transform: translateY(10px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes toastIn {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .fade-in   { animation: fadeIn 0.4s ease-out; }
  .view-enter { animation: viewEnter 0.3s ease-out; }
  .slot-pulse { animation: slotPulse 1.4s ease-in-out infinite; }
  .snap-pulse { animation: snapPulse 0.9s ease-in-out infinite; }
  .slot-flip  { animation: flipReveal 0.5s ease-in-out; }
  .deck-shake { animation: deckShake 0.45s ease-in-out; }
  .toast-in   { animation: toastIn 0.25s ease-out; }

  button:focus-visible, input:focus-visible, select:focus-visible {
    outline: 2px solid #d1a845;
    outline-offset: 2px;
  }
  * { box-sizing: border-box; }
  body { overflow-wrap: anywhere; }
  dialog::backdrop { background: rgba(0, 0, 0, .78); backdrop-filter: blur(5px); }
  dialog { color: #f5f4ec; }
  button:disabled { cursor: not-allowed; }
  .guide-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
  @media (max-width: 540px) { .guide-grid { grid-template-columns: 1fr; } }
  ::selection { background: rgba(209, 168, 69, 0.35); }
  input::placeholder { color: #5c6e60; }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
  }
`;

if (typeof document !== 'undefined') {
  const s = document.createElement('style');
  s.textContent = globalStyles;
  document.head.appendChild(s);
}

// Design tokens — "midnight card room": deep felt green surfaces, warm ivory
// text, brass-gold accent. One accent for actions/selection (primary), slate
// blue reserved for Cabo special powers (secondary), sage for success, ember
// for warnings, clay for errors. Neutrals are green-tinted to sit on the felt.
const theme = {
  colors: {
    primary: {
      50: '#fbf7ea', 100: '#f5ecd0', 300: '#e7cc8a', 400: '#ddbb66',
      500: '#d1a845', 600: '#b58e33', 700: '#8e6e26', 900: '#50390f',
    },
    secondary: {
      300: '#aebfd8', 400: '#92a8c9', 500: '#7490b5',
      600: '#5b779c', 700: '#475e7d', 900: '#232f40',
    },
    success: { 400: '#8fbf94', 500: '#66a06e', 600: '#4d855a', 700: '#3b6a47' },
    warning: { 400: '#e89b5a', 500: '#d97f33', 600: '#b96425' },
    error: { 400: '#e07861', 500: '#cf5a42', 600: '#ad452f' },
    dark: {
      50: '#f5f4ec', 100: '#e9e9dc', 200: '#cdd6cb', 300: '#aebbaf',
      400: '#8a9a8c', 500: '#5c6e60', 600: '#3a4f40', 700: '#273a2d',
      800: '#16241b', 900: '#101b14', 950: '#0b130e',
    },
  },
  spacing: { xs: '0.25rem', sm: '0.5rem', md: '0.75rem', lg: '1rem', xl: '1.25rem', '2xl': '1.5rem', '3xl': '2rem', '4xl': '2.5rem', '5xl': '3rem' },
  borderRadius: { sm: '0.25rem', md: '0.375rem', lg: '0.625rem', xl: '0.875rem', '2xl': '1rem', '3xl': '1.5rem' },
  shadows: {
    sm: '0 1px 2px 0 rgb(0 0 0 / 0.25)',
    md: '0 2px 8px -2px rgb(0 0 0 / 0.35)',
    lg: '0 8px 24px -8px rgb(0 0 0 / 0.45)',
    xl: '0 16px 40px -12px rgb(0 0 0 / 0.55)',
    glow: '0 0 0 1px rgba(209, 168, 69, 0.4), 0 0 18px rgba(209, 168, 69, 0.18)',
  },
  typography: {
    fontFamily: '"DM Sans", "Segoe UI", system-ui, sans-serif',
    fontFamilyDisplay: '"Fraunces", Georgia, serif',
    fontSize: { xs: '0.75rem', sm: '0.875rem', base: '1rem', lg: '1.125rem', xl: '1.25rem', '2xl': '1.5rem', '3xl': '1.875rem', '4xl': '2.75rem' },
    fontWeight: { normal: '400', medium: '500', semibold: '600', bold: '700' },
    lineHeight: { tight: '1.25', normal: '1.5', relaxed: '1.75' },
  },
};

// Wire types come from the server's shared-types.ts — the single source of
// truth for the socket contract. Type-only import: nothing bundled at runtime.
import type { Card as CardT, GamePhase, GolfSlotT, CaboSlotPrivate, GameSnapshot } from '../../../server/src/shared-types';

// ---- Responsive hook ----

function useWindowWidth() {
  const [width, setWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1024,
  );
  useEffect(() => {
    const handler = () => setWidth(window.innerWidth);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return width;
}

// ---- UI primitives ----

const Btn = ({
  variant = 'primary', size = 'md', children, disabled = false, onClick, style: extraStyle = {}, ...props
}: {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'success' | 'warning' | 'error';
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
  [k: string]: any;
}) => {
  const [hovered, setHovered] = useState(false);
  const base: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: theme.typography.fontFamily, fontWeight: theme.typography.fontWeight.semibold,
    borderRadius: theme.borderRadius.lg, border: '1px solid transparent',
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1,
    transition: 'background 0.15s ease, border-color 0.15s ease, color 0.15s ease',
    pointerEvents: disabled ? 'none' : 'auto',
    lineHeight: 1.2, letterSpacing: '0.01em', whiteSpace: 'nowrap',
  };
  const sizes = {
    sm: { padding: `${theme.spacing.sm} ${theme.spacing.md}`, fontSize: theme.typography.fontSize.sm, minHeight: 34 },
    md: { padding: `${theme.spacing.md} ${theme.spacing.xl}`, fontSize: theme.typography.fontSize.base, minHeight: 42 },
    lg: { padding: `${theme.spacing.lg} ${theme.spacing['2xl']}`, fontSize: theme.typography.fontSize.lg, minHeight: 48 },
  };
  const variants: Record<string, React.CSSProperties> = {
    primary: { background: hovered ? theme.colors.primary[400] : theme.colors.primary[500], color: '#1d1607', boxShadow: theme.shadows.sm },
    secondary: { background: hovered ? theme.colors.secondary[500] : theme.colors.secondary[600], color: '#0e141d', boxShadow: theme.shadows.sm },
    outline: { background: hovered ? 'rgba(245, 244, 236, 0.07)' : 'transparent', color: theme.colors.dark[100], border: `1px solid ${hovered ? theme.colors.dark[500] : theme.colors.dark[600]}` },
    ghost: { background: hovered ? 'rgba(245, 244, 236, 0.06)' : 'transparent', color: hovered ? theme.colors.dark[200] : theme.colors.dark[300] },
    success: { background: hovered ? theme.colors.success[500] : theme.colors.success[600], color: '#f5f4ec', boxShadow: theme.shadows.sm },
    warning: { background: hovered ? theme.colors.warning[400] : theme.colors.warning[500], color: '#241303', boxShadow: theme.shadows.sm },
    error: { background: hovered ? theme.colors.error[400] : theme.colors.error[500], color: '#f5f4ec', boxShadow: theme.shadows.sm },
  };
  return (
    <button
      style={{ ...base, ...sizes[size], ...variants[variant], ...extraStyle }}
      onClick={onClick} disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      {...props}
    >
      {children}
    </button>
  );
};

const Panel = ({ children, style: s = {}, ...props }: { children: React.ReactNode; style?: React.CSSProperties; [k: string]: any }) => (
  <div style={{
    background: theme.colors.dark[800],
    borderRadius: theme.borderRadius.xl, border: `1px solid ${theme.colors.dark[700]}`,
    boxShadow: theme.shadows.lg, ...s,
  }} {...props}>
    {children}
  </div>
);

const requests = new WeakMap<Socket, Set<string>>();
function request(socket: Socket | null, event: string, payload: any = {}, callback?: (result: any) => void) {
  if (!socket?.connected) { notify('You are offline. Reconnect before playing.'); callback?.({ error: 'Not connected' }); return; }
  const pending = requests.get(socket) ?? new Set<string>();
  requests.set(socket, pending);
  if (pending.has(event)) return;
  pending.add(event);
  socket.timeout(6000).emit(event, payload, (error: Error | null, result: any) => {
    pending.delete(event);
    if (error) {
      notify('The request timed out. Reconnecting to check the room…');
      callback?.({ error: 'Request timed out', code: 'TIMEOUT' });
      socket.disconnect().connect();
      return;
    }
    callback?.(result ?? {});
  });
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose?: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = React.useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => { ref.current?.close(); previous?.focus(); };
  }, []);
  return <dialog ref={ref} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose?.(); }}
    style={{ width: 'min(720px, 94vw)', maxHeight: '90dvh', padding: 0, background: theme.colors.dark[800], border: `1px solid ${theme.colors.dark[600]}`, borderRadius: 20, overflow: 'auto' }}>
    <div style={{ padding: 'clamp(18px, 4vw, 32px)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 20 }}>
        <h2 id={titleId} style={{ margin: 0, fontFamily: theme.typography.fontFamilyDisplay, fontSize: 28 }}>{title}</h2>
        {onClose && <Btn variant="ghost" size="sm" onClick={onClose} aria-label="Close">Close ✕</Btn>}
      </div>
      {children}
    </div>
  </dialog>;
}

type RulesMode = 'golf' | 'cabo' | 'teenpatti';
const MODE_NAME: Record<RulesMode, string> = { golf: 'Golf', cabo: 'Cabo', teenpatti: 'Teen Patti' };

// Teen Patti hand ranking, best first, with how often each is dealt.
const TP_RANKING: Array<[string, string, string]> = [
  ['Trail (three of a kind)', 'A A A', '0.24%'],
  ['Pure sequence (run, one suit)', 'Q♠ K♠ A♠', '0.22%'],
  ['Sequence (run)', '4♦ 5♣ 6♥', '3.26%'],
  ['Color (one suit)', '2♥ 7♥ J♥', '4.96%'],
  ['Pair', '9 9 K', '16.94%'],
  ['High card', 'A 10 4', '74.39%'],
];

function TeenPattiRules() {
  return <>
    <p style={{ fontSize: 18, color: theme.colors.primary[300], lineHeight: 1.6 }}>Bet, bluff, and show. Played with play coins only, never real money.</p>
    <p style={{ color: theme.colors.dark[300] }}>2–8 players · No accounts · These are our house rules.</p>
    <ol style={{ paddingLeft: 22, lineHeight: 1.85 }}>
      <li><strong>Everyone pays the boot.</strong> Each hand, every player puts the boot into the pot and gets three cards face down. The dealer moves one seat each hand; the player after the dealer starts.</li>
      <li><strong>Blind or seen.</strong> You start blind. Blind bets are 1× or 2× the current stake. Press <em>See cards</em> whenever you like; from then on you bet 2× or 4× (chaal). After a blind bet the stake becomes that bet; after a seen bet it becomes half of it.</li>
      <li><strong>Pack</strong> on your turn to fold. Coins you already bet stay in the pot.</li>
      <li><strong>Show.</strong> When two players are left, a blind player can pay 1× the stake for a show. A seen player pays 2×, and only against another seen player. The higher hand wins; a tie goes against the player who paid.</li>
      <li><strong>Side show.</strong> With three or more left, a seen player can bet the minimum chaal and ask the previous seen player to compare hands privately. If they accept, the lower hand packs (a tie packs the asker). They may decline. The host can turn side shows off.</li>
      <li><strong>Pot limit.</strong> When the pot reaches 32 boots, every remaining hand is shown and the best wins. Exact ties split the pot.</li>
    </ol>
    <h3>Hand ranking (best first)</h3>
    <div style={{ display: 'grid', gap: 6 }}>
      {TP_RANKING.map(([name, example, chance]) => <div key={name} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr) auto', gap: 12, alignItems: 'center', padding: '10px 12px', background: theme.colors.dark[900], borderRadius: 10 }}>
        <strong>{name}</strong><span style={{ color: theme.colors.primary[300] }}>{example}</span><span style={{ color: theme.colors.dark[300], fontVariantNumeric: 'tabular-nums' }}>{chance}</span>
      </div>)}
    </div>
    <p style={{ lineHeight: 1.7 }}>In our house rules <strong>A-2-3 is the highest run</strong>, then A-K-Q, K-Q-J, down to 4-3-2. K-A-2 is not a run. Colors and high cards compare the top card, then the next. Pairs compare the pair, then the odd card. Suits never rank.</p>
    <h3>Play coins</h3>
    <p style={{ lineHeight: 1.7 }}>Everyone starts with 100 boots of coins. You need at least the pot limit to be dealt in, so nobody runs short in the middle of a hand. Running low? Refill for free between hands. Standings count <strong>net</strong> coins: what you hold minus everything you were given. Coins cannot be bought or cashed out, and they reset every match.</p>
  </>;
}

function RulesGuide({ initialMode, onClose }: { initialMode: RulesMode; onClose: () => void }) {
  const [mode, setMode] = useState<RulesMode>(initialMode);
  const golf = mode === 'golf';
  return <Modal title="Rules & how to play" onClose={onClose}>
    <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
      {(['golf', 'cabo', 'teenpatti'] as RulesMode[]).map((m) => <Btn key={m} variant={mode === m ? 'primary' : 'outline'} aria-pressed={mode === m} onClick={() => setMode(m)}>{MODE_NAME[m]}</Btn>)}
    </div>
    {mode === 'teenpatti' ? <TeenPattiRules /> : <>
    <p style={{ fontSize: 18, color: theme.colors.primary[300], lineHeight: 1.6 }}>
      {golf ? 'A little memory. A little risk. The lowest total wins.' : 'Remember your cards, use special powers, and call Cabo when you think you are lowest.'}
    </p>
    <p style={{ color: theme.colors.dark[300] }}>2–8 players · No accounts · These are our house rules.</p>
    <ol style={{ paddingLeft: 22, lineHeight: 1.85 }}>
      <li><strong>Get everyone in.</strong> One person creates the room. Friends open the invite link or enter its four-digit code and their name. The host starts when everyone is present. Short on players? The host can add bots in the lobby.</li>
      <li><strong>Take one peek.</strong> {golf ? 'Remember your bottom row of cards.' : 'Remember your bottom two cards.'} Select “Got it — hide cards” when ready. You cannot peek again by refreshing.</li>
      <li><strong>Watch the turn marker.</strong> {golf ? 'Select a hidden card, then take the discard to replace it. Or draw from the deck: keep it and replace a hidden card, or discard it and reveal a hidden card. Either choice locks that slot.' : 'Take the discard to replace a card, or draw from the deck. Place the drawn card, discard it, or use its power. Your other cards stay hidden.'}</li>
      <li><strong>{golf ? 'Finish the round.' : 'Call Cabo.'}</strong> {golf ? 'When every card is locked face up, scores are added. Select Ready for the next round.' : 'Call before drawing on your turn. Every other player gets one last turn, then the round is scored.'}</li>
      <li><strong>Win with less.</strong> {golf ? 'A match has 4, 6, or 8 rounds to match the number of cards. A tie for the lead adds another round until one player leads.' : 'The lowest hand scores 0 for the round. Everyone else scores their hand; a caller who is not lowest adds 5. The match ends when any total exceeds 100. Lowest cumulative score wins; tied leaders share the win.'}</li>
    </ol>
    <h3>Card values</h3>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
      {(golf ? [['Ace', '1 point'], ['2–9', 'Face value'], ['10 / Jack / Queen', '10 points each'], ['King', '0 points']] : [['Ace', '0 points'], ['2–10', 'Face value'], ['Jack / Queen / Black King', '10 points'], ['Red King', '−1 point']]).map(([label, value]) =>
        <div key={label} style={{ padding: 12, background: theme.colors.dark[900], borderRadius: 10 }}><strong>{label}</strong><div style={{ color: theme.colors.primary[300], marginTop: 4 }}>{value}</div></div>)}
    </div>
    {golf ? <>
      <h3>Matching ranks make the difference</h3>
      <p style={{ lineHeight: 1.7 }}>Pairs and triples of the <strong>same rank</strong> score 0. Four identical ranks score −20. Cards can match anywhere in your layout. A 10, Jack, and Queen are different ranks, even though each is worth 10.</p>
      <p style={{ lineHeight: 1.7 }}>Kings have their own bonuses: two score −5, three score −10, four score −20. With multiple decks, score each group of four first, then apply the same rules to the remainder.</p>
      <Panel style={{ padding: 16, background: theme.colors.dark[900] }}>
        <strong>Try these examples</strong>
        <p>5 + 5 + 8 + K = <strong>8 points</strong> (the two 5s cancel).</p>
        <p>10 + J + 2 + 3 = <strong>25 points</strong> (10 and J do not match).</p>
        <p style={{ marginBottom: 0 }}>K + K + 3 + 4 = <strong>2 points</strong> (−5 + 3 + 4).</p>
      </Panel>
    </> : <>
      <h3>Drawn-card powers</h3>
      <ul style={{ paddingLeft: 22, lineHeight: 1.85 }}>
        <li><strong>7 / 8:</strong> peek at one of your cards.</li>
        <li><strong>9 / 10:</strong> spy on one opponent card.</li>
        <li><strong>Jack / Queen:</strong> swap one of your cards with an opponent’s without looking.</li>
        <li><strong>Black King:</strong> see one opponent card, then swap it with yours or pass.</li>
      </ul>
      <h3>Snap!</h3>
      <p style={{ lineHeight: 1.7 }}>During play, anyone can select Snap and choose a card whose <strong>rank</strong> matches the discard. A correct snap removes that card. A wrong snap adds up to two penalty cards, limited by cards available. After snapping an opponent’s card, you may slide one of yours into their hand or decline. Snaps wait while a Black King decision is being made.</p>
    </>}
    </>}
    <h3>If someone disconnects</h3>
    <p style={{ lineHeight: 1.7 }}>Refresh to rejoin from the same tab. A disconnected player has 30 seconds to return before leaving the room; the host role passes to a connected player. With fewer than two connected players, play pauses. If only one player remains in the room, the match returns to the lobby. Leaving during a match forfeits your place.</p>
    <p style={{ color: theme.colors.dark[300], lineHeight: 1.7 }}>Rooms last while this server is running. If a room expires or the server restarts, create a new one.{mode !== 'teenpatti' && ' A depleted draw pile reshuffles the discard pile while keeping its top card.'}</p>
    <Btn onClick={onClose} style={{ width: '100%', marginTop: 16 }}>Got it — let’s play</Btn>
  </Modal>;
}

function FirstGameGuide({ onRules }: { onRules: () => void }) {
  return <section aria-labelledby="first-game-heading" style={{ marginTop: 28 }}>
    <h2 id="first-game-heading" style={{ fontFamily: theme.typography.fontFamilyDisplay, fontSize: 26, marginBottom: 8 }}>Your first game starts here</h2>
    <p style={{ color: theme.colors.dark[300], lineHeight: 1.6 }}>New to Golf or Cabo? Both are memory games where <strong>the lowest score wins.</strong></p>
    <div className="guide-grid">
      {[["01", "Make a room", "Golf for a simple start, Cabo for special powers, or Teen Patti to bet with play coins."], ["02", "Bring your friends", "Share the invite link so everyone joins from their own phone or laptop. Alone? Add bots and play right away."], ["03", "Peek, play, repeat", "Remember your cards, take turns, and see who finishes with the fewest points."]].map(([n, title, text]) => <div key={n} style={{ padding: 16, background: theme.colors.dark[800], border: `1px solid ${theme.colors.dark[700]}`, borderRadius: 14 }}>
        <span style={{ color: theme.colors.primary[400], fontSize: 13 }}>{n}</span><h3 style={{ margin: '8px 0' }}>{title}</h3><p style={{ color: theme.colors.dark[300], lineHeight: 1.6, margin: 0, fontSize: 14 }}>{text}</p>
      </div>)}
    </div>
    <Btn variant="outline" onClick={onRules} style={{ marginTop: 16, width: '100%' }}>Read the rules & how to play</Btn>
  </section>;
}

// ---- Toasts (replaces window.alert for non-blocking errors/notices) ----

let pushToast: (msg: string) => void = () => {};
function notify(msg: string) { pushToast(msg); }

function Toasts() {
  const [toasts, setToasts] = useState<Array<{ id: number; msg: string }>>([]);
  useEffect(() => {
    pushToast = (msg: string) => {
      const id = Date.now() + Math.random();
      setToasts((t) => [...t.slice(-3), { id, msg }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
    };
    return () => { pushToast = () => {}; };
  }, []);
  if (toasts.length === 0) return null;
  return (
    <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 500, display: 'grid', gap: 8, width: 'min(92vw, 420px)' }}>
      {toasts.map((t) => (
        <div key={t.id} className="toast-in" role="status" style={{
          background: theme.colors.dark[700], color: theme.colors.dark[100],
          border: `1px solid ${theme.colors.dark[600]}`, borderLeft: `3px solid ${theme.colors.primary[500]}`,
          borderRadius: theme.borderRadius.lg, padding: '10px 14px',
          fontSize: theme.typography.fontSize.sm, fontFamily: theme.typography.fontFamily,
          boxShadow: theme.shadows.lg, textAlign: 'center',
        }}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}

// ---- Card rendering ----

function CardView({ card, size = 'md', hover = true }: { card: CardT; size?: 'sm' | 'md' | 'lg'; hover?: boolean }) {
  const sizes = { sm: { width: 60, height: 84, fs: 10 }, md: { width: 80, height: 110, fs: 12 }, lg: { width: 100, height: 140, fs: 14 } };
  const { width, height, fs } = sizes[size];
  const suits = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' };
  const isRed = card.color === 'red';
  const isFace = ['J', 'Q', 'K'].includes(card.rank);
  return (
    <div style={{
      border: '1px solid #c9c3b2', borderRadius: theme.borderRadius.lg,
      width, height, background: '#fdfcf6',
      position: 'relative', fontFamily: '"Georgia",serif', color: isRed ? '#b8372a' : '#26261f',
      boxShadow: theme.shadows.md, overflow: 'hidden', cursor: hover ? 'pointer' : 'default',
      flexShrink: 0,
    }}>
      <div style={{ position: 'absolute', top: 6, left: 6, fontSize: fs + 2, fontWeight: 'bold', lineHeight: 1 }}>
        <div>{card.rank}</div>
        <div style={{ fontSize: fs }}>{suits[card.suit]}</div>
      </div>
      <div style={{ position: 'absolute', bottom: 6, right: 6, fontSize: fs + 2, fontWeight: 'bold', lineHeight: 1, transform: 'rotate(180deg)' }}>
        <div>{card.rank}</div>
        <div style={{ fontSize: fs }}>{suits[card.suit]}</div>
      </div>
      <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center' }}>
        {isFace ? (
          <div style={{ fontSize: fs + 8, fontWeight: 'bold', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <div style={{ fontSize: fs + 4, padding: '2px 6px', background: isRed ? '#f8e8e4' : '#efeee6', borderRadius: theme.borderRadius.sm, border: `1px solid ${isRed ? '#dcaaa0' : '#c9c3b2'}` }}>{card.rank}</div>
            <div style={{ fontSize: fs + 12 }}>{suits[card.suit]}</div>
          </div>
        ) : (
          <div style={{ fontSize: card.rank === 'A' ? fs + 24 : fs + 16, fontWeight: 'bold' }}>{suits[card.suit]}</div>
        )}
      </div>
    </div>
  );
}

function CardBack({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sizes = { sm: { width: 60, height: 84 }, md: { width: 80, height: 110 }, lg: { width: 100, height: 140 } };
  const { width, height } = sizes[size];
  return (
    <div style={{
      border: '1px solid #2e4636', borderRadius: theme.borderRadius.lg,
      width, height, background: '#1c3526',
      boxShadow: theme.shadows.md, position: 'relative', overflow: 'hidden', flexShrink: 0,
    }}>
      <div style={{ position: 'absolute', inset: 0, background: 'repeating-linear-gradient(45deg, rgba(209,168,69,0.07) 0px, rgba(209,168,69,0.07) 1px, transparent 1px, transparent 7px), repeating-linear-gradient(-45deg, rgba(209,168,69,0.05) 0px, rgba(209,168,69,0.05) 1px, transparent 1px, transparent 7px)' }} />
      <div style={{ position: 'absolute', inset: 5, border: '1px solid rgba(209,168,69,0.3)', borderRadius: 6 }} />
      <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', fontSize: width * 0.3, color: 'rgba(209,168,69,0.55)', fontFamily: '"Georgia",serif', lineHeight: 1 }}>
        ♠
      </div>
    </div>
  );
}

// ---- Golf Slot ----

// Dashed ring on the slots the latest move touched, so a move made by someone
// else (or a bot) can be followed at a glance.
const recentRing = (recent?: boolean): React.CSSProperties =>
  recent ? { outline: `2px dashed ${theme.colors.primary[300]}`, outlineOffset: 3 } : {};

function SlotView({ slot, selectable, selected, onSelect, cardSize = 'md', recent = false }: {
  slot: GolfSlotT; selectable: boolean; selected: boolean; onSelect: () => void; cardSize?: 'sm' | 'md'; recent?: boolean;
}) {
  const prevLocked = useRef(slot.locked);
  const [flipping, setFlipping] = useState(false);
  const [showCard, setShowCard] = useState(slot.locked && !!slot.card);

  useEffect(() => {
    if (!prevLocked.current && slot.locked && slot.card) {
      setFlipping(true);
      const mid = setTimeout(() => setShowCard(true), 250);
      const end = setTimeout(() => setFlipping(false), 500);
      prevLocked.current = true;
      return () => { clearTimeout(mid); clearTimeout(end); };
    }
    prevLocked.current = slot.locked;
    if (slot.locked && slot.card) setShowCard(true);
    if (!slot.locked) setShowCard(false);
  }, [slot.locked, slot.card]);

  const borderColor = selected ? theme.colors.primary[500] : slot.locked ? theme.colors.success[500] : theme.colors.dark[600];
  const classes = [flipping ? 'slot-flip' : '', selectable ? 'slot-pulse' : ''].filter(Boolean).join(' ');

  return (
    <button type="button" aria-label={slot.card ? `${slot.card.rank} of ${slot.card.suit}, locked` : `Select hidden card ${Number(slot.slotId.split(':s')[1]) + 1}`} aria-pressed={selected} disabled={!selectable} className={classes} onClick={onSelect}
      style={{ background: 'transparent', color: 'inherit', cursor: selectable ? 'pointer' : 'default', border: `2px solid ${borderColor}`, borderRadius: theme.borderRadius.lg, padding: 2, transition: 'border-color 0.25s', ...recentRing(recent) }}>
      {showCard && slot.card ? <CardView card={slot.card} size={cardSize} /> : <CardBack size={cardSize} />}
    </button>
  );
}

// ---- Cabo Slot ----

function CaboSlotView({ card, selectable, selected, snapTarget, onSelect, cardSize = 'md', showFaceUp = false, label = 'Select hidden card', recent = false }: {
  card: CardT | null;
  selectable: boolean;
  selected: boolean;
  snapTarget: boolean;
  onSelect: () => void;
  cardSize?: 'sm' | 'md';
  showFaceUp?: boolean;
  label?: string;
  recent?: boolean;
}) {
  let borderColor = theme.colors.dark[600];
  if (selected) borderColor = theme.colors.primary[500];
  else if (snapTarget) borderColor = theme.colors.error[500];
  else if (selectable) borderColor = theme.colors.primary[600];

  const classes = [
    selectable && !snapTarget ? 'slot-pulse' : '',
    snapTarget ? 'snap-pulse' : '',
  ].filter(Boolean).join(' ');

  return (
    <button type="button" aria-label={showFaceUp && card ? `${card.rank} of ${card.suit}` : label} aria-pressed={selected} disabled={!selectable && !snapTarget} className={classes} onClick={onSelect}
      style={{
        background: 'transparent', color: 'inherit',
        cursor: (selectable || snapTarget) ? 'pointer' : 'default',
        border: `2px solid ${borderColor}`,
        borderRadius: theme.borderRadius.lg,
        padding: 2,
        transition: 'border-color 0.25s',
        ...recentRing(recent),
      }}>
      {showFaceUp && card ? <CardView card={card} size={cardSize} /> : <CardBack size={cardSize} />}
    </button>
  );
}

// ---- Last move line ----

// The server phrases moves in the third person ("Ada drew from the deck").
// Rephrase for the viewer when the move is theirs or targets them.
function describeLastMove(game: GameSnapshot, playerId: string | null): string | null {
  const action = game.lastAction;
  if (!action) return null;
  const me = game.players.find((p) => p.playerId === playerId);
  let text = action.text;
  if (me && action.actorId === me.playerId && text.startsWith(me.displayName)) {
    text = 'You' + text.slice(me.displayName.length)
      .replace(/^ is /, ' are ')
      .replace(/\btheirs\b/g, 'yours')
      .replace(/\btheir\b/g, 'your');
  } else if (me) {
    text = text.split(`${me.displayName}'s`).join('your');
  }
  return text;
}

function LastMove({ game, playerId }: { game: GameSnapshot; playerId: string | null }) {
  const text = describeLastMove(game, playerId);
  if (!text) return null;
  return (
    <div role="status" aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: theme.typography.fontSize.sm, color: theme.colors.dark[200], minHeight: 20 }}>
      <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 999, background: theme.colors.primary[500], flexShrink: 0 }} />
      <span><span style={{ color: theme.colors.dark[400] }}>Last move · </span>{text}</span>
    </div>
  );
}

// ---- Ambient / effects ----

function Confetti() {
  const pieces = useMemo(() => Array.from({ length: 65 }, (_, i) => ({
    id: i,
    x: (i * 1.57) % 100,
    delay: (i * 0.047) % 2,
    duration: 2.5 + (i * 0.07) % 2,
    color: ['#d1a845', '#66a06e', '#f5f4ec', '#cf5a42', '#7490b5', '#e7cc8a', '#d97f33'][i % 7],
    size: 7 + (i * 0.3) % 8,
    circle: i % 3 !== 0,
  })), []);
  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 400, overflow: 'hidden' }}>
      {pieces.map((p) => (
        <div key={p.id} style={{
          position: 'absolute', left: `${p.x}%`, top: -16,
          width: p.size, height: p.circle ? p.size : p.size * 1.6,
          background: p.color, borderRadius: p.circle ? '50%' : 3,
          animation: `confettiFall ${p.duration}s ${p.delay}s ease-in forwards`,
        }} />
      ))}
    </div>
  );
}

function CountUp({ target, duration = 900 }: { target: number; duration?: number }) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    let start: number | null = null;
    let frame = 0;
    const raf = (ts: number) => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(target * eased));
      if (p < 1) frame = requestAnimationFrame(raf);
    };
    frame = requestAnimationFrame(raf);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);
  return <>{val}</>;
}

// ---- Golf Round score modal ----

// Results actions stay pinned to the bottom of the dialog, so Ready is never
// below the fold on a short laptop screen or with a full table.
const modalActions: React.CSSProperties = {
  display: 'flex', gap: theme.spacing.md, justifyContent: 'flex-end', flexWrap: 'wrap',
  position: 'sticky', bottom: 0, background: theme.colors.dark[800],
  padding: '12px 0 4px', borderTop: `1px solid ${theme.colors.dark[700]}`,
};

function RoundScoreModal({
  game, playerId, phase, onAckNextRound, onAckRematch, onLeave, onUpdateConfig, isHost, scoreDetails, onRules,
}: {
  game: GameSnapshot; playerId: string | null; phase: GamePhase;
  onAckNextRound: () => void; onAckRematch: () => void; onLeave: () => void; onRules: () => void;
  onUpdateConfig: (cpp: number) => void; isHost: boolean; scoreDetails: Array<{ label: string; points: number }>;
}) {
  const [selectedCpp, setSelectedCpp] = useState(game.config.cardsPerPlayer);
  const isBetween = phase === 'between-rounds';
  const isEnd = phase === 'rematch-pending';
  const acks = isBetween ? (game.betweenRoundAcks ?? []) : (game.rematchAcks ?? []);
  const alreadyAcked = playerId ? acks.includes(playerId) : false;
  const playerOrder = game.players;
  const roundCount = isBetween ? game.currentRound : game.targetRounds;
  const winners = isEnd ? game.leaderboard?.filter((e) => e.rank === 1) : [];

  return (
    <>
      {isEnd && <Confetti />}
      <Modal title={isEnd ? 'Game over' : `Round ${game.currentRound} complete`}>
        <div className="fade-in">
          {game.notice && <p role="status" style={{ color: theme.colors.primary[300] }}>{game.notice}</p>}
          <details style={{ marginBottom: 20 }}><summary style={{ cursor: 'pointer', padding: '10px 0' }}>Why your hand scored {scoreDetails.reduce((sum, item) => sum + item.points, 0)}</summary>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0' }}>{game.golf?.hands.find(h => h.playerId === playerId)?.slots.map(slot => slot.card && <CardView key={slot.slotId} card={slot.card} size="sm" />)}</div>
            {scoreDetails.map(item => <p key={item.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><span>{item.label}</span><strong>{item.points}</strong></p>)}
            <p style={{ color: theme.colors.dark[300] }}>Only identical ranks combine. Lower is better.</p>
          </details>
          {isEnd && winners && winners.length > 0 && (
            <div style={{ marginBottom: theme.spacing['2xl'], padding: theme.spacing.lg, background: 'rgba(209, 168, 69, 0.12)', border: `1px solid ${theme.colors.primary[700]}`, borderRadius: theme.borderRadius.lg }}>
              <span style={{ color: theme.colors.primary[400], fontWeight: 700 }}>
                {winners.length === 1 ? `Winner: ${winners[0].displayName}` : `Co-winners: ${winners.map((w) => w.displayName).join(', ')}`}
              </span>
              <span style={{ color: theme.colors.dark[300], marginLeft: 8 }}>({winners[0].score} pts)</span>
            </div>
          )}
          <div style={{ overflowX: 'auto', marginBottom: theme.spacing['2xl'] }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: theme.typography.fontSize.sm, color: theme.colors.dark[200], fontVariantNumeric: 'tabular-nums' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${theme.colors.dark[600]}` }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px', color: theme.colors.dark[400] }}>Player</th>
                  {Array.from({ length: roundCount }, (_, i) => (
                    <th key={i} style={{ textAlign: 'center', padding: '6px 8px', color: theme.colors.dark[400] }}>R{i + 1}</th>
                  ))}
                  <th style={{ textAlign: 'center', padding: '6px 8px', color: theme.colors.dark[300], fontWeight: 700 }}>Σ</th>
                </tr>
              </thead>
              <tbody>
                {playerOrder.map((p) => {
                  const rs = game.roundScores?.find((r) => r.playerId === p.playerId);
                  const total = game.runningTotals?.[p.playerId] ?? 0;
                  const isLowest = isEnd && game.leaderboard?.find((l) => l.playerId === p.playerId)?.rank === 1;
                  return (
                    <tr key={p.playerId} style={{ borderBottom: `1px solid ${theme.colors.dark[700]}`, background: isLowest ? 'rgba(209, 168, 69, 0.08)' : 'transparent' }}>
                      <td style={{ padding: '6px 8px', color: p.playerId === playerId ? theme.colors.primary[400] : theme.colors.dark[200] }}>
                        {p.displayName}{p.playerId === playerId ? ' (you)' : ''}
                        {isLowest && <span style={{ marginLeft: 6, color: theme.colors.primary[400] }}>★</span>}
                      </td>
                      {Array.from({ length: roundCount }, (_, i) => (
                        <td key={i} style={{ textAlign: 'center', padding: '6px 8px' }}>{rs?.scores[i] ?? '–'}</td>
                      ))}
                      <td style={{ textAlign: 'center', padding: '6px 8px', fontWeight: 700, color: theme.colors.dark[100] }}><CountUp target={total} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {isEnd && isHost && (
            <div style={{ marginBottom: theme.spacing['2xl'] }}>
              <label style={{ display: 'block', fontSize: theme.typography.fontSize.sm, color: theme.colors.dark[400], marginBottom: theme.spacing.sm }}>Cards per player for next game</label>
              <div style={{ display: 'flex', gap: theme.spacing.md }}>
                {[4, 6, 8].map((n) => (
                  <button key={n} onClick={() => { setSelectedCpp(n); onUpdateConfig(n); }}
                    style={{ padding: `${theme.spacing.sm} ${theme.spacing.xl}`, background: selectedCpp === n ? theme.colors.primary[600] : theme.colors.dark[700], border: `1px solid ${selectedCpp === n ? theme.colors.primary[500] : theme.colors.dark[600]}`, borderRadius: theme.borderRadius.lg, color: theme.colors.dark[100], cursor: 'pointer', transition: 'all 0.2s' }}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
          )}
          {isEnd && !isHost && (
            <div style={{ marginBottom: theme.spacing['2xl'] }}>
              <label style={{ display: 'block', fontSize: theme.typography.fontSize.sm, color: theme.colors.dark[400], marginBottom: theme.spacing.sm }}>Cards per player for next game (set by host)</label>
              <div style={{ display: 'flex', gap: theme.spacing.md }}>
                {[4, 6, 8].map((n) => (
                  <div key={n} style={{ padding: `${theme.spacing.sm} ${theme.spacing.xl}`, background: game.config.cardsPerPlayer === n ? theme.colors.primary[900] : theme.colors.dark[800], border: `1px solid ${game.config.cardsPerPlayer === n ? theme.colors.primary[700] : theme.colors.dark[700]}`, borderRadius: theme.borderRadius.lg, color: game.config.cardsPerPlayer === n ? theme.colors.primary[300] : theme.colors.dark[500], fontWeight: game.config.cardsPerPlayer === n ? 700 : 400, userSelect: 'none' }}>
                    {n}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div style={{ marginBottom: theme.spacing['2xl'] }}>
            <div style={{ fontSize: theme.typography.fontSize.sm, color: theme.colors.dark[400], marginBottom: theme.spacing.sm }}>Ready</div>
            <div style={{ display: 'flex', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
              {playerOrder.map((p) => (
                <span key={p.playerId} style={{
                  padding: `${theme.spacing.xs} ${theme.spacing.md}`, borderRadius: theme.borderRadius.lg,
                  fontSize: theme.typography.fontSize.sm,
                  background: acks.includes(p.playerId) ? `${theme.colors.success[600]}55` : theme.colors.dark[700],
                  color: acks.includes(p.playerId) ? theme.colors.success[500] : theme.colors.dark[400],
                  border: `1px solid ${acks.includes(p.playerId) ? theme.colors.success[500] : theme.colors.dark[600]}`,
                }}>
                  {acks.includes(p.playerId) ? '✓ ' : ''}{p.displayName}
                </span>
              ))}
            </div>
          </div>
          <div style={modalActions}>
            <Btn variant="ghost" onClick={onRules}>Rules & how to play</Btn>
            <Btn variant="outline" onClick={onLeave}>Leave room</Btn>
            <Btn variant="success" onClick={isBetween ? onAckNextRound : onAckRematch} disabled={alreadyAcked}>
              {alreadyAcked ? 'Waiting…' : isEnd ? 'Play Again' : 'Ready'}
            </Btn>
          </div>
        </div>
      </Modal>
    </>
  );
}

// ---- Cabo Score Modal ----

function CaboScoreModal({
  game, playerId, phase, onAckNextRound, onAckRematch, onLeave, onRules, myHand, myHandTotal,
}: {
  game: GameSnapshot; playerId: string | null; phase: GamePhase;
  onAckNextRound: () => void; onAckRematch: () => void; onLeave: () => void; onRules: () => void;
  myHand: CaboSlotPrivate[]; myHandTotal: number | null;
}) {
  const isBetween = phase === 'between-rounds';
  const isEnd = phase === 'rematch-pending';
  const acks = isBetween ? (game.betweenRoundAcks ?? []) : (game.rematchAcks ?? []);
  const alreadyAcked = playerId ? acks.includes(playerId) : false;
  const playerOrder = game.players;
  const roundCount = game.caboRoundScores ? Math.max(...game.caboRoundScores.map((r) => r.scores.length), 0) : 0;
  const winners = isEnd ? game.caboLeaderboard?.filter((e) => e.rank === 1) : [];
  const myScores = game.caboRoundScores?.find((r) => r.playerId === playerId)?.scores ?? [];
  const myRoundScore = myScores[myScores.length - 1];
  const iCalled = game.cabo?.caboCallerId === playerId;
  const shownCards = myHand.filter((s): s is { slotId: string; card: CardT } => !!s.card);

  return (
    <>
      {isEnd && <Confetti />}
      <Modal title={isEnd ? 'Game over' : `Round ${game.currentRound} complete`}>
        <div className="fade-in">
          {myHandTotal !== null && shownCards.length === myHand.length && (
            <details style={{ marginBottom: 20 }}>
              <summary style={{ cursor: 'pointer', padding: '10px 0' }}>Your final hand added up to {myHandTotal}</summary>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0' }}>
                {shownCards.length ? shownCards.map((s) => <CardView key={s.slotId} card={s.card} size="sm" hover={false} />) : <span style={{ color: theme.colors.dark[300] }}>No cards left — every one was snapped.</span>}
              </div>
              <p style={{ lineHeight: 1.6, margin: '0 0 8px' }}>
                {myRoundScore === 0 ? 'Lowest hand at the table, so it scores 0 this round.'
                  : iCalled ? `You called Cabo without the lowest hand: ${myHandTotal} + 5 = ${myRoundScore}.`
                  : `Not the lowest hand, so it scores ${myRoundScore}.`}
              </p>
              <p style={{ color: theme.colors.dark[300], margin: 0 }}>Ace 0 · Red King −1 · Jack, Queen and Black King 10 · other cards face value.</p>
            </details>
          )}
          {isEnd && winners && winners.length > 0 && (
            <div style={{ marginBottom: theme.spacing['2xl'], padding: theme.spacing.lg, background: 'rgba(209, 168, 69, 0.12)', border: `1px solid ${theme.colors.primary[700]}`, borderRadius: theme.borderRadius.lg }}>
              <span style={{ color: theme.colors.primary[400], fontWeight: 700 }}>
                {winners.length === 1 ? `Winner: ${winners[0].displayName}` : `Co-winners: ${winners.map((w) => w.displayName).join(', ')}`}
              </span>
              <span style={{ color: theme.colors.dark[300], marginLeft: 8 }}>({winners[0].score} pts cumulative)</span>
            </div>
          )}
          <div style={{ overflowX: 'auto', marginBottom: theme.spacing['2xl'] }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: theme.typography.fontSize.sm, color: theme.colors.dark[200], fontVariantNumeric: 'tabular-nums' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${theme.colors.dark[600]}` }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px', color: theme.colors.dark[400] }}>Player</th>
                  {Array.from({ length: roundCount }, (_, i) => (
                    <th key={i} style={{ textAlign: 'center', padding: '6px 8px', color: theme.colors.dark[400] }}>R{i + 1}</th>
                  ))}
                  <th style={{ textAlign: 'center', padding: '6px 8px', color: theme.colors.dark[300], fontWeight: 700 }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {playerOrder.map((p) => {
                  const rs = game.caboRoundScores?.find((r) => r.playerId === p.playerId);
                  const cumulative = game.caboCumulativeScores?.[p.playerId] ?? 0;
                  const isWinner = isEnd && game.caboLeaderboard?.find((l) => l.playerId === p.playerId)?.rank === 1;
                  return (
                    <tr key={p.playerId} style={{ borderBottom: `1px solid ${theme.colors.dark[700]}`, background: isWinner ? 'rgba(209, 168, 69, 0.08)' : 'transparent' }}>
                      <td style={{ padding: '6px 8px', color: p.playerId === playerId ? theme.colors.primary[400] : theme.colors.dark[200] }}>
                        {p.displayName}{p.playerId === playerId ? ' (you)' : ''}
                        {isWinner && <span style={{ marginLeft: 6, color: theme.colors.primary[400] }}>★</span>}
                      </td>
                      {Array.from({ length: roundCount }, (_, i) => (
                        <td key={i} style={{ textAlign: 'center', padding: '6px 8px' }}>{rs?.scores[i] ?? '–'}</td>
                      ))}
                      <td style={{ textAlign: 'center', padding: '6px 8px', fontWeight: 700, color: cumulative > 100 ? theme.colors.error[500] : theme.colors.dark[100] }}>
                        <CountUp target={cumulative} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!isEnd && (
            <p style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.dark[500], marginBottom: theme.spacing.lg }}>
              Game ends when any player exceeds 100 points. Lowest total wins.
            </p>
          )}
          <div style={{ marginBottom: theme.spacing['2xl'] }}>
            <div style={{ fontSize: theme.typography.fontSize.sm, color: theme.colors.dark[400], marginBottom: theme.spacing.sm }}>Ready</div>
            <div style={{ display: 'flex', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
              {playerOrder.map((p) => (
                <span key={p.playerId} style={{
                  padding: `${theme.spacing.xs} ${theme.spacing.md}`, borderRadius: theme.borderRadius.lg,
                  fontSize: theme.typography.fontSize.sm,
                  background: acks.includes(p.playerId) ? `${theme.colors.success[600]}55` : theme.colors.dark[700],
                  color: acks.includes(p.playerId) ? theme.colors.success[500] : theme.colors.dark[400],
                  border: `1px solid ${acks.includes(p.playerId) ? theme.colors.success[500] : theme.colors.dark[600]}`,
                }}>
                  {acks.includes(p.playerId) ? '✓ ' : ''}{p.displayName}
                </span>
              ))}
            </div>
          </div>
          <div style={modalActions}>
            <Btn variant="ghost" onClick={onRules}>Rules & how to play</Btn>
            <Btn variant="outline" onClick={onLeave}>Leave room</Btn>
            <Btn variant="success" onClick={isBetween ? onAckNextRound : onAckRematch} disabled={alreadyAcked}>
              {alreadyAcked ? 'Waiting…' : isEnd ? 'Play Again' : 'Ready'}
            </Btn>
          </div>
        </div>
      </Modal>
    </>
  );
}

// ---- Golf table ----

// On phones the turn controls stay on screen while you scroll the table.
const stickyTurnPanel: React.CSSProperties = {
  position: 'sticky', bottom: 8, zIndex: 5,
  border: `1px solid ${theme.colors.primary[700]}`, boxShadow: theme.shadows.xl,
};

// Your own hand first, then everyone else in turn order (a rotation, so the
// seating order around the table is unchanged).
function rotateToMe<T extends { playerId: string }>(hands: T[], playerId: string | null): T[] {
  const i = hands.findIndex((h) => h.playerId === playerId);
  return i > 0 ? [...hands.slice(i), ...hands.slice(0, i)] : hands;
}

function GolfTable({ game, playerId, myGolfSlots, socket, pendingDraw, setPendingDraw, selectedSlotId, setSelectedSlotId }: {
  game: GameSnapshot; playerId: string | null;
  myGolfSlots: Array<{ slotId: string; card: CardT | null; revealed: boolean; locked: boolean; peekOnly?: boolean }> | null;
  socket: Socket | null; pendingDraw: CardT | null;
  setPendingDraw: (c: CardT | null) => void;
  selectedSlotId: string | null;
  setSelectedSlotId: (id: string | null) => void;
}) {
  const [peekAcked, setPeekAcked] = useState(false);
  useEffect(() => { setPeekAcked(false); }, [game.currentRound]);

  const [, setTick] = useState(0);
  useEffect(() => {
    const hasDisconnected = game.players.some((p) => !p.connected && p.disconnectedAt);
    if (!hasDisconnected) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [game.players]);

  const windowWidth = useWindowWidth();
  const isMobile = windowWidth < 640;
  const cardSize: 'sm' | 'md' = windowWidth < 480 ? 'sm' : 'md';
  const cardGap = cardSize === 'sm' ? 6 : 8;
  const [deckShaking, setDeckShaking] = useState(false);
  const isMyTurn = !game.paused && game.golf?.turn === playerId;
  const perRow = Math.floor((game.config.cardsPerPlayer || 4) / 2);
  const peekActive = game.golf?.peekPhaseActive !== false;
  const emit = (event: string, payload: any, cb?: (r: any) => void) => request(socket, event, payload, cb);
  // Hands sit side by side on wider screens: one hand is `perRow` slots wide
  // (card + padding + border) plus the turn highlight's padding.
  const handPad = isMobile ? 8 : 12;
  const handMinWidth = perRow * ((cardSize === 'sm' ? 60 : 80) + 8) + (perRow - 1) * cardGap + 2 * handPad + 4;
  const showTotals = (game.roundScores ?? []).some((r) => r.scores.length > 0);
  const recentSlots = game.lastAction?.slotIds ?? [];

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'baseline' }}>
          <span style={{ fontFamily: theme.typography.fontFamilyDisplay, fontWeight: theme.typography.fontWeight.semibold, fontSize: theme.typography.fontSize.xl, color: theme.colors.dark[50] }}>Round {game.currentRound} <span style={{ color: theme.colors.dark[400], fontSize: theme.typography.fontSize.base }}>of {game.targetRounds}</span></span>
          <span style={{ color: theme.colors.dark[400], fontSize: theme.typography.fontSize.sm }}>Code <strong style={{ color: theme.colors.dark[200], letterSpacing: '0.1em' }}>{game.code}</strong></span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span className={deckShaking ? 'deck-shake' : ''} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: theme.colors.dark[300], fontSize: theme.typography.fontSize.sm }}>
            <span aria-hidden="true" style={{ width: 14, height: 20, borderRadius: 3, background: '#1c3526', border: '1px solid rgba(209,168,69,0.4)', display: 'inline-block' }} />
            {game.extraDeckCount > 0 ? `${game.extraDeckCount} in deck` : game.discardTop ? 'deck empty — reshuffles discard' : 'no cards left'}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: theme.colors.dark[400], fontSize: theme.typography.fontSize.sm }}>Discard</span>
            {game.discardTop ? <CardView card={game.discardTop} size="sm" /> : <span style={{ color: theme.colors.dark[500] }}>—</span>}
          </div>
        </div>
      </div>

      {peekActive && !peekAcked && !game.golf?.peekAcks?.includes(playerId ?? '') && myGolfSlots?.some((s) => s.peekOnly) && (
        <Panel style={{ padding: theme.spacing['2xl'], background: `${theme.colors.warning[500]}22`, border: `1px solid ${theme.colors.warning[500]}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <p style={{ margin: 0, color: theme.colors.warning[500], fontWeight: 600 }}>Peek your bottom row — remember these cards!</p>
            <span style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.dark[400], whiteSpace: 'nowrap', marginLeft: 12 }}>
              {(game.golf?.peekAcks?.length ?? 0)}/{game.players.length} ready
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {myGolfSlots.map((s) => (
              <div key={s.slotId}>{s.peekOnly && s.card ? <CardView card={s.card} /> : <CardBack />}</div>
            ))}
          </div>
          <Btn disabled={peekAcked} onClick={() => { setPeekAcked(true); emit('golf:ackPeek', {}, (r: any) => { if (r?.error) { setPeekAcked(false); notify(r.error); } }); }}>
            {peekAcked ? 'Waiting for others…' : 'Got it — hide cards'}
          </Btn>
        </Panel>
      )}

      {peekActive && (peekAcked || game.golf?.peekAcks?.includes(playerId ?? '')) && <Panel role="status" style={{ padding: 20 }}>Your cards are hidden. Waiting for the other players…</Panel>}
      {!peekActive && <LastMove game={game} playerId={playerId} />}
      {!peekActive && (
        <div style={{ display: 'grid', gap: isMobile ? 10 : 20, gridTemplateColumns: `repeat(auto-fill, minmax(${handMinWidth}px, 1fr))`, alignItems: 'start', maxHeight: isMobile ? 'none' : 'calc(100vh - 290px)', overflowY: isMobile ? 'visible' : 'auto', paddingRight: isMobile ? 0 : 4 }}>
          {rotateToMe(game.golf?.hands ?? [], playerId).map((h) => {
            const player = game.players.find((p) => p.playerId === h.playerId);
            const isMe = h.playerId === playerId;
            const isTurn = h.playerId === game.golf?.turn;
            const running = game.runningTotals?.[h.playerId];
            const disconnected = player && !player.connected;
            const disconnectedAt = player?.disconnectedAt;
            const graceElapsed = disconnectedAt && Date.now() - disconnectedAt >= 30_000;
            const kickSecondsLeft = disconnectedAt && !graceElapsed ? Math.max(0, 30 - Math.floor((Date.now() - disconnectedAt) / 1000)) : 0;
            const isHost = playerId === game.hostId;

            return (
              <div key={h.playerId} style={{ opacity: disconnected ? 0.7 : 1, padding: handPad, borderRadius: theme.borderRadius.xl, border: isTurn ? `2px solid ${isMe ? theme.colors.primary[500] : theme.colors.dark[500]}` : '2px solid transparent', boxShadow: isTurn && isMe ? theme.shadows.glow : 'none', transition: 'all 0.3s ease-in-out' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600, color: isMe ? theme.colors.primary[400] : theme.colors.dark[200] }}>{player?.displayName}{isMe ? ' (you)' : ''}</span>
                  {isTurn && !disconnected && <span style={{ fontSize: theme.typography.fontSize.xs, fontWeight: theme.typography.fontWeight.bold, background: theme.colors.primary[500], color: '#1d1607', padding: '2px 10px', borderRadius: 999 }}>Turn</span>}
                  {isTurn && disconnected && <span style={{ fontSize: theme.typography.fontSize.xs, fontWeight: theme.typography.fontWeight.semibold, background: theme.colors.warning[600], color: '#f5f4ec', padding: '2px 10px', borderRadius: 999 }}>Waiting…</span>}
                  {disconnected && <span style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.dark[500] }}><span style={{ display: 'inline-block', width: 10, height: 10, border: `2px solid ${theme.colors.dark[500]}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite', marginRight: 4 }} />disconnected</span>}
                  {showTotals && running !== undefined && <span style={{ fontSize: theme.typography.fontSize.xs, padding: '2px 8px', background: theme.colors.dark[700], border: `1px solid ${theme.colors.dark[600]}`, borderRadius: theme.borderRadius.lg, color: theme.colors.dark[300] }}>{running} pts</span>}
                  {isHost && !isMe && disconnected && !graceElapsed && <span style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.dark[500] }}>kick in {kickSecondsLeft}s</span>}
                  {isHost && !isMe && disconnected && graceElapsed && <Btn size="sm" variant="error" onClick={() => emit('golf:kickPlayer', { playerId: h.playerId }, (r: any) => { if (r?.error) notify(r.error); })}>Kick</Btn>}
                </div>
                <div style={{ overflowX: 'auto', padding: 5, margin: -5 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${perRow}, auto)`, gap: cardGap, width: 'fit-content' }}>
                    {h.slots.slice(0, perRow).map((s) => <SlotView key={s.slotId} slot={s} selectable={!!(isMe && isMyTurn && !s.locked)} selected={selectedSlotId === s.slotId} onSelect={() => setSelectedSlotId(s.slotId)} cardSize={cardSize} recent={recentSlots.includes(s.slotId)} />)}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${perRow}, auto)`, gap: cardGap, marginTop: cardGap, width: 'fit-content' }}>
                    {h.slots.slice(perRow).map((s) => <SlotView key={s.slotId} slot={s} selectable={!!(isMe && isMyTurn && !s.locked)} selected={selectedSlotId === s.slotId} onSelect={() => setSelectedSlotId(s.slotId)} cardSize={cardSize} recent={recentSlots.includes(s.slotId)} />)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {isMyTurn && !peekActive && (
        <Panel style={{ padding: isMobile ? theme.spacing.lg : theme.spacing['2xl'], ...(isMobile ? stickyTurnPanel : {}) }}>
          <div style={{ fontWeight: 600, color: theme.colors.primary[400], marginBottom: 12 }}>Your turn</div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            {!pendingDraw && (
              <>
                <Btn size={isMobile ? 'sm' : 'md'} onClick={() => { if (!selectedSlotId) return notify('Select a slot first'); emit('golf:swapWithDiscard', { slotId: selectedSlotId }, (r: any) => { if (r?.error) return notify(r.error); setSelectedSlotId(null); }); }} disabled={!game.discardTop}>Swap with discard</Btn>
                <Btn variant="outline" size={isMobile ? 'sm' : 'md'} disabled={game.extraDeckCount === 0 && !game.discardTop} onClick={() => { setDeckShaking(true); setTimeout(() => setDeckShaking(false), 500); emit('golf:draw', {}, (r: any) => { if (r?.error) return notify(r.error); setPendingDraw(r.card); }); }}>Draw from deck</Btn>
              </>
            )}
            {pendingDraw && (
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ color: theme.colors.dark[300] }}>Drawn:</span>
                <CardView card={pendingDraw} size={isMobile ? 'sm' : 'md'} hover={false} />
                <Btn variant="success" size={isMobile ? 'sm' : 'md'} onClick={() => { if (!selectedSlotId) return notify('Select a slot to swap'); emit('golf:acceptDrawAndSwap', { slotId: selectedSlotId }, (r: any) => { if (r?.error) return notify(r.error); setPendingDraw(null); setSelectedSlotId(null); }); }}>Accept & swap</Btn>
                <Btn variant="warning" size={isMobile ? 'sm' : 'md'} onClick={() => { if (!selectedSlotId) return notify('Select a slot to reveal'); emit('golf:rejectDrawAndReveal', { slotId: selectedSlotId }, (r: any) => { if (r?.error) return notify(r.error); setPendingDraw(null); setSelectedSlotId(null); }); }}>Reject & reveal</Btn>
              </div>
            )}
          </div>
          {!selectedSlotId && <p style={{ margin: '8px 0 0', fontSize: theme.typography.fontSize.sm, color: theme.colors.dark[400] }}>Click one of your face-down cards to select a slot</p>}
        </Panel>
      )}
    </div>
  );
}

// ---- Cabo table ----

type CaboSpecialMode =
  | 'none'
  | 'peek-own'
  | 'spy'
  | 'blind-swap-own'
  | 'blind-swap-opponent'
  | 'black-king-see'
  | 'black-king-decide';

function CaboTable({ game, playerId, mySlots, socket, pendingDraw, setPendingDraw, snapGap, setSnapGap, restoredKing }: {
  game: GameSnapshot;
  playerId: string | null;
  mySlots: CaboSlotPrivate[] | null;
  socket: Socket | null;
  pendingDraw: CardT | null;
  setPendingDraw: (c: CardT | null) => void;
  restoredKing: PrivateGameState['blackKing'];
  snapGap: { opponentId: string } | null;
  setSnapGap: (v: { opponentId: string } | null) => void;
}) {
  const [peekAcked, setPeekAcked] = useState(false);
  const [snapMode, setSnapMode] = useState(false);
  const [specialMode, setSpecialMode] = useState<CaboSpecialMode>('none');
  const [selectedOwnSlot, setSelectedOwnSlot] = useState<string | null>(null);
  const [selectedOpponentSlot, setSelectedOpponentSlot] = useState<{ playerId: string; slotId: string } | null>(null);
  const [blackKingSeen, setBlackKingSeen] = useState<{ targetPlayerId: string; slotId: string; card: CardT } | null>(null);
  useEffect(() => {
    setBlackKingSeen(restoredKing);
    if (restoredKing) setSpecialMode('black-king-decide');
    else setSpecialMode(mode => mode === 'black-king-decide' ? 'none' : mode);
  }, [restoredKing]);
  const [spyResult, setSpyResult] = useState<{ targetPlayerId: string; slotId: string; card: CardT } | null>(null);
  const [peekResult, setPeekResult] = useState<{ slotId: string; card: CardT } | null>(null);
  const [snapSlideSlot, setSnapSlideSlot] = useState<string | null>(null);
  const [deckShaking, setDeckShaking] = useState(false);

  useEffect(() => {
    setPeekAcked(false);
    setSnapMode(false);
    setSpecialMode('none');
    setSelectedOwnSlot(null);
    setSelectedOpponentSlot(null);
    setBlackKingSeen(null);
    setSpyResult(null);
    setPeekResult(null);
    setSnapSlideSlot(null);
  }, [game.currentRound]);

  useEffect(() => {
    if (!socket) return;
    const onPeekResult = (data: { slotId: string; card: CardT }) => {
      setPeekResult(data);
      setTimeout(() => setPeekResult(null), 4000);
    };
    const onSpyResult = (data: { targetPlayerId: string; slotId: string; card: CardT }) => {
      setSpyResult(data);
      setSpecialMode('none');
      setTimeout(() => setSpyResult(null), 4000);
    };
    const onBlackKingSeeResult = (data: { targetPlayerId: string; slotId: string; card: CardT }) => {
      setBlackKingSeen(data);
      setSpecialMode('black-king-decide');
    };
    const onSnapGapAvailable = (data: { opponentId: string }) => {
      setSnapGap(data);
      setSnapMode(false);
    };

    socket.on('cabo:peekResult', onPeekResult);
    socket.on('cabo:spyResult', onSpyResult);
    socket.on('cabo:blackKingSeeResult', onBlackKingSeeResult);
    socket.on('cabo:snapGapAvailable', onSnapGapAvailable);
    return () => {
      socket.off('cabo:peekResult', onPeekResult);
      socket.off('cabo:spyResult', onSpyResult);
      socket.off('cabo:blackKingSeeResult', onBlackKingSeeResult);
      socket.off('cabo:snapGapAvailable', onSnapGapAvailable);
    };
  }, [socket, setSnapGap]);

  // 1s tick while anyone is disconnected so the kick countdown re-renders.
  const [, setTick] = useState(0);
  useEffect(() => {
    const hasDisconnected = game.players.some((p) => !p.connected && p.disconnectedAt);
    if (!hasDisconnected) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [game.players]);

  const windowWidth = useWindowWidth();
  const isMobile = windowWidth < 640;
  const cardSize: 'sm' | 'md' = windowWidth < 480 ? 'sm' : 'md';
  const cardGap = cardSize === 'sm' ? 6 : 8;

  const cabo = game.cabo;
  const isMyTurn = !game.paused && cabo?.turn === playerId;
  const peekActive = cabo?.peekPhaseActive ?? false;
  const caboCallerId = cabo?.caboCallerId ?? null;
  const caboFinalTurnsLeft = cabo?.caboFinalTurnsLeft ?? 0;
  const phase = game.phase;

  const hasPendingDraw = !!pendingDraw;
  const hasBlackKingPending = cabo?.blackKingPlayers?.includes(playerId ?? '') ?? false;
  // Start of my turn (nothing drawn yet): my cards are selectable as the target for "Take discard".
  const choosingDiscardSlot = isMyTurn && !hasPendingDraw && !hasBlackKingPending && specialMode === 'none' && !snapMode && !snapGap
    && (phase === 'play' || phase === 'cabo-called') && !!game.discardTop;
  const [confirmCabo, setConfirmCabo] = useState(false);
  const handPad = isMobile ? 8 : 12;
  const handMinWidth = 2 * ((cardSize === 'sm' ? 60 : 80) + 8) + cardGap + 2 * handPad + 4;
  const showTotals = (game.caboRoundScores ?? []).some((r) => r.scores.length > 0);
  const recentSlots = game.lastAction?.slotIds ?? [];

  const emit = (event: string, payload: any, cb?: (r: any) => void) => request(socket, event, payload, cb);

  function getSpecialAction(card: CardT): string | null {
    if (['7', '8'].includes(card.rank)) return 'peek-own';
    if (['9', '10'].includes(card.rank)) return 'spy';
    if (['J', 'Q'].includes(card.rank)) return 'blind-swap';
    if (card.rank === 'K' && card.color === 'black') return 'black-king-see';
    return null;
  }

  function handleSnapSlot(targetPid: string, slotId: string) {
    const targetType = targetPid === playerId ? 'own' : 'opponent';
    const payload: any = { targetType, targetSlotId: slotId };
    if (targetType === 'opponent') payload.targetPlayerId = targetPid;
    emit('cabo:snap', payload, (r: any) => {
      // WRONG_SNAP is expected gameplay (penalty cards appear in hand) — no error toast.
      if (r?.error && r.code !== 'WRONG_SNAP') {
        notify(r.error);
      }
      setSnapMode(false);
    });
  }

  function handleOwnSlotClick(slotId: string) {
    if (snapMode) { handleSnapSlot(playerId!, slotId); return; }

    if (specialMode === 'peek-own') {
      emit('cabo:useSpecialPower', { action: 'peek-own', ownSlotId: slotId }, (r: any) => {
        if (r?.error) return notify(r.error);
        setSpecialMode('none');
        setSelectedOwnSlot(null);
      });
      return;
    }
    if (specialMode === 'blind-swap-own') {
      setSelectedOwnSlot(slotId);
      setSpecialMode('blind-swap-opponent');
      return;
    }
    if (specialMode === 'black-king-decide' && blackKingSeen) {
      emit('cabo:blackKingDecide', { swap: true, ownSlotId: slotId }, (r: any) => {
        if (r?.error) return notify(r.error);
        setBlackKingSeen(null);
        setSpecialMode('none');
        setSelectedOwnSlot(null);
      });
      return;
    }

    // place drawn card
    if (hasPendingDraw && isMyTurn && !hasBlackKingPending) {
      emit('cabo:placeDrawn', { slotId }, (r: any) => {
        if (r?.error) return notify(r.error);
        setPendingDraw(null);
        setSelectedOwnSlot(null);
      });
      return;
    }

    // snap slide
    if (snapGap && snapSlideSlot === null) {
      setSnapSlideSlot(slotId);
      return;
    }

    setSelectedOwnSlot(selectedOwnSlot === slotId ? null : slotId);
  }

  function handleOpponentSlotClick(targetPid: string, slotId: string) {
    if (snapMode) { handleSnapSlot(targetPid, slotId); return; }

    if (specialMode === 'spy') {
      emit('cabo:useSpecialPower', { action: 'spy', targetPlayerId: targetPid, targetSlotId: slotId }, (r: any) => {
        if (r?.error) return notify(r.error);
        setSpecialMode('none');
        setSelectedOpponentSlot(null);
      });
      return;
    }
    if (specialMode === 'blind-swap-opponent') {
      if (!selectedOwnSlot) { setSpecialMode('blind-swap-own'); return; }
      emit('cabo:useSpecialPower', { action: 'blind-swap', ownSlotId: selectedOwnSlot, targetPlayerId: targetPid, targetSlotId: slotId }, (r: any) => {
        if (r?.error) return notify(r.error);
        setSpecialMode('none');
        setSelectedOwnSlot(null);
        setSelectedOpponentSlot(null);
      });
      return;
    }
    if (specialMode === 'black-king-see') {
      emit('cabo:useSpecialPower', { action: 'black-king-see', targetPlayerId: targetPid, targetSlotId: slotId }, (r: any) => {
        if (r?.error) return notify(r.error);
        setSpecialMode('none');
        setSelectedOpponentSlot(null);
      });
      return;
    }
    setSelectedOpponentSlot(selectedOpponentSlot?.slotId === slotId ? null : { playerId: targetPid, slotId });
  }

  const caboCallerName = caboCallerId ? game.players.find((p) => p.playerId === caboCallerId)?.displayName : null;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'baseline' }}>
          <span style={{ fontFamily: theme.typography.fontFamilyDisplay, fontWeight: theme.typography.fontWeight.semibold, fontSize: theme.typography.fontSize.xl, color: theme.colors.dark[50] }}>Cabo <span style={{ color: theme.colors.dark[400], fontSize: theme.typography.fontSize.base }}>· round {game.currentRound}</span></span>
          <span style={{ color: theme.colors.dark[400], fontSize: theme.typography.fontSize.sm }}>Code <strong style={{ color: theme.colors.dark[200], letterSpacing: '0.1em' }}>{game.code}</strong></span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span className={deckShaking ? 'deck-shake' : ''} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: theme.colors.dark[300], fontSize: theme.typography.fontSize.sm }}>
            <span aria-hidden="true" style={{ width: 14, height: 20, borderRadius: 3, background: '#1c3526', border: '1px solid rgba(209,168,69,0.4)', display: 'inline-block' }} />
            {game.extraDeckCount > 0 ? `${game.extraDeckCount} in deck` : game.discardTop ? 'deck empty — reshuffles discard' : 'no cards left'}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: theme.colors.dark[400], fontSize: theme.typography.fontSize.sm }}>Discard</span>
            {game.discardTop ? <CardView card={game.discardTop} size="sm" /> : <span style={{ color: theme.colors.dark[500] }}>—</span>}
          </div>
          {game.discardTop && (phase === 'play' || phase === 'cabo-called') && (
            <Btn size="sm" variant={snapMode ? 'error' : 'outline'} onClick={() => { setSnapMode(!snapMode); setSpecialMode('none'); }}>
              {snapMode ? 'Cancel Snap' : 'Snap!'}
            </Btn>
          )}
        </div>
      </div>

      {/* Cabo called banner */}
      {phase === 'cabo-called' && caboCallerName && (
        <Panel style={{ padding: theme.spacing.lg, background: `${theme.colors.warning[600]}22`, border: `1px solid ${theme.colors.warning[500]}` }}>
          <span style={{ color: theme.colors.warning[500], fontWeight: 600 }}>
            {caboCallerId === playerId ? 'You called' : `${caboCallerName} called`} Cabo!
          </span>
          <span style={{ color: theme.colors.dark[300], marginLeft: 8 }}>
            {caboFinalTurnsLeft} final {caboFinalTurnsLeft === 1 ? 'turn' : 'turns'} remaining
          </span>
        </Panel>
      )}

      {/* Peek phase */}
      {peekActive && !peekAcked && !game.cabo?.peekAcks?.includes(playerId ?? '') && mySlots && (
        <Panel style={{ padding: theme.spacing['2xl'], background: `${theme.colors.warning[500]}22`, border: `1px solid ${theme.colors.warning[500]}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <p style={{ margin: 0, color: theme.colors.warning[500], fontWeight: 600 }}>Peek your bottom 2 cards — remember them!</p>
            <span style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.dark[400], whiteSpace: 'nowrap', marginLeft: 12 }}>
              {(cabo?.peekAcks?.length ?? 0)}/{game.players.length} ready
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {mySlots.map((s, idx) => (
              <div key={s.slotId}>{idx >= 2 && s.card ? <CardView card={s.card} /> : <CardBack />}</div>
            ))}
          </div>
          <Btn disabled={peekAcked} onClick={() => { setPeekAcked(true); emit('cabo:ackPeek', {}, (r: any) => { if (r?.error) { setPeekAcked(false); notify(r.error); } }); }}>
            {peekAcked ? 'Waiting for others…' : 'Got it — hide cards'}
          </Btn>
        </Panel>
      )}

      {peekActive && (peekAcked || game.cabo?.peekAcks?.includes(playerId ?? '')) && <Panel role="status" style={{ padding: 20 }}>Your cards are hidden. Waiting for the other players…</Panel>}
      {!peekActive && <LastMove game={game} playerId={playerId} />}
      {/* Snap mode hint */}
      {snapMode && (
        <Panel style={{ padding: theme.spacing.lg, background: `${theme.colors.error[600]}22`, border: `1px solid ${theme.colors.error[500]}` }}>
          <span style={{ color: theme.colors.error[400], fontWeight: 600 }}>Snap mode active</span>
          <span style={{ color: theme.colors.dark[300], marginLeft: 8, fontSize: theme.typography.fontSize.sm }}>
            Click any slot to snap it (must match discard rank: {game.discardTop?.rank ?? '?'})
          </span>
        </Panel>
      )}

      {/* Spy/Peek result toasts */}
      {peekResult && (
        <Panel style={{ padding: theme.spacing.lg, background: `${theme.colors.primary[600]}22`, border: `1px solid ${theme.colors.primary[500]}` }}>
          <span style={{ color: theme.colors.primary[400], fontWeight: 600 }}>You peeked: </span>
          <span style={{ color: theme.colors.dark[200] }}>your card is </span>
          <strong style={{ color: theme.colors.primary[300] }}>{peekResult.card.rank}{peekResult.card.suit === 'hearts' ? '♥' : peekResult.card.suit === 'diamonds' ? '♦' : peekResult.card.suit === 'clubs' ? '♣' : '♠'}</strong>
        </Panel>
      )}
      {spyResult && (
        <Panel style={{ padding: theme.spacing.lg, background: `${theme.colors.secondary[600]}22`, border: `1px solid ${theme.colors.secondary[500]}` }}>
          <span style={{ color: theme.colors.secondary[400], fontWeight: 600 }}>You spied: </span>
          <span style={{ color: theme.colors.dark[200] }}>{game.players.find((p) => p.playerId === spyResult.targetPlayerId)?.displayName}'s card is </span>
          <strong style={{ color: theme.colors.secondary[300] }}>{spyResult.card.rank}{spyResult.card.suit === 'hearts' ? '♥' : spyResult.card.suit === 'diamonds' ? '♦' : spyResult.card.suit === 'clubs' ? '♣' : '♠'}</strong>
        </Panel>
      )}

      {/* Black King decision panel */}
      {specialMode === 'black-king-decide' && blackKingSeen && (
        <Panel style={{ padding: theme.spacing['2xl'], background: `${theme.colors.secondary[600]}22`, border: `1px solid ${theme.colors.secondary[500]}` }}>
          <div style={{ fontWeight: 600, color: theme.colors.secondary[400], marginBottom: 12 }}>
            Black King: you see {game.players.find((p) => p.playerId === blackKingSeen.targetPlayerId)?.displayName}'s card:
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <CardView card={blackKingSeen.card} />
            <div style={{ display: 'flex', gap: 8, flexDirection: 'column' }}>
              <span style={{ color: theme.colors.dark[300], fontSize: theme.typography.fontSize.sm }}>Click one of your cards to swap, or pass</span>
              <Btn variant="outline" onClick={() => {
                emit('cabo:blackKingDecide', { swap: false }, (r: any) => {
                  if (r?.error) return notify(r.error);
                  setBlackKingSeen(null);
                  setSpecialMode('none');
                });
              }}>Pass — don't swap</Btn>
            </div>
          </div>
        </Panel>
      )}

      {/* Snap gap / slide panel */}
      {snapGap && (
        <Panel style={{ padding: theme.spacing['2xl'], background: `${theme.colors.success[600]}22`, border: `1px solid ${theme.colors.success[500]}` }}>
          <div style={{ fontWeight: 600, color: theme.colors.success[400], marginBottom: 8 }}>
            Snap! Click one of your cards to slide into {game.players.find((p) => p.playerId === snapGap.opponentId)?.displayName}'s gap, or decline
          </div>
          {snapSlideSlot ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn variant="success" onClick={() => {
                emit('cabo:snapSlide', { ownSlotId: snapSlideSlot }, (r: any) => {
                  if (r?.error) return notify(r.error);
                  setSnapGap(null);
                  setSnapSlideSlot(null);
                });
              }}>Confirm slide</Btn>
              <Btn variant="outline" onClick={() => setSnapSlideSlot(null)}>Pick different card</Btn>
            </div>
          ) : (
            <Btn variant="outline" onClick={() => {
              emit('cabo:snapSlideDecline', {}, () => { setSnapGap(null); setSnapSlideSlot(null); });
            }}>Decline — keep gap</Btn>
          )}
        </Panel>
      )}

      {/* Special power targeting hint */}
      {(specialMode === 'peek-own') && <Panel style={{ padding: theme.spacing.lg, border: `1px solid ${theme.colors.primary[500]}` }}><span style={{ color: theme.colors.primary[400] }}>Select one of your own cards to peek at</span></Panel>}
      {(specialMode === 'spy') && <Panel style={{ padding: theme.spacing.lg, border: `1px solid ${theme.colors.secondary[500]}` }}><span style={{ color: theme.colors.secondary[400] }}>Select one of an opponent's cards to spy</span></Panel>}
      {(specialMode === 'blind-swap-own') && <Panel style={{ padding: theme.spacing.lg, border: `1px solid ${theme.colors.warning[500]}` }}><span style={{ color: theme.colors.warning[400] }}>Select one of YOUR cards to swap (step 1/2)</span></Panel>}
      {(specialMode === 'blind-swap-opponent') && <Panel style={{ padding: theme.spacing.lg, border: `1px solid ${theme.colors.warning[500]}` }}><span style={{ color: theme.colors.warning[400] }}>Now select an OPPONENT's card to swap with (step 2/2)</span></Panel>}
      {(specialMode === 'black-king-see') && <Panel style={{ padding: theme.spacing.lg, border: `1px solid ${theme.colors.secondary[500]}` }}><span style={{ color: theme.colors.secondary[400] }}>Select an opponent's card to look at</span></Panel>}

      {/* Main table: all players */}
      {!peekActive && (
        <div style={{ display: 'grid', gap: isMobile ? 10 : 20, gridTemplateColumns: `repeat(auto-fill, minmax(${handMinWidth}px, 1fr))`, alignItems: 'start', maxHeight: isMobile ? 'none' : 'calc(100vh - 340px)', overflowY: isMobile ? 'visible' : 'auto', paddingRight: isMobile ? 0 : 4 }}>
          {rotateToMe(cabo?.hands ?? [], playerId).map((h) => {
            const player = game.players.find((p) => p.playerId === h.playerId);
            const isMe = h.playerId === playerId;
            const isTurn = h.playerId === cabo?.turn;
            const cumulative = game.caboCumulativeScores?.[h.playerId];
            const disconnected = player && !player.connected;
            const hasPendingDrawIndicator = cabo?.pendingDrawPlayers?.includes(h.playerId);
            const hasBlackKingIndicator = cabo?.blackKingPlayers?.includes(h.playerId);
            const disconnectedAt = player?.disconnectedAt;
            const graceElapsed = disconnectedAt && Date.now() - disconnectedAt >= 30_000;
            const kickSecondsLeft = disconnectedAt && !graceElapsed ? Math.max(0, 30 - Math.floor((Date.now() - disconnectedAt) / 1000)) : 0;
            const isHost = playerId === game.hostId;

            // my slots from private event

            const row1Count = Math.min(2, h.slots.length);

            return (
              <div key={h.playerId} style={{
                opacity: disconnected ? 0.7 : 1,
                padding: handPad,
                borderRadius: theme.borderRadius.xl,
                border: isTurn ? `2px solid ${isMe ? theme.colors.primary[500] : theme.colors.dark[500]}` : '2px solid transparent',
                boxShadow: isTurn && isMe ? theme.shadows.glow : 'none',
                transition: 'all 0.3s ease-in-out',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600, color: isMe ? theme.colors.primary[400] : theme.colors.dark[200] }}>
                    {player?.displayName}{isMe ? ' (you)' : ''}
                  </span>
                  {isTurn && !disconnected && <span style={{ fontSize: theme.typography.fontSize.xs, fontWeight: theme.typography.fontWeight.bold, background: theme.colors.primary[500], color: '#1d1607', padding: '2px 10px', borderRadius: 999 }}>Turn</span>}
                  {isTurn && disconnected && <span style={{ fontSize: theme.typography.fontSize.xs, fontWeight: theme.typography.fontWeight.semibold, background: theme.colors.warning[600], color: '#f5f4ec', padding: '2px 10px', borderRadius: 999 }}>Waiting…</span>}
                  {disconnected && <span style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.dark[500] }}><span style={{ display: 'inline-block', width: 10, height: 10, border: `2px solid ${theme.colors.dark[500]}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite', marginRight: 4 }} />disconnected</span>}
                  {showTotals && cumulative !== undefined && <span style={{ fontSize: theme.typography.fontSize.xs, padding: '2px 8px', background: theme.colors.dark[700], border: `1px solid ${theme.colors.dark[600]}`, borderRadius: theme.borderRadius.lg, color: theme.colors.dark[300] }}>{cumulative} pts</span>}
                  {hasPendingDrawIndicator && !isMe && <span style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.primary[400] }}>deciding…</span>}
                  {hasBlackKingIndicator && !isMe && <span style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.secondary[400] }}>black king…</span>}
                  {h.playerId === caboCallerId && <span style={{ fontSize: theme.typography.fontSize.xs, background: `${theme.colors.warning[600]}44`, color: theme.colors.warning[400], padding: '2px 8px', borderRadius: theme.borderRadius.lg, border: `1px solid ${theme.colors.warning[600]}` }}>Called Cabo</span>}
                  {isHost && !isMe && disconnected && !graceElapsed && <span style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.dark[500] }}>kick in {kickSecondsLeft}s</span>}
                  {isHost && !isMe && disconnected && graceElapsed && <Btn size="sm" variant="error" onClick={() => emit('cabo:kickPlayer', { playerId: h.playerId }, (r: any) => { if (r?.error) notify(r.error); })}>Kick</Btn>}
                </div>

                {/* card grid (variable width) */}
                <div style={{ overflowX: 'auto', padding: 5, margin: -5 }}>
                  {[h.slots.slice(0, row1Count), h.slots.slice(row1Count)].map((rowSlots, rowIdx) => {
                    if (rowSlots.length === 0) return null;
                    return (
                      <div key={rowIdx} style={{ display: 'grid', gridTemplateColumns: `repeat(${rowSlots.length}, auto)`, gap: cardGap, width: 'fit-content', marginTop: rowIdx > 0 ? cardGap : 0 }}>
                        {rowSlots.map((s) => {
                          if (isMe) {
                            // Cabo is a memory game: own cards stay face-down after the
                            // initial peek. Only a 7/8 peek-own result flips one briefly.
                            const peekedHere = peekResult?.slotId === s.slotId;
                            const isSelectableOwnSlot = (
                              (isMyTurn && hasPendingDraw && !hasBlackKingPending && specialMode === 'none' && !snapMode) ||
                              choosingDiscardSlot ||
                              specialMode === 'peek-own' ||
                              specialMode === 'blind-swap-own' ||
                              (specialMode === 'black-king-decide' && blackKingSeen !== null) ||
                              (snapGap !== null && snapSlideSlot === null)
                            );
                            const isSlideTarget = !!(snapGap && snapSlideSlot === null);
                            return (
                              <CaboSlotView key={s.slotId} label={`Your card ${h.slots.indexOf(s) + 1}`}
                                card={peekedHere ? peekResult!.card : null}
                                selectable={isSelectableOwnSlot || isSlideTarget}
                                selected={selectedOwnSlot === s.slotId || snapSlideSlot === s.slotId}
                                snapTarget={snapMode}
                                onSelect={() => {
                                  if (isSlideTarget && !snapMode) { setSnapSlideSlot(s.slotId); return; }
                                  handleOwnSlotClick(s.slotId);
                                }}
                                cardSize={cardSize}
                                showFaceUp={peekedHere}
                                recent={recentSlots.includes(s.slotId)}
                              />
                            );
                          } else {
                            const isOpponentSelectable = (
                              specialMode === 'spy' ||
                              specialMode === 'blind-swap-opponent' ||
                              specialMode === 'black-king-see'
                            );
                            return (
                              <CaboSlotView key={s.slotId} label={`${player?.displayName ?? 'Player'}: card ${h.slots.indexOf(s) + 1}`}
                                card={null}
                                selectable={isOpponentSelectable && !snapMode}
                                selected={selectedOpponentSlot?.slotId === s.slotId}
                                snapTarget={snapMode}
                                onSelect={() => {
                                  if (snapMode) { handleSnapSlot(h.playerId, s.slotId); return; }
                                  handleOpponentSlotClick(h.playerId, s.slotId);
                                }}
                                cardSize={cardSize}
                                showFaceUp={false}
                                recent={recentSlots.includes(s.slotId)}
                              />
                            );
                          }
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Turn actions */}
      {isMyTurn && !peekActive && specialMode === 'none' && !snapMode && (phase === 'play' || phase === 'cabo-called') && (
        <Panel style={{ padding: isMobile ? theme.spacing.lg : theme.spacing['2xl'], ...(isMobile ? stickyTurnPanel : {}) }}>
          <div style={{ fontWeight: 600, color: theme.colors.primary[400], marginBottom: 12 }}>
            {phase === 'cabo-called' ? 'Your final turn' : 'Your turn'}
          </div>

          {!hasPendingDraw && !hasBlackKingPending && (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <Btn size={isMobile ? 'sm' : 'md'} disabled={game.extraDeckCount === 0 && !game.discardTop} onClick={() => {
                setDeckShaking(true);
                setTimeout(() => setDeckShaking(false), 500);
                emit('cabo:draw', {}, (r: any) => {
                  if (r?.error) return notify(r.error);
                  setPendingDraw(r.card);
                });
              }}>Draw from deck</Btn>
              <Btn variant="outline" size={isMobile ? 'sm' : 'md'} disabled={!game.discardTop} onClick={() => {
                // Never guess the slot: replacing the wrong hidden card is not undoable.
                if (!selectedOwnSlot || !mySlots?.some((s) => s.slotId === selectedOwnSlot)) return notify('Select one of your cards first, then take the discard');
                emit('cabo:takeDiscard', { slotId: selectedOwnSlot }, (r: any) => {
                  if (r?.error) return notify(r.error);
                  setSelectedOwnSlot(null);
                });
              }}>
                {selectedOwnSlot ? 'Take discard → selected card' : 'Take discard'}
              </Btn>
              {phase === 'play' && (
                <Btn variant="warning" size={isMobile ? 'sm' : 'md'} onClick={() => setConfirmCabo(true)}>Call Cabo</Btn>
              )}
            </div>
          )}
          {confirmCabo && (
            <Modal title="Call Cabo?" onClose={() => setConfirmCabo(false)}>
              <p style={{ lineHeight: 1.7, marginTop: 0 }}>Every other player gets one last turn, then all hands are scored. If yours is not the lowest hand, you add 5 points.</p>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <Btn variant="outline" onClick={() => setConfirmCabo(false)}>Keep playing</Btn>
                <Btn variant="warning" onClick={() => {
                  setConfirmCabo(false);
                  emit('cabo:callCabo', {}, (r: any) => { if (r?.error) notify(r.error); });
                }}>Call Cabo</Btn>
              </div>
            </Modal>
          )}

          {hasPendingDraw && pendingDraw && !hasBlackKingPending && (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ color: theme.colors.dark[300] }}>Drawn:</span>
              <CardView card={pendingDraw} size={isMobile ? 'sm' : 'md'} hover={false} />
              <div style={{ display: 'flex', gap: 8, flexDirection: 'column' }}>
                <span style={{ fontSize: theme.typography.fontSize.sm, color: theme.colors.dark[400] }}>
                  Click one of your cards to place it there
                </span>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {getSpecialAction(pendingDraw) && (
                    <Btn variant="secondary" size="sm" onClick={() => {
                      const action = getSpecialAction(pendingDraw)!;
                      if (action === 'peek-own') setSpecialMode('peek-own');
                      else if (action === 'spy') setSpecialMode('spy');
                      else if (action === 'blind-swap') setSpecialMode('blind-swap-own');
                      else if (action === 'black-king-see') setSpecialMode('black-king-see');
                    }}>
                      Use Power ({getSpecialAction(pendingDraw)})
                    </Btn>
                  )}
                  <Btn variant="outline" size="sm" onClick={() => {
                    emit('cabo:discardDrawn', {}, (r: any) => {
                      if (r?.error) return notify(r.error);
                      setPendingDraw(null);
                    });
                  }}>Discard without use</Btn>
                </div>
              </div>
            </div>
          )}

          {!selectedOwnSlot && !hasPendingDraw && !hasBlackKingPending && (
            <p style={{ margin: '8px 0 0', fontSize: theme.typography.fontSize.sm, color: theme.colors.dark[400] }}>
              Draw from the deck, or click one of your cards and take the discard into that spot.
            </p>
          )}
        </Panel>
      )}
    </div>
  );
}

// ---- Teen Patti ----
// Renders only what the server sends: the public `tp` block, and in the
// private state your own cards (once seen), your legal moves (tpOptions) and
// any side-show request. No Teen Patti rule is computed here.

const coins = (n: number) => n.toLocaleString('en-US');

function tpLobbySummary(config: GameSnapshot['config']) {
  const stakes = { low: 'low stakes', medium: 'medium stakes', high: 'high stakes' }[config.tpStakes ?? 'medium'];
  const hands = config.tpHands ? `${config.tpHands} hands` : 'unlimited hands';
  const extras = [config.tpSideShow === false ? 'no side shows' : 'side shows on', config.tpBlindLimit ? `see after ${config.tpBlindLimit} blind bets` : ''].filter(Boolean);
  return `Teen Patti · ${stakes} · ${hands} · ${extras.join(' · ')}`;
}

// A row of toggle buttons for a create-screen option.
function OptionRow<T extends string | number | boolean>({ label, value, onChange, options }: {
  label: string; value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string; hint?: string }>;
}) {
  return (
    <div role="group" aria-label={label}>
      <div style={{ display: 'block', fontSize: theme.typography.fontSize.xs, fontWeight: theme.typography.fontWeight.semibold, color: theme.colors.dark[400], marginBottom: theme.spacing.sm, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${options.length}, 1fr)`, gap: theme.spacing.sm }}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button key={String(o.value)} type="button" aria-pressed={on} onClick={() => onChange(o.value)} style={{
              padding: `${theme.spacing.md} ${theme.spacing.sm}`, background: on ? theme.colors.primary[500] : theme.colors.dark[900],
              border: `1px solid ${on ? theme.colors.primary[500] : theme.colors.dark[600]}`, borderRadius: theme.borderRadius.lg,
              color: on ? '#1d1607' : theme.colors.dark[200], fontWeight: theme.typography.fontWeight.semibold, fontSize: theme.typography.fontSize.sm,
              fontFamily: theme.typography.fontFamily, cursor: 'pointer', transition: 'all 0.15s ease', lineHeight: 1.3,
            }}>
              {o.label}
              {o.hint && <span style={{ display: 'block', fontWeight: 400, fontSize: theme.typography.fontSize.xs, color: on ? '#3a2c0c' : theme.colors.dark[400], marginTop: 2 }}>{o.hint}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Chip({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'gold' | 'blue' | 'muted' }) {
  const tones = {
    neutral: { color: theme.colors.dark[200], border: theme.colors.dark[600], background: theme.colors.dark[700] },
    gold: { color: '#1d1607', border: theme.colors.primary[500], background: theme.colors.primary[500] },
    blue: { color: theme.colors.secondary[300], border: theme.colors.secondary[700], background: 'transparent' },
    muted: { color: theme.colors.dark[400], border: theme.colors.dark[600], background: 'transparent' },
  }[tone];
  return <span style={{ fontSize: theme.typography.fontSize.xs, fontWeight: 600, padding: '2px 9px', borderRadius: 999, border: `1px solid ${tones.border}`, background: tones.background, color: tones.color, whiteSpace: 'nowrap' }}>{children}</span>;
}

function TeenPattiTable({ game, playerId, priv, socket }: {
  game: GameSnapshot; playerId: string | null; priv: PrivateGameState | null; socket: Socket | null;
}) {
  const tp = game.tp!;
  const windowWidth = useWindowWidth();
  const isMobile = windowWidth < 640;
  const options = priv?.tpOptions ?? null;
  const ask = priv?.tpSideShowAsk ?? null;
  const known = priv?.tpKnown ?? [];
  const nameOf = (pid: string | null | undefined) => game.players.find((p) => p.playerId === pid)?.displayName ?? 'Someone';
  const emit = (event: string, payload: any = {}) => request(socket, event, payload, (r: any) => { if (r?.error) notify(r.error); });
  const me = tp.seats.find((s) => s.playerId === playerId);
  const playing = game.phase === 'play';
  const recent = game.lastAction?.actorId;
  const isHost = game.hostId === playerId;

  // 1s tick while anyone is disconnected so the kick countdown re-renders.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!game.players.some((p) => !p.connected && p.disconnectedAt)) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [game.players]);
  const seatMin = 3 * 68 + 2 * 6 + 2 * (isMobile ? 8 : 12) + 4;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span style={{ fontFamily: theme.typography.fontFamilyDisplay, fontWeight: 600, fontSize: theme.typography.fontSize.xl, color: theme.colors.dark[50] }}>
            Teen Patti <span style={{ color: theme.colors.dark[400], fontSize: theme.typography.fontSize.base }}>· hand {tp.handNumber}{tp.targetHands ? ` of ${tp.targetHands}` : ''}</span>
          </span>
          <span style={{ color: theme.colors.dark[400], fontSize: theme.typography.fontSize.sm }}>Code <strong style={{ color: theme.colors.dark[200], letterSpacing: '0.1em' }}>{game.code}</strong></span>
        </div>
        <div style={{ display: 'flex', gap: 18, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span style={{ color: theme.colors.dark[300], fontSize: theme.typography.fontSize.sm }}>Pot <strong style={{ fontFamily: theme.typography.fontFamilyDisplay, fontSize: 26, color: theme.colors.primary[400], marginLeft: 4 }}>{coins(tp.pot)}</strong></span>
          <span style={{ color: theme.colors.dark[300], fontSize: theme.typography.fontSize.sm }}>Stake <strong style={{ color: theme.colors.dark[100] }}>{coins(tp.stake)}</strong></span>
          <span style={{ color: theme.colors.dark[400], fontSize: theme.typography.fontSize.sm }}>Boot {coins(tp.boot)} · limit {coins(tp.potLimit)}</span>
        </div>
      </div>

      <LastMove game={game} playerId={playerId} />

      {tp.sideShow && tp.sideShow.to !== playerId && (
        <Panel role="status" style={{ padding: theme.spacing.lg, border: `1px solid ${theme.colors.secondary[600]}` }}>
          <span style={{ color: theme.colors.secondary[300] }}>{tp.sideShow.from === playerId ? 'You' : nameOf(tp.sideShow.from)} asked {nameOf(tp.sideShow.to)} for a side show. Waiting for an answer…</span>
        </Panel>
      )}

      <div style={{ display: 'grid', gap: isMobile ? 10 : 18, gridTemplateColumns: `repeat(auto-fill, minmax(${seatMin}px, 1fr))`, alignItems: 'start' }}>
        {rotateToMe(tp.seats, playerId).map((seat) => {
          const isMe = seat.playerId === playerId;
          const isTurn = playing && tp.turn === seat.playerId;
          const player = game.players.find((p) => p.playerId === seat.playerId);
          const seenCards = isMe ? priv?.tpCards : known.find((k) => k.playerId === seat.playerId)?.cards;
          const status = !seat.inHand ? 'Sitting out' : seat.packed ? 'Packed' : seat.seen ? 'Seen' : 'Blind';
          // Phones: other players' face-down hands collapse to one short row so
          // eight seats fit without a long scroll.
          if (isMobile && !isMe && !seenCards) return (
            <div key={seat.playerId} style={{
              padding: '8px 10px', borderRadius: theme.borderRadius.lg,
              border: `2px solid ${isTurn ? theme.colors.dark[500] : 'transparent'}`,
              background: isTurn ? 'rgba(245, 244, 236, 0.04)' : 'transparent',
              opacity: seat.packed || !seat.inHand ? 0.6 : player && !player.connected ? 0.7 : 1,
              ...(recent === seat.playerId && !isTurn ? { outline: `2px dashed ${theme.colors.primary[300]}55`, outlineOffset: 2 } : {}),
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600, color: theme.colors.dark[200] }}>{player?.displayName}</span>
                {tp.dealerId === seat.playerId && <Chip tone="muted">Dealer</Chip>}
                {isTurn && <Chip tone="gold">Turn</Chip>}
                <Chip tone={status === 'Seen' ? 'blue' : 'neutral'}>{status}</Chip>
                {player && !player.connected && <span style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.dark[400] }}>disconnected</span>}
                {isHost && player && !player.connected && player.disconnectedAt && Date.now() - player.disconnectedAt >= 30_000 && <Btn size="sm" variant="error" onClick={() => emit('tp:kickPlayer', { playerId: seat.playerId })}>Kick</Btn>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, fontSize: theme.typography.fontSize.sm, fontVariantNumeric: 'tabular-nums' }}>
                {seat.inHand && <span aria-hidden="true" style={{ display: 'inline-flex', gap: 3 }}>{[0, 1, 2].map((i) => <span key={i} style={{ width: 14, height: 20, borderRadius: 3, border: `1px solid ${theme.colors.primary[700]}`, background: theme.colors.dark[700] }} />)}</span>}
                <span style={{ color: theme.colors.dark[200] }}>{coins(seat.coins)} coins</span>
                {seat.inHand && <span style={{ color: theme.colors.dark[400], marginLeft: 'auto' }}>in pot {coins(seat.bet)}</span>}
              </div>
            </div>
          );
          return (
            <div key={seat.playerId} style={{
              padding: isMobile ? 8 : 12, borderRadius: theme.borderRadius.xl,
              border: `2px solid ${isTurn ? (isMe ? theme.colors.primary[500] : theme.colors.dark[500]) : 'transparent'}`,
              boxShadow: isTurn && isMe ? theme.shadows.glow : 'none',
              opacity: seat.packed || !seat.inHand ? 0.6 : player && !player.connected ? 0.7 : 1,
              transition: 'all 0.3s ease-in-out',
              ...(recent === seat.playerId && !isTurn ? { outline: `2px dashed ${theme.colors.primary[300]}55`, outlineOffset: 2 } : {}),
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                <span style={{ fontWeight: 600, color: isMe ? theme.colors.primary[400] : theme.colors.dark[200] }}>{player?.displayName}{isMe ? ' (you)' : ''}</span>
                {tp.dealerId === seat.playerId && <Chip tone="muted">Dealer</Chip>}
                {isTurn && <Chip tone="gold">Turn</Chip>}
                <Chip tone={status === 'Seen' ? 'blue' : 'neutral'}>{status}</Chip>
                {player && !player.connected && <span style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.dark[400] }}>disconnected</span>}
                {isHost && !isMe && player && !player.connected && player.disconnectedAt && (Date.now() - player.disconnectedAt >= 30_000
                  ? <Btn size="sm" variant="error" onClick={() => emit('tp:kickPlayer', { playerId: seat.playerId })}>Kick</Btn>
                  : <span style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.dark[500] }}>kick in {Math.max(0, 30 - Math.floor((Date.now() - player.disconnectedAt) / 1000))}s</span>)}
              </div>
              <div style={{ display: 'flex', gap: 6, minHeight: 88, alignItems: 'center' }}>
                {seat.inHand
                  ? (seenCards ?? [null, null, null]).map((c, i) => <div key={i}>{c ? <CardView card={c} size="sm" hover={false} /> : <CardBack size="sm" />}</div>)
                  : <span style={{ color: theme.colors.dark[400], fontSize: theme.typography.fontSize.sm }}>Not dealt in this hand</span>}
              </div>
              {!isMe && seenCards && <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.secondary[300], marginTop: 6 }}>You saw these in a side show</div>}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: theme.typography.fontSize.sm, fontVariantNumeric: 'tabular-nums' }}>
                <span style={{ color: theme.colors.dark[200] }}>{coins(seat.coins)} coins</span>
                {seat.inHand && <span style={{ color: theme.colors.dark[400] }}>in pot {coins(seat.bet)}</span>}
              </div>
            </div>
          );
        })}
      </div>

      {playing && me && (
        <Panel style={{ padding: isMobile ? theme.spacing.lg : theme.spacing['2xl'], ...(isMobile ? stickyTurnPanel : {}) }}>
          {ask ? (
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ fontWeight: 600, color: theme.colors.secondary[300] }}>{nameOf(ask.from)} asked you for a side show</div>
              <div style={{ color: theme.colors.dark[300], fontSize: theme.typography.fontSize.sm, lineHeight: 1.6 }}>Accept to compare hands privately: the lower hand packs, and on a tie {nameOf(ask.from)} packs. Decline and play carries on.</div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <Btn variant="secondary" size={isMobile ? 'sm' : 'md'} onClick={() => emit('tp:sideShowAnswer', { accept: true })}>Accept side show</Btn>
                <Btn variant="outline" size={isMobile ? 'sm' : 'md'} onClick={() => emit('tp:sideShowAnswer', { accept: false })}>Decline</Btn>
              </div>
            </div>
          ) : options?.myTurn ? (
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ fontWeight: 600, color: theme.colors.primary[400] }}>Your turn <span style={{ color: theme.colors.dark[400], fontWeight: 400 }}>· {me.seen ? 'seen' : 'playing blind'} · pot {coins(tp.pot)} · stake {coins(tp.stake)}</span></div>
              {options.mustSee && <div style={{ color: theme.colors.warning[400], fontSize: theme.typography.fontSize.sm }}>Blind limit reached: look at your cards to keep playing.</div>}
              {options.bets.some((b) => tp.pot + b.amount >= tp.potLimit) && <div style={{ color: theme.colors.primary[300], fontSize: theme.typography.fontSize.sm }}>The pot limit is {coins(tp.potLimit)}. A bet that reaches it ends the hand: every hand still in is shown.</div>}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {options.canSee && <Btn variant="outline" size={isMobile ? 'sm' : 'md'} onClick={() => emit('tp:see')}>See cards</Btn>}
                {options.bets.map((b) => <Btn key={String(b.double)} variant={b.double ? 'warning' : 'primary'} size={isMobile ? 'sm' : 'md'} onClick={() => emit('tp:bet', { double: b.double })}>{b.label} {coins(b.amount)}</Btn>)}
                {options.show && <Btn variant="success" size={isMobile ? 'sm' : 'md'} onClick={() => emit('tp:show')}>Show · {coins(options.show.cost)}</Btn>}
                {options.sideShow && <Btn variant="secondary" size={isMobile ? 'sm' : 'md'} onClick={() => emit('tp:sideShow')}>Side show with {nameOf(options.sideShow.target)} · {coins(options.sideShow.cost)}</Btn>}
                <Btn variant="ghost" size={isMobile ? 'sm' : 'md'} onClick={() => emit('tp:pack')}>Pack</Btn>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
              <span style={{ color: theme.colors.dark[300] }}>
                {!me.inHand ? 'You are sitting out this hand.' : me.packed ? 'You packed this hand.' : `Waiting for ${nameOf(tp.turn)}…`}
                <span style={{ color: theme.colors.dark[400] }}> · pot {coins(tp.pot)}</span>
              </span>
              <div style={{ display: 'flex', gap: 10 }}>
                {options?.canSee && <Btn variant="outline" size="sm" onClick={() => emit('tp:see')}>See cards</Btn>}
                {options?.canRefill && <Btn size="sm" onClick={() => emit('tp:refill')}>Refill to {coins(tp.start)}</Btn>}
              </div>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}

function TpResultModal({ game, playerId, priv, phase, onAckNextRound, onAckRematch, onLeave, onRules, socket }: {
  game: GameSnapshot; playerId: string | null; priv: PrivateGameState | null; phase: GamePhase; socket: Socket | null;
  onAckNextRound: () => void; onAckRematch: () => void; onLeave: () => void; onRules: () => void;
}) {
  const tp = game.tp!;
  const result = tp.result;
  const isEnd = phase === 'rematch-pending';
  const acks = isEnd ? (game.rematchAcks ?? []) : (game.betweenRoundAcks ?? []);
  const alreadyAcked = playerId ? acks.includes(playerId) : false;
  const nameOf = (pid: string) => game.players.find((p) => p.playerId === pid)?.displayName ?? 'Someone';
  const me = tp.seats.find((s) => s.playerId === playerId);
  const myCards = priv?.tpCards;
  const iWasShown = result?.shown.some((h) => h.playerId === playerId);
  const winners = result?.winners ?? [];
  const how = result?.how === 'show' ? 'won the show' : result?.how === 'pot-limit' ? 'had the best hand when the pot limit was reached' : 'stayed in while everyone else packed';
  const standings = isEnd && tp.leaderboard ? tp.leaderboard.map((r) => r.playerId) : tp.seats.map((s) => s.playerId);

  return (
    <>
      {isEnd && <Confetti />}
      <Modal title={isEnd ? 'Game over' : `Hand ${result?.handNumber ?? tp.handNumber} result`}>
        <div className="fade-in">
          {result && (
            <div style={{ marginBottom: theme.spacing['2xl'], padding: theme.spacing.lg, background: 'rgba(209, 168, 69, 0.12)', border: `1px solid ${theme.colors.primary[700]}`, borderRadius: theme.borderRadius.lg }}>
              <strong style={{ color: theme.colors.primary[400] }}>{winners.map((w) => (w === playerId ? 'You' : nameOf(w))).join(' and ')}</strong>
              <span style={{ color: theme.colors.dark[200] }}> {winners.length > 1 ? `split ${coins(result.pot)} coins: tied for the best hand.` : `won ${coins(result.pot)} coins: ${how}.`}</span>
            </div>
          )}
          {result && result.shown.length > 0 && (
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', marginBottom: theme.spacing['2xl'] }}>
              {[...result.shown].sort((a, b) => Number(winners.includes(b.playerId)) - Number(winners.includes(a.playerId))).map((h) => (
                <div key={h.playerId} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', gap: 6 }}>{h.cards.map((c) => <CardView key={c.cardId} card={c} size="sm" hover={false} />)}</div>
                  <div>
                    <div style={{ fontWeight: 600, color: winners.includes(h.playerId) ? theme.colors.primary[400] : theme.colors.dark[200] }}>{h.playerId === playerId ? 'You' : nameOf(h.playerId)}{winners.includes(h.playerId) ? ' ★' : ''}</div>
                    <div style={{ color: theme.colors.dark[300], fontSize: theme.typography.fontSize.sm }}>{h.hand}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {myCards && !iWasShown && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: theme.spacing['2xl'] }}>
              <div style={{ display: 'flex', gap: 6 }}>{myCards.map((c) => <CardView key={c.cardId} card={c} size="sm" hover={false} />)}</div>
              <span style={{ color: theme.colors.dark[300], fontSize: theme.typography.fontSize.sm }}>Your hand this time (only you can see it)</span>
            </div>
          )}
          <div style={{ overflowX: 'auto', marginBottom: theme.spacing['2xl'] }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: theme.typography.fontSize.sm, color: theme.colors.dark[200], fontVariantNumeric: 'tabular-nums' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${theme.colors.dark[600]}` }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px', color: theme.colors.dark[400] }}>Player</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px', color: theme.colors.dark[400] }}>This hand</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px', color: theme.colors.dark[400] }}>Coins</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px', color: theme.colors.dark[300], fontWeight: 700 }}>Net</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((pid) => {
                  const seat = tp.seats.find((s) => s.playerId === pid);
                  if (!seat) return null;
                  const delta = result?.deltas[pid] ?? 0;
                  const top = isEnd && tp.leaderboard?.find((r) => r.playerId === pid)?.rank === 1;
                  return (
                    <tr key={pid} style={{ borderBottom: `1px solid ${theme.colors.dark[700]}`, background: top ? 'rgba(209, 168, 69, 0.08)' : 'transparent' }}>
                      <td style={{ padding: '6px 8px', color: pid === playerId ? theme.colors.primary[400] : theme.colors.dark[200] }}>{nameOf(pid)}{pid === playerId ? ' (you)' : ''}{top ? ' ★' : ''}{seat.refills ? <span style={{ color: theme.colors.dark[400] }}> · {seat.refills} refill{seat.refills > 1 ? 's' : ''}</span> : null}</td>
                      <td style={{ textAlign: 'right', padding: '6px 8px', color: delta > 0 ? theme.colors.success[400] : delta < 0 ? theme.colors.error[400] : theme.colors.dark[400] }}>{delta > 0 ? '+' : ''}{coins(delta)}</td>
                      <td style={{ textAlign: 'right', padding: '6px 8px' }}>{coins(seat.coins)}</td>
                      <td style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 700, color: theme.colors.dark[100] }}>{seat.net > 0 ? '+' : ''}{coins(seat.net)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {game.notice && <p role="status" style={{ color: theme.colors.primary[300] }}>{game.notice}</p>}
          {me && priv?.tpOptions?.canRefill && (
            <Panel style={{ padding: theme.spacing.lg, marginBottom: theme.spacing['2xl'], display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <span style={{ color: theme.colors.dark[200] }}>You need {coins(tp.potLimit)} coins to be dealt in. Refills are free: play coins only.</span>
              <Btn size="sm" onClick={() => request(socket, 'tp:refill', {}, (r: any) => { if (r?.error) notify(r.error); })}>Refill to {coins(tp.start)}</Btn>
            </Panel>
          )}
          <div style={{ marginBottom: theme.spacing['2xl'] }}>
            <div style={{ fontSize: theme.typography.fontSize.sm, color: theme.colors.dark[400], marginBottom: theme.spacing.sm }}>Ready</div>
            <div style={{ display: 'flex', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
              {game.players.map((p) => (
                <span key={p.playerId} style={{ padding: `${theme.spacing.xs} ${theme.spacing.md}`, borderRadius: theme.borderRadius.lg, fontSize: theme.typography.fontSize.sm, background: acks.includes(p.playerId) ? `${theme.colors.success[600]}55` : theme.colors.dark[700], color: acks.includes(p.playerId) ? theme.colors.success[500] : theme.colors.dark[400], border: `1px solid ${acks.includes(p.playerId) ? theme.colors.success[500] : theme.colors.dark[600]}` }}>
                  {acks.includes(p.playerId) ? '✓ ' : ''}{p.displayName}
                </span>
              ))}
            </div>
          </div>
          <div style={modalActions}>
            <Btn variant="ghost" onClick={onRules}>Rules & how to play</Btn>
            <Btn variant="outline" onClick={onLeave}>Leave room</Btn>
            <Btn variant="success" onClick={isEnd ? onAckRematch : onAckNextRound} disabled={alreadyAcked}>
              {alreadyAcked ? 'Waiting…' : isEnd ? 'Play again' : 'Next hand'}
            </Btn>
          </div>
        </div>
      </Modal>
    </>
  );
}

// ---- Main App ----

export function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connection, setConnection] = useState<'connecting' | 'connected' | 'offline' | 'replaced'>('connecting');
  // Has this tab ever reached the server? A hosted server that was asleep can
  // take up to a minute to wake, which should not read as "connection lost".
  const [everConnected, setEverConnected] = useState(false);
  const [slowStart, setSlowStart] = useState(false);
  useEffect(() => {
    if (everConnected) return;
    const t = setTimeout(() => setSlowStart(true), 4000);
    return () => clearTimeout(t);
  }, [everConnected]);
  const [showRules, setShowRules] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [privateState, setPrivateState] = useState<PrivateGameState | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<'landing' | 'create' | 'join' | 'lobby' | 'table'>(/^\d{4}$/.test(new URLSearchParams(location.search).get('room') ?? '') ? 'join' : 'landing');
  const [displayName, setDisplayName] = useState(() => localStorage.getItem('golf_name') ?? '');
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('room') ?? '');
  const [game, setGame] = useState<GameSnapshot | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [playerToken, setPlayerToken] = useState<string | null>(null);
  const [hand, setHand] = useState<CardT[]>([]);
  const [cardsPerPlayer, setCardsPerPlayer] = useState(4);
  const [gameMode, setGameMode] = useState<'classic' | 'golf' | 'cabo' | 'teenpatti'>('golf');
  const [tpStakes, setTpStakes] = useState<'low' | 'medium' | 'high'>('medium');
  const [tpHands, setTpHands] = useState(10);
  const [tpSideShow, setTpSideShow] = useState(true);
  const [tpBlindLimit, setTpBlindLimit] = useState(0);
  const [myGolfSlots, setMyGolfSlots] = useState<Array<{ slotId: string; card: CardT | null; revealed: boolean; locked: boolean; peekOnly?: boolean }> | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [pendingDraw, setPendingDraw] = useState<CardT | null>(null);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  // Cabo state
  const [caboMySlots, setCaboMySlots] = useState<CaboSlotPrivate[] | null>(null);
  const [caboPendingDraw, setCaboPendingDraw] = useState<CardT | null>(null);
  const [caboSnapGap, setCaboSnapGap] = useState<{ opponentId: string } | null>(null);

  const windowWidth = useWindowWidth();
  const isMobile = windowWidth < 640;

  const serverUrl = useMemo(() => ((import.meta as any).env?.VITE_SERVER_URL as string) || (location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? 'http://localhost:3001' : location.origin), []);

  function persistSession(pid: string, tok: string, gameCode: string) {
    localStorage.setItem('golf_name', displayName.trim());
    sessionStorage.setItem('golf_playerId', pid);
    sessionStorage.setItem('golf_playerToken', tok);
    sessionStorage.setItem('golf_code', gameCode);
  }
  function clearSession() {
    sessionStorage.removeItem('golf_playerId');
    sessionStorage.removeItem('golf_playerToken');
    sessionStorage.removeItem('golf_code');
  }

  useEffect(() => {
    const s = io(serverUrl);
    setSocket(s);

    s.on('game:update', (snapshot: GameSnapshot) => {
      setGame(snapshot);
      setView(snapshot.phase === 'waiting' ? 'lobby' : 'table');
    });
    s.on('game:private', (state: PrivateGameState) => {
      setPrivateState(state);
      setMyGolfSlots(state.golfSlots); setCaboMySlots(state.caboSlots);
      setPendingDraw(state.pendingDraw); setCaboPendingDraw(state.caboPendingDraw); setCaboSnapGap(state.snapGap);
    });
    s.on('disconnect', () => setConnection(current => current === 'replaced' ? current : 'offline'));
    s.on('connect_error', () => setConnection('offline'));
    s.on('session:replaced', () => {
      setConnection('replaced'); clearSession(); setGame(null); setPrivateState(null); setPlayerId(null); setPlayerToken(null); setView('landing');
      notify('This seat was opened in another tab. Enter your name to join as a different player.');
    });

    s.on('hand:update', (cards: CardT[]) => setHand(cards));
    s.on('golf:hand', (slots: any) => setMyGolfSlots(slots));
    s.on('golf:pendingDraw', (card: CardT) => setPendingDraw(card));
    s.on('cabo:hand', (slots: CaboSlotPrivate[]) => setCaboMySlots(slots));
    s.on('cabo:pendingDraw', (card: CardT) => setCaboPendingDraw(card));

    s.on('connect', () => {
      setConnection('connected');
      setEverConnected(true);
      const tok = sessionStorage.getItem('golf_playerToken');
      const savedCode = sessionStorage.getItem('golf_code');
      if (tok && savedCode) {
        request(s, 'rejoinGame', { playerToken: tok }, (res: any) => {
          if (res?.code === 'TIMEOUT') return;
          if (res?.error) {
            notify('That room has ended or expired. Create or join a new room.');
            setPrivateState(null);
            clearSession();
            setGame(null); setPlayerId(null); setPlayerToken(null); setCode('');
            setMyGolfSlots(null); setPendingDraw(null); setSelectedSlotId(null);
            setCaboMySlots(null); setCaboPendingDraw(null); setCaboSnapGap(null);
            setView('landing');
            return;
          }
          setPlayerId(res.playerId);
          setPlayerToken(res.playerToken);
          setCode(res.code);
          // The server snapshot selects the correct lobby/table view.
        });
      }
    });

    return () => { s.close(); };
  }, [serverUrl]);

  const phase = game?.phase;
  const isGolf = game?.config.gameMode === 'golf';
  const isCabo = game?.config.gameMode === 'cabo';
  const isTp = game?.config.gameMode === 'teenpatti';
  const isHost = playerId === game?.hostId;

  function createGame() {
    if (!socket?.connected || busy || !displayName.trim()) return;
    setBusy(true);
    const config = {
      maxPlayers: 8,
      totalCardsPerDeck: 52,
      numberOfDecks: 1,
      cardsPerPlayer: gameMode === 'cabo' ? 4 : gameMode === 'teenpatti' ? 3 : cardsPerPlayer,
      gameMode,
      ...(gameMode === 'teenpatti' ? { tpStakes, tpHands, tpSideShow, tpBlindLimit } : {}),
    };
    request(socket, 'createGame', { displayName, config }, (res: any) => {
      setBusy(false);
      if (res?.error) return notify(res.error);
      setPlayerId(res.playerId);
      setPlayerToken(res.playerToken);
      setCode(res.code);
      persistSession(res.playerId, res.playerToken, res.code);
      setView('lobby');
    });
  }

  function joinGame() {
    if (!socket?.connected || busy || !displayName.trim()) return;
    setBusy(true);
    request(socket, 'joinGame', { code: code.trim(), displayName }, (res: any) => {
      setBusy(false);
      if (res?.error) return notify(res.error);
      setPlayerId(res.playerId);
      setPlayerToken(res.playerToken);
      setCode(res.code);
      persistSession(res.playerId, res.playerToken, res.code);
      setView('lobby');
    });
  }

  function startGame() {
    request(socket, 'startGame', {}, (res: any) => {
      if (res?.error) return notify(res.error);
      setView('table');
    });
  }

  function fetchLeaderboard() {
    request(socket, 'getLeaderboard', {}, (res: any) => {
      if (res?.leaderboard) { setLeaderboard(res.leaderboard); setShowLeaderboard(true); }
    });
  }

  function ackNextRound() {
    const event = isTp ? 'tp:ackNextHand' : isCabo ? 'cabo:ackNextRound' : 'golf:ackNextRound';
    request(socket, event, {}, (res: any) => { if (res?.error) notify(res.error); });
  }

  function ackRematch() {
    const event = isTp ? 'tp:ackRematch' : isCabo ? 'cabo:ackRematch' : 'golf:ackRematch';
    request(socket, event, {}, (res: any) => { if (res?.error) notify(res.error); });
  }

  function leaveGame() {
    const event = isTp ? 'tp:leaveGame' : isCabo ? 'cabo:leaveGame' : 'golf:leaveGame';
    request(socket, event, {}, (res: any) => {
      if (res?.error) return notify(res.error);
      clearSession(); setPrivateState(null); setConfirmLeave(false);
      setGame(null); setPlayerId(null); setPlayerToken(null); setCode('');
      setMyGolfSlots(null); setPendingDraw(null); setSelectedSlotId(null);
      setCaboMySlots(null); setCaboPendingDraw(null); setCaboSnapGap(null);
      setView('landing');
    });
  }

  function addBot() {
    request(socket, 'addBot', {}, (res: any) => { if (res?.error) notify(res.error); });
  }

  function removeBot(botId: string) {
    request(socket, 'removeBot', { playerId: botId }, (res: any) => { if (res?.error) notify(res.error); });
  }

  function updateConfig(cpp: number) {
    request(socket, 'golf:updateConfig', { cardsPerPlayer: cpp }, (res: any) => { if (res?.error) notify(res.error); });
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: theme.spacing.lg,
    background: theme.colors.dark[900], border: `1px solid ${theme.colors.dark[600]}`,
    borderRadius: theme.borderRadius.lg, color: theme.colors.dark[100],
    fontSize: theme.typography.fontSize.base, fontFamily: theme.typography.fontFamily,
     transition: 'border-color 0.15s ease, box-shadow 0.15s ease', boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: theme.typography.fontSize.xs, fontWeight: theme.typography.fontWeight.semibold,
    color: theme.colors.dark[400], marginBottom: theme.spacing.sm,
    textTransform: 'uppercase', letterSpacing: '0.08em',
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: `
        repeating-linear-gradient(45deg,  rgba(245,244,236,0.008) 0px, rgba(245,244,236,0.008) 1px, transparent 1px, transparent 6px),
        radial-gradient(ellipse 120% 90% at 50% 0%, #16291c 0%, #0c1710 55%, #070d09 100%)
      `,
      fontFamily: theme.typography.fontFamily, color: theme.colors.dark[100],
      padding: isMobile ? theme.spacing.lg : theme.spacing['3xl'], position: 'relative',
    }}>
      <Toasts />
      <header style={{ maxWidth: 1000, margin: '0 auto 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ color: theme.colors.primary[300], fontFamily: theme.typography.fontFamilyDisplay, fontSize: 22 }}>The Card Room</span>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Btn variant="outline" size="sm" onClick={() => setShowRules(true)}>Rules & how to play</Btn>
          {game && <Btn variant="ghost" size="sm" onClick={() => setConfirmLeave(true)}>Leave room</Btn>}
        </div>
      </header>
      {connection !== 'connected' && <Panel role="status" style={{ maxWidth: 1000, margin: '0 auto 20px', padding: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <span>{connection === 'replaced' ? 'Your seat moved to another tab.'
          : !everConnected ? (slowStart ? 'Waking up the card room… If nobody has played for a while, the server can take up to a minute to start. This page will connect on its own.' : 'Connecting to the card room…')
          : connection === 'connecting' ? 'Connecting to the card room…'
          : game ? 'Connection lost. Reconnecting… Your seat is held for 30 seconds.' : 'Connection lost. Reconnecting…'}</span>
        <Btn size="sm" variant="outline" onClick={() => { setConnection('connecting'); socket?.connect(); }}>Retry connection</Btn>
      </Panel>}
      {game?.notice && <p role="status" style={{ maxWidth: 1000, margin: '0 auto 16px', color: theme.colors.primary[300] }}>{game.notice}</p>}
      {game?.paused && <Panel role="status" style={{ maxWidth: 1000, margin: '0 auto 16px', padding: 16 }}>Play is paused while another player reconnects. After 30 seconds, an absent player leaves the room automatically.</Panel>}



      {/* Landing */}
      {view === 'landing' && (
        <div className="view-enter" style={{ maxWidth: 740, margin: '0 auto', paddingTop: theme.spacing['2xl'], position: 'relative', zIndex: 1 }}>
          <div style={{ textAlign: 'center', marginBottom: theme.spacing['4xl'] }}>
            <div aria-hidden="true" style={{ color: theme.colors.primary[500], fontSize: theme.typography.fontSize.lg, letterSpacing: '0.5em', marginBottom: theme.spacing.md, paddingLeft: '0.5em' }}>♠ ♥ ♦ ♣</div>
            <h1 style={{ fontFamily: theme.typography.fontFamilyDisplay, fontSize: theme.typography.fontSize['4xl'], fontWeight: theme.typography.fontWeight.semibold, color: theme.colors.dark[50], margin: `0 0 ${theme.spacing.md}`, letterSpacing: '-0.01em', lineHeight: theme.typography.lineHeight.tight }}>A good hand. A better evening.</h1>
            <p style={{ color: theme.colors.dark[400], fontSize: theme.typography.fontSize.base, margin: 0 }}>Golf, Cabo & Teen Patti · 2–8 players · friends or bots</p>
          </div>
          <Panel style={{ padding: theme.spacing['3xl'], marginBottom: theme.spacing['2xl'] }}>
            <div style={{ marginBottom: theme.spacing['2xl'] }}>
              <label htmlFor="display-name" style={labelStyle}>Your name</label>
              <input id="display-name" maxLength={24} autoComplete="nickname" placeholder="Enter your name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} style={inputStyle}
                onFocus={(e) => { e.target.style.borderColor = theme.colors.primary[500]; e.target.style.boxShadow = theme.shadows.glow; }}
                onBlur={(e) => { e.target.style.borderColor = theme.colors.dark[600]; e.target.style.boxShadow = 'none'; }} />
            </div>
            <div style={{ display: 'grid', gap: theme.spacing.lg }}>
              <Btn size="lg" onClick={() => setView('create')}>Create Game</Btn>
              <Btn variant="outline" size="lg" onClick={() => setView('join')}>Join Game</Btn>

            </div>
          </Panel>
          <FirstGameGuide onRules={() => setShowRules(true)} />
        </div>
      )}

      {/* Create */}
      {view === 'create' && (
        <div className="view-enter" style={{ maxWidth: 500, margin: '0 auto', paddingTop: theme.spacing['3xl'], position: 'relative', zIndex: 1 }}>
          <div style={{ marginBottom: theme.spacing['3xl'], textAlign: 'center' }}>
            <h2 style={{ fontFamily: theme.typography.fontFamilyDisplay, fontSize: theme.typography.fontSize['3xl'], fontWeight: theme.typography.fontWeight.semibold, color: theme.colors.dark[50], margin: 0 }}>Create a game</h2>
          </div>
          <Panel style={{ padding: theme.spacing['3xl'] }}>
            <div style={{ marginBottom: 20 }}><label htmlFor="room-name" style={labelStyle}>Your name</label><input id="room-name" autoComplete="nickname" maxLength={24} placeholder="Enter your name" value={displayName} onChange={e => setDisplayName(e.target.value)} style={inputStyle} /></div>

            <div style={{ display: 'grid', gap: theme.spacing['2xl'] }}>
              <div>
                <label htmlFor="game-mode" style={labelStyle}>Game mode</label>
                <select id="game-mode" value={gameMode} onChange={(e) => {
                  const m = e.target.value as 'classic' | 'golf' | 'cabo' | 'teenpatti';
                  setGameMode(m);
                  if (m === 'golf' && ![4,6,8].includes(cardsPerPlayer)) setCardsPerPlayer(4);
                }} style={{ ...inputStyle, cursor: 'pointer' }}>
                  <option value="golf">Golf — memory & matching ranks</option>
                  <option value="cabo">Cabo — powers & quick reactions</option>
                  <option value="teenpatti">Teen Patti — bet with play coins</option>
                  {/* classic hidden: half-finished (no turns, no game end) — GAPS.md #1.
                      Server handlers + table view kept for rejoin safety. */}
                </select>
              </div>
              {gameMode !== 'cabo' && gameMode !== 'teenpatti' && (
                <div>
                  <label style={labelStyle}>Cards Per Player</label>
                  {gameMode === 'golf' ? (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: theme.spacing.md }}>
                      {[4, 6, 8].map((n) => (
                        <button key={n} onClick={() => setCardsPerPlayer(n)} aria-pressed={cardsPerPlayer === n}
                          style={{ padding: theme.spacing.lg, background: cardsPerPlayer === n ? theme.colors.primary[500] : theme.colors.dark[900], border: `1px solid ${cardsPerPlayer === n ? theme.colors.primary[500] : theme.colors.dark[600]}`, borderRadius: theme.borderRadius.lg, color: cardsPerPlayer === n ? '#1d1607' : theme.colors.dark[200], fontWeight: theme.typography.fontWeight.semibold, fontSize: theme.typography.fontSize.base, fontFamily: theme.typography.fontFamily, cursor: 'pointer', transition: 'all 0.15s ease' }}>
                          {n}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <input type="number" min={1} max={13} value={cardsPerPlayer} onChange={(e) => setCardsPerPlayer(parseInt(e.target.value) || 7)} style={inputStyle} />
                  )}
                </div>
              )}
              {gameMode === 'cabo' && (
                <p style={{ margin: 0, fontSize: theme.typography.fontSize.sm, color: theme.colors.dark[400] }}>
                  Cabo always uses 4 cards per player. Game ends when any player exceeds 100 cumulative points.
                </p>
              )}
              {gameMode === 'teenpatti' && (
                <>
                  <OptionRow<'low' | 'medium' | 'high'> label="Stakes" value={tpStakes} onChange={setTpStakes} options={[
                    { value: 'low', label: 'Low', hint: 'boot 10 · start 1,000' },
                    { value: 'medium', label: 'Medium', hint: 'boot 100 · start 10,000' },
                    { value: 'high', label: 'High', hint: 'boot 1,000 · start 100,000' },
                  ]} />
                  <OptionRow<number> label="Hands per game" value={tpHands} onChange={setTpHands} options={[
                    { value: 10, label: '10' }, { value: 20, label: '20' }, { value: 0, label: 'Unlimited' },
                  ]} />
                  <OptionRow<boolean> label="Side shows" value={tpSideShow} onChange={setTpSideShow} options={[
                    { value: true, label: 'On' }, { value: false, label: 'Off' },
                  ]} />
                  <OptionRow<number> label="Blind limit" value={tpBlindLimit} onChange={setTpBlindLimit} options={[
                    { value: 0, label: 'None' }, { value: 3, label: '3 blind bets' }, { value: 4, label: '4 blind bets' },
                  ]} />
                  <p style={{ margin: 0, fontSize: theme.typography.fontSize.sm, color: theme.colors.dark[400], lineHeight: 1.6 }}>
                    Everyone gets free play coins. No real money, ever. Run low and you can refill between hands.
                  </p>
                </>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: theme.spacing.lg, marginTop: theme.spacing.lg }}>
                <Btn variant="outline" onClick={() => setView('landing')}>Back</Btn>
                <Btn onClick={createGame} size="lg" disabled={!displayName.trim() || connection !== 'connected' || busy}>Create Game</Btn>
              </div>
            </div>
          </Panel>
        </div>
      )}

      {/* Join */}
      {view === 'join' && (
        <div className="view-enter" style={{ maxWidth: 400, margin: '0 auto', paddingTop: theme.spacing['3xl'], position: 'relative', zIndex: 1 }}>
          <div style={{ marginBottom: theme.spacing['3xl'], textAlign: 'center' }}>
            <h2 style={{ fontFamily: theme.typography.fontFamilyDisplay, fontSize: theme.typography.fontSize['3xl'], fontWeight: theme.typography.fontWeight.semibold, color: theme.colors.dark[50], margin: 0 }}>Join a game</h2>
          </div>
          <Panel style={{ padding: theme.spacing['3xl'] }}>
            <div style={{ marginBottom: 20 }}><label htmlFor="room-name" style={labelStyle}>Your name</label><input id="room-name" autoComplete="nickname" maxLength={24} placeholder="Enter your name" value={displayName} onChange={e => setDisplayName(e.target.value)} style={inputStyle} /></div>

            <div style={{ marginBottom: theme.spacing['2xl'] }}>
              <label htmlFor="room-code" style={labelStyle}>Game code</label>
              <input id="room-code" inputMode="numeric" pattern="[0-9]{4}" placeholder="4-digit code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} maxLength={4}
                style={{ ...inputStyle, fontSize: theme.typography.fontSize.xl, fontFamily: 'monospace', textAlign: 'center', letterSpacing: '0.2em' }}
                onFocus={(e) => { e.target.style.borderColor = theme.colors.primary[500]; e.target.style.boxShadow = theme.shadows.glow; }}
                onBlur={(e) => { e.target.style.borderColor = theme.colors.dark[600]; e.target.style.boxShadow = 'none'; }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: theme.spacing.lg }}>
              <Btn variant="outline" onClick={() => setView('landing')}>Back</Btn>
              <Btn onClick={joinGame} size="lg" disabled={!/^\d{4}$/.test(code) || !displayName.trim() || connection !== 'connected' || busy}>Join Game</Btn>
            </div>
          </Panel>
        </div>
      )}

      {/* Lobby */}
      {view === 'lobby' && game && (
        <div className="view-enter" style={{ maxWidth: 480, margin: '0 auto', display: 'grid', gap: 16, position: 'relative', zIndex: 1, paddingTop: theme.spacing['2xl'] }}>
          <h2 style={{ fontFamily: theme.typography.fontFamilyDisplay, fontSize: theme.typography.fontSize['2xl'], fontWeight: theme.typography.fontWeight.semibold, margin: 0, color: theme.colors.dark[50], textAlign: 'center' }}>Waiting for players</h2>
          <Panel style={{ padding: theme.spacing['2xl'], textAlign: 'center' }}>
            <div style={{ fontSize: theme.typography.fontSize.xs, fontWeight: theme.typography.fontWeight.semibold, color: theme.colors.dark[400], textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: theme.spacing.sm }}>Share this code</div>
            <div style={{ fontSize: '2.5rem', fontFamily: '"DM Sans", monospace', fontWeight: theme.typography.fontWeight.bold, color: theme.colors.primary[400], letterSpacing: '0.25em', marginBottom: theme.spacing.md, paddingLeft: '0.25em', fontVariantNumeric: 'tabular-nums' }}>{game.code}</div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
              <Btn variant="outline" size="sm" onClick={() => navigator.clipboard?.writeText(game.code).then(() => notify('Code copied')).catch(() => notify(`Room code: ${game.code}`))}>Copy code</Btn>
              <Btn size="sm" onClick={async () => {
                const url = `${location.origin}${location.pathname}?room=${game.code}`;
                try { await navigator.clipboard.writeText(url); notify('Invite link copied — send it to your friends'); }
                catch { notify(`Share this page and room code ${game.code}`); }
              }}>Copy invite link</Btn>
            </div>

            <div style={{ marginTop: theme.spacing.lg, fontSize: theme.typography.fontSize.sm, color: theme.colors.dark[400] }}>
              {game.config.gameMode === 'golf' ? `Golf · ${game.config.cardsPerPlayer} cards per player`
                : game.config.gameMode === 'cabo' ? 'Cabo · 4 cards · first past 100 loses'
                : game.config.gameMode === 'teenpatti' ? tpLobbySummary(game.config)
                : 'Classic'}
            </div>
          </Panel>
          <Panel style={{ padding: theme.spacing['2xl'] }}>
            <div style={{ fontSize: theme.typography.fontSize.xs, fontWeight: theme.typography.fontWeight.semibold, color: theme.colors.dark[400], textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: theme.spacing.md }}>Players ({game.players.length}/{game.config.maxPlayers})</div>
            <div style={{ display: 'grid', gap: theme.spacing.sm }}>
              {game.players.map((p) => (
                <div key={p.playerId} style={{ display: 'flex', alignItems: 'center', gap: theme.spacing.md, padding: `${theme.spacing.sm} ${theme.spacing.md}`, background: theme.colors.dark[900], border: `1px solid ${theme.colors.dark[700]}`, borderRadius: theme.borderRadius.lg }}>
                  <span aria-hidden="true" style={{ width: 30, height: 30, borderRadius: '50%', background: p.playerId === playerId ? theme.colors.primary[500] : p.isBot ? theme.colors.secondary[700] : theme.colors.dark[600], color: p.playerId === playerId ? '#1d1607' : theme.colors.dark[100], display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: theme.typography.fontSize.sm, fontWeight: theme.typography.fontWeight.bold, flexShrink: 0 }}>
                    {(p.isBot ? p.displayName.replace(/^Bot\s+/, '') : p.displayName || '?').trim().charAt(0).toUpperCase()}
                  </span>
                  <span style={{ color: p.playerId === playerId ? theme.colors.primary[300] : theme.colors.dark[100], fontWeight: theme.typography.fontWeight.medium, flex: 1, textAlign: 'left' }}>
                    {p.displayName}{p.playerId === playerId ? ' (you)' : ''}
                  </span>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {p.playerId === game.hostId && <span style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.primary[400], border: `1px solid ${theme.colors.primary[700]}`, borderRadius: 999, padding: '2px 10px' }}>Host</span>}
                    {!p.connected && <span style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.dark[400] }}>disconnected</span>}
                    {p.isBot && isHost && <Btn variant="ghost" size="sm" aria-label={`Remove ${p.displayName}`} onClick={() => removeBot(p.playerId)}>Remove</Btn>}
                  </div>
                </div>
              ))}
            </div>
            {isHost && game.botsEnabled && game.players.length < game.config.maxPlayers && (
              <Btn variant="outline" size="sm" onClick={addBot} disabled={connection !== 'connected'} style={{ width: '100%', marginTop: theme.spacing.md }}>+ Add a bot</Btn>
            )}
            <div style={{ display: 'flex', gap: theme.spacing.lg, marginTop: theme.spacing['2xl'] }}>
              {isHost && <Btn onClick={startGame} disabled={game.players.filter(p => p.connected).length < 2 || game.players.some(p => !p.connected) || connection !== 'connected'} style={{ flex: 1 }}>Start game</Btn>}
              <Btn variant="outline" onClick={() => setShowRules(true)}>Learn to play</Btn>
            </div>
            {!isHost && <p role="status" style={{ color: theme.colors.dark[300], lineHeight: 1.6 }}>Your host will start the game when everyone is ready. Read the rules while you wait.</p>}
            {isHost && (game.players?.length || 0) < 2 && (
              <p style={{ margin: `${theme.spacing.md} 0 0`, fontSize: theme.typography.fontSize.sm, color: theme.colors.dark[400], textAlign: 'center', lineHeight: 1.6 }}>
                {game.botsEnabled ? 'You need at least 2 players. Send the invite link, or add a bot to play right now.' : 'You need at least 2 players to start'}
              </p>
            )}
          </Panel>
        </div>
      )}

      {/* Classic table */}
      {view === 'table' && game && !isGolf && !isCabo && !isTp && (
        <div className="view-enter" style={{ display: 'grid', gap: 16, position: 'relative', zIndex: 1, maxWidth: 900, margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
            <span style={{ fontFamily: theme.typography.fontFamilyDisplay, fontWeight: theme.typography.fontWeight.semibold, fontSize: theme.typography.fontSize.xl, color: theme.colors.dark[50] }}>Classic</span>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <span style={{ color: theme.colors.dark[400], fontSize: theme.typography.fontSize.sm }}>Code <strong style={{ color: theme.colors.dark[200], letterSpacing: '0.1em' }}>{game.code}</strong></span>
              <span style={{ color: theme.colors.dark[300], fontSize: theme.typography.fontSize.sm }}>{game.extraDeckCount} in deck</span>
            </div>
          </div>
          <Panel style={{ padding: theme.spacing['2xl'] }}>
            <div style={{ fontSize: theme.typography.fontSize.xs, fontWeight: theme.typography.fontWeight.semibold, color: theme.colors.dark[400], textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: theme.spacing.md }}>Center pile</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', minHeight: 110, alignItems: 'center' }}>
              {game.centerPile.length === 0 && <span style={{ color: theme.colors.dark[500], fontSize: theme.typography.fontSize.sm }}>No cards played yet</span>}
              {game.centerPile.slice(-10).map((c) => <CardView key={c.cardId} card={c} />)}
            </div>
          </Panel>
          <Panel style={{ padding: theme.spacing['2xl'] }}>
            <div style={{ fontSize: theme.typography.fontSize.xs, fontWeight: theme.typography.fontWeight.semibold, color: theme.colors.dark[400], textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: theme.spacing.md }}>Your hand — click a card to play it</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {hand.length === 0 && <span style={{ color: theme.colors.dark[500], fontSize: theme.typography.fontSize.sm }}>No cards in hand</span>}
              {hand.map((c) => (
                <button key={c.cardId} aria-label={`Play ${c.rank} of ${c.suit}`} onClick={() => request(socket, 'playCard', { cardId: c.cardId }, (r: any) => { if (r?.error) notify(r.error); })} style={{ padding: 0, border: 'none', background: 'none', cursor: 'pointer', borderRadius: theme.borderRadius.lg }}>
                  <CardView card={c} />
                </button>
              ))}
            </div>
            <div style={{ marginTop: theme.spacing.lg }}>
              <Btn onClick={() => request(socket, 'drawCard', {}, (r: any) => { if (r?.error) notify(r.error); })} disabled={game.extraDeckCount <= 0}>Draw a card</Btn>
            </div>
          </Panel>
        </div>
      )}

      {/* Golf table */}
      {view === 'table' && game && isGolf && (
        <div className="view-enter" style={{ position: 'relative', zIndex: 1, maxWidth: 1000, margin: '0 auto' }}>
          <GolfTable key={`${game.gameId}:${game.matchNumber}`} game={game} playerId={playerId} myGolfSlots={myGolfSlots} socket={socket}
            pendingDraw={pendingDraw} setPendingDraw={setPendingDraw}
            selectedSlotId={selectedSlotId} setSelectedSlotId={setSelectedSlotId} />
        </div>
      )}

      {/* Cabo table */}
      {view === 'table' && game && isCabo && (
        <div className="view-enter" style={{ position: 'relative', zIndex: 1, maxWidth: 1000, margin: '0 auto' }}>
          <CaboTable key={`${game.gameId}:${game.matchNumber}`} restoredKing={privateState?.blackKing ?? null} game={game} playerId={playerId} mySlots={caboMySlots} socket={socket}
            pendingDraw={caboPendingDraw} setPendingDraw={setCaboPendingDraw}
            snapGap={caboSnapGap} setSnapGap={setCaboSnapGap} />
        </div>
      )}

      {/* Teen Patti table */}
      {view === 'table' && game && isTp && game.tp && (
        <div className="view-enter" style={{ position: 'relative', zIndex: 1, maxWidth: 1000, margin: '0 auto' }}>
          <TeenPattiTable key={`${game.gameId}:${game.matchNumber}`} game={game} playerId={playerId} priv={privateState} socket={socket} />
        </div>
      )}

      {/* Teen Patti hand result / end of game */}
      {game && isTp && game.tp && (phase === 'between-rounds' || phase === 'rematch-pending') && (
        <TpResultModal onRules={() => setShowRules(true)} game={game} playerId={playerId} priv={privateState} phase={phase} socket={socket}
          onAckNextRound={ackNextRound} onAckRematch={ackRematch} onLeave={() => setConfirmLeave(true)} />
      )}

      {/* Golf between-rounds / rematch modal */}
      {game && isGolf && (phase === 'between-rounds' || phase === 'rematch-pending') && (
        <RoundScoreModal onRules={() => setShowRules(true)} game={game} playerId={playerId} phase={phase}
          onAckNextRound={ackNextRound} onAckRematch={ackRematch}
          onLeave={() => setConfirmLeave(true)} onUpdateConfig={updateConfig} isHost={isHost} scoreDetails={privateState?.scoreDetails ?? []} />
      )}

      {/* Cabo between-rounds / rematch modal */}
      {game && isCabo && (phase === 'between-rounds' || phase === 'rematch-pending') && (
        <CaboScoreModal onRules={() => setShowRules(true)} game={game} playerId={playerId} phase={phase}
          myHand={privateState?.caboSlots ?? []} myHandTotal={privateState?.caboHandTotal ?? null}
          onAckNextRound={ackNextRound} onAckRematch={ackRematch} onLeave={() => setConfirmLeave(true)} />
      )}

      {/* Global leaderboard modal */}
      {showLeaderboard && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
          <Panel style={{ padding: theme.spacing['3xl'], maxWidth: 560, width: '90%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontFamily: theme.typography.fontFamilyDisplay, fontWeight: theme.typography.fontWeight.semibold, color: theme.colors.dark[50] }}>Leaderboard</h2>
              <Btn variant="ghost" size="sm" aria-label="Close leaderboard" onClick={() => setShowLeaderboard(false)}>✕</Btn>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: theme.typography.fontSize.sm, color: theme.colors.dark[200], fontVariantNumeric: 'tabular-nums' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${theme.colors.dark[600]}` }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px', color: theme.colors.dark[400] }}>#</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px', color: theme.colors.dark[400] }}>Player</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px', color: theme.colors.dark[400] }}>Total</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px', color: theme.colors.dark[400] }}>Games</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((e, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${theme.colors.dark[700]}` }}>
                    <td style={{ padding: '6px 8px' }}>{e.rank}</td>
                    <td style={{ padding: '6px 8px' }}>{e.displayName}</td>
                    <td style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 700 }}>{e.totalScore}</td>
                    <td style={{ textAlign: 'right', padding: '6px 8px', color: theme.colors.dark[400] }}>{e.gamesPlayed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {leaderboard.length === 0 && <p style={{ color: theme.colors.dark[400], textAlign: 'center' }}>No games played yet.</p>}
          </Panel>
        </div>
      )}
      {confirmLeave && <Modal title="Leave this room?" onClose={() => setConfirmLeave(false)}>
        <p style={{ lineHeight: 1.7 }}>{game?.status === 'active' ? 'You will forfeit this match and cannot rejoin it. If only one player remains, the room returns to the lobby.' : 'You can join another room or create a new game.'}</p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}><Btn variant="outline" onClick={() => setConfirmLeave(false)}>Stay in room</Btn><Btn variant="error" onClick={leaveGame}>Leave room</Btn></div>
      </Modal>}
      {showRules && <RulesGuide initialMode={game ? (isTp ? 'teenpatti' : isCabo ? 'cabo' : 'golf') : gameMode === 'classic' ? 'golf' : gameMode} onClose={() => setShowRules(false)} />}
    </div>
  );
}
