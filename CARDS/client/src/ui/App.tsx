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
    borderRadius: theme.borderRadius.lg, border: '1px solid transparent', outline: 'none',
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

function SlotView({ slot, selectable, selected, onSelect, cardSize = 'md' }: {
  slot: GolfSlotT; selectable: boolean; selected: boolean; onSelect: () => void; cardSize?: 'sm' | 'md';
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
    <div className={classes} onClick={() => selectable && onSelect()}
      style={{ cursor: selectable ? 'pointer' : 'default', border: `2px solid ${borderColor}`, borderRadius: theme.borderRadius.lg, padding: 2, transition: 'border-color 0.25s' }}>
      {showCard && slot.card ? <CardView card={slot.card} size={cardSize} /> : <CardBack size={cardSize} />}
    </div>
  );
}

// ---- Cabo Slot ----

function CaboSlotView({ card, selectable, selected, snapTarget, onSelect, cardSize = 'md', showFaceUp = false }: {
  card: CardT | null;
  selectable: boolean;
  selected: boolean;
  snapTarget: boolean;
  onSelect: () => void;
  cardSize?: 'sm' | 'md';
  showFaceUp?: boolean;
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
    <div className={classes} onClick={() => (selectable || snapTarget) && onSelect()}
      style={{
        cursor: (selectable || snapTarget) ? 'pointer' : 'default',
        border: `2px solid ${borderColor}`,
        borderRadius: theme.borderRadius.lg,
        padding: 2,
        transition: 'border-color 0.25s',
      }}>
      {showFaceUp && card ? <CardView card={card} size={cardSize} /> : <CardBack size={cardSize} />}
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
    const raf = (ts: number) => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(target * eased));
      if (p < 1) requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);
    return () => setVal(target);
  }, [target, duration]);
  return <>{val}</>;
}

// ---- Golf Round score modal ----

function RoundScoreModal({
  game, playerId, phase, onAckNextRound, onAckRematch, onLeave, onUpdateConfig, isHost,
}: {
  game: GameSnapshot; playerId: string | null; phase: GamePhase;
  onAckNextRound: () => void; onAckRematch: () => void; onLeave: () => void;
  onUpdateConfig: (cpp: number) => void; isHost: boolean;
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
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
        <Panel style={{ padding: theme.spacing['3xl'], maxWidth: 640, width: '95%', maxHeight: '90vh', overflowY: 'auto' }} className="fade-in">
          <h2 style={{ margin: '0 0 1rem', fontFamily: theme.typography.fontFamilyDisplay, fontWeight: theme.typography.fontWeight.semibold, color: theme.colors.dark[50], fontSize: theme.typography.fontSize['2xl'] }}>
            {isEnd ? 'Game over' : `Round ${game.currentRound} complete`}
          </h2>
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
          <div style={{ display: 'flex', gap: theme.spacing.md, justifyContent: 'flex-end' }}>
            {isEnd && <Btn variant="outline" onClick={onLeave}>Leave</Btn>}
            <Btn variant="success" onClick={isBetween ? onAckNextRound : onAckRematch} disabled={alreadyAcked}>
              {alreadyAcked ? 'Waiting…' : isEnd ? 'Play Again' : 'Ready'}
            </Btn>
          </div>
        </Panel>
      </div>
    </>
  );
}

// ---- Cabo Score Modal ----

function CaboScoreModal({
  game, playerId, phase, onAckNextRound, onAckRematch, onLeave,
}: {
  game: GameSnapshot; playerId: string | null; phase: GamePhase;
  onAckNextRound: () => void; onAckRematch: () => void; onLeave: () => void;
}) {
  const isBetween = phase === 'between-rounds';
  const isEnd = phase === 'rematch-pending';
  const acks = isBetween ? (game.betweenRoundAcks ?? []) : (game.rematchAcks ?? []);
  const alreadyAcked = playerId ? acks.includes(playerId) : false;
  const playerOrder = game.players;
  const roundCount = game.caboRoundScores ? Math.max(...game.caboRoundScores.map((r) => r.scores.length), 0) : 0;
  const winners = isEnd ? game.caboLeaderboard?.filter((e) => e.rank === 1) : [];

  return (
    <>
      {isEnd && <Confetti />}
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
        <Panel style={{ padding: theme.spacing['3xl'], maxWidth: 640, width: '95%', maxHeight: '90vh', overflowY: 'auto' }} className="fade-in">
          <h2 style={{ margin: '0 0 1rem', fontFamily: theme.typography.fontFamilyDisplay, fontWeight: theme.typography.fontWeight.semibold, color: theme.colors.dark[50], fontSize: theme.typography.fontSize['2xl'] }}>
            {isEnd ? 'Game over' : `Round ${game.currentRound} complete`}
          </h2>
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
          <div style={{ display: 'flex', gap: theme.spacing.md, justifyContent: 'flex-end' }}>
            {isEnd && <Btn variant="outline" onClick={onLeave}>Leave</Btn>}
            <Btn variant="success" onClick={isBetween ? onAckNextRound : onAckRematch} disabled={alreadyAcked}>
              {alreadyAcked ? 'Waiting…' : isEnd ? 'Play Again' : 'Ready'}
            </Btn>
          </div>
        </Panel>
      </div>
    </>
  );
}

// ---- Golf table ----

function GolfTable({ game, playerId, myGolfSlots, socket, pendingDraw, setPendingDraw, selectedSlotId, setSelectedSlotId }: {
  game: GameSnapshot; playerId: string | null;
  myGolfSlots: Array<{ slotId: string; card: CardT; revealed: boolean; locked: boolean; peekOnly?: boolean }> | null;
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
  const isMyTurn = game.golf?.turn === playerId;
  const perRow = Math.floor((game.config.cardsPerPlayer || 4) / 2);
  const peekActive = game.golf?.peekPhaseActive !== false;
  const emit = (event: string, payload: any, cb?: (r: any) => void) => socket?.emit(event, payload, cb);

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

      {peekActive && myGolfSlots?.some((s) => s.peekOnly) && (
        <Panel style={{ padding: theme.spacing['2xl'], background: `${theme.colors.warning[500]}22`, border: `1px solid ${theme.colors.warning[500]}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <p style={{ margin: 0, color: theme.colors.warning[500], fontWeight: 600 }}>Peek your bottom row — remember these cards!</p>
            <span style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.dark[400], whiteSpace: 'nowrap', marginLeft: 12 }}>
              {(game.golf?.peekAcks?.length ?? 0)}/{game.players.length} ready
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {myGolfSlots.map((s) => (
              <div key={s.slotId}>{s.peekOnly ? <CardView card={s.card} /> : <CardBack />}</div>
            ))}
          </div>
          <Btn disabled={peekAcked} onClick={() => { setPeekAcked(true); emit('golf:ackPeek', {}, (r: any) => { if (r?.error) { setPeekAcked(false); notify(r.error); } }); }}>
            {peekAcked ? 'Waiting for others…' : 'Got it — hide cards'}
          </Btn>
        </Panel>
      )}

      {!peekActive && (
        <div style={{ display: 'grid', gap: 20, maxHeight: isMobile ? 'none' : 'calc(100vh - 260px)', overflowY: isMobile ? 'visible' : 'auto', paddingRight: isMobile ? 0 : 4 }}>
          {game.golf?.hands.map((h) => {
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
              <div key={h.playerId} style={{ opacity: disconnected ? 0.7 : 1, padding: isTurn ? 12 : 0, borderRadius: isTurn ? theme.borderRadius.xl : 0, border: isTurn ? `2px solid ${isMe ? theme.colors.primary[500] : theme.colors.dark[500]}` : '2px solid transparent', boxShadow: isTurn && isMe ? theme.shadows.glow : 'none', transition: 'all 0.3s ease-in-out' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontWeight: 600, color: isMe ? theme.colors.primary[400] : theme.colors.dark[200] }}>{player?.displayName}{isMe ? ' (you)' : ''}</span>
                  {isTurn && !disconnected && <span style={{ fontSize: theme.typography.fontSize.xs, fontWeight: theme.typography.fontWeight.bold, background: theme.colors.primary[500], color: '#1d1607', padding: '2px 10px', borderRadius: 999 }}>Turn</span>}
                  {isTurn && disconnected && <span style={{ fontSize: theme.typography.fontSize.xs, fontWeight: theme.typography.fontWeight.semibold, background: theme.colors.warning[600], color: '#f5f4ec', padding: '2px 10px', borderRadius: 999 }}>Waiting…</span>}
                  {disconnected && <span style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.dark[500] }}><span style={{ display: 'inline-block', width: 10, height: 10, border: `2px solid ${theme.colors.dark[500]}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite', marginRight: 4 }} />disconnected</span>}
                  {running !== undefined && <span style={{ fontSize: theme.typography.fontSize.xs, padding: '2px 8px', background: theme.colors.dark[700], border: `1px solid ${theme.colors.dark[600]}`, borderRadius: theme.borderRadius.lg, color: theme.colors.dark[300] }}>{running} pts</span>}
                  {isHost && !isMe && disconnected && !graceElapsed && <span style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.dark[500] }}>kick in {kickSecondsLeft}s</span>}
                  {isHost && !isMe && disconnected && graceElapsed && <Btn size="sm" variant="error" onClick={() => emit('golf:kickPlayer', { playerId: h.playerId }, (r: any) => { if (r?.error) notify(r.error); })}>Kick</Btn>}
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${perRow}, auto)`, gap: cardGap, width: 'fit-content' }}>
                    {h.slots.slice(0, perRow).map((s) => <SlotView key={s.slotId} slot={s} selectable={!!(isMe && isMyTurn && !s.locked)} selected={selectedSlotId === s.slotId} onSelect={() => setSelectedSlotId(s.slotId)} cardSize={cardSize} />)}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${perRow}, auto)`, gap: cardGap, marginTop: cardGap, width: 'fit-content' }}>
                    {h.slots.slice(perRow).map((s) => <SlotView key={s.slotId} slot={s} selectable={!!(isMe && isMyTurn && !s.locked)} selected={selectedSlotId === s.slotId} onSelect={() => setSelectedSlotId(s.slotId)} cardSize={cardSize} />)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {isMyTurn && !peekActive && (
        <Panel style={{ padding: theme.spacing['2xl'] }}>
          <div style={{ fontWeight: 600, color: theme.colors.primary[400], marginBottom: 12 }}>Your turn</div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            {!pendingDraw && (
              <>
                <Btn onClick={() => { if (!selectedSlotId) return notify('Select a slot first'); emit('golf:swapWithDiscard', { slotId: selectedSlotId }, (r: any) => { if (r?.error) return notify(r.error); setSelectedSlotId(null); }); }} disabled={!game.discardTop}>Swap with discard</Btn>
                <Btn variant="outline" disabled={game.extraDeckCount === 0 && !game.discardTop} onClick={() => { setDeckShaking(true); setTimeout(() => setDeckShaking(false), 500); emit('golf:draw', {}, (r: any) => { if (r?.error) return notify(r.error); setPendingDraw(r.card); }); }}>Draw from deck</Btn>
              </>
            )}
            {pendingDraw && (
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ color: theme.colors.dark[300] }}>Drawn:</span>
                <CardView card={pendingDraw} />
                <Btn variant="success" onClick={() => { if (!selectedSlotId) return notify('Select a slot to swap'); emit('golf:acceptDrawAndSwap', { slotId: selectedSlotId }, (r: any) => { if (r?.error) return notify(r.error); setPendingDraw(null); setSelectedSlotId(null); }); }}>Accept & swap</Btn>
                <Btn variant="warning" onClick={() => { if (!selectedSlotId) return notify('Select a slot to reveal'); emit('golf:rejectDrawAndReveal', { slotId: selectedSlotId }, (r: any) => { if (r?.error) return notify(r.error); setPendingDraw(null); setSelectedSlotId(null); }); }}>Reject & reveal</Btn>
              </div>
            )}
          </div>
          {!selectedSlotId && <p style={{ margin: '8px 0 0', fontSize: theme.typography.fontSize.sm, color: theme.colors.dark[500] }}>Click one of your face-down cards to select a slot</p>}
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

function CaboTable({ game, playerId, mySlots, socket, pendingDraw, setPendingDraw, snapGap, setSnapGap }: {
  game: GameSnapshot;
  playerId: string | null;
  mySlots: CaboSlotPrivate[] | null;
  socket: Socket | null;
  pendingDraw: CardT | null;
  setPendingDraw: (c: CardT | null) => void;
  snapGap: { opponentId: string } | null;
  setSnapGap: (v: { opponentId: string } | null) => void;
}) {
  const [peekAcked, setPeekAcked] = useState(false);
  const [snapMode, setSnapMode] = useState(false);
  const [specialMode, setSpecialMode] = useState<CaboSpecialMode>('none');
  const [selectedOwnSlot, setSelectedOwnSlot] = useState<string | null>(null);
  const [selectedOpponentSlot, setSelectedOpponentSlot] = useState<{ playerId: string; slotId: string } | null>(null);
  const [blackKingSeen, setBlackKingSeen] = useState<{ targetPlayerId: string; slotId: string; card: CardT } | null>(null);
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
  const isMyTurn = cabo?.turn === playerId;
  const peekActive = cabo?.peekPhaseActive ?? false;
  const caboCallerId = cabo?.caboCallerId ?? null;
  const caboFinalTurnsLeft = cabo?.caboFinalTurnsLeft ?? 0;
  const phase = game.phase;

  const hasPendingDraw = !!pendingDraw;
  const hasBlackKingPending = cabo?.blackKingPlayers?.includes(playerId ?? '') ?? false;

  const emit = (event: string, payload: any, cb?: (r: any) => void) => socket?.emit(event, payload, cb);

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
      {peekActive && mySlots && (
        <Panel style={{ padding: theme.spacing['2xl'], background: `${theme.colors.warning[500]}22`, border: `1px solid ${theme.colors.warning[500]}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <p style={{ margin: 0, color: theme.colors.warning[500], fontWeight: 600 }}>Peek your bottom 2 cards — remember them!</p>
            <span style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.dark[400], whiteSpace: 'nowrap', marginLeft: 12 }}>
              {(cabo?.peekAcks?.length ?? 0)}/{game.players.length} ready
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {mySlots.map((s, idx) => (
              <div key={s.slotId}>{idx >= 2 ? <CardView card={s.card} /> : <CardBack />}</div>
            ))}
          </div>
          <Btn disabled={peekAcked} onClick={() => { setPeekAcked(true); emit('cabo:ackPeek', {}, (r: any) => { if (r?.error) { setPeekAcked(false); notify(r.error); } }); }}>
            {peekAcked ? 'Waiting for others…' : 'Got it — hide cards'}
          </Btn>
        </Panel>
      )}

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
        <div style={{ display: 'grid', gap: 20, maxHeight: isMobile ? 'none' : 'calc(100vh - 320px)', overflowY: isMobile ? 'visible' : 'auto', paddingRight: isMobile ? 0 : 4 }}>
          {cabo?.hands.map((h) => {
            const player = game.players.find((p) => p.playerId === h.playerId);
            const isMe = h.playerId === playerId;
            const isTurn = h.playerId === cabo.turn;
            const cumulative = game.caboCumulativeScores?.[h.playerId];
            const disconnected = player && !player.connected;
            const hasPendingDrawIndicator = cabo.pendingDrawPlayers?.includes(h.playerId);
            const hasBlackKingIndicator = cabo.blackKingPlayers?.includes(h.playerId);
            const disconnectedAt = player?.disconnectedAt;
            const graceElapsed = disconnectedAt && Date.now() - disconnectedAt >= 30_000;
            const kickSecondsLeft = disconnectedAt && !graceElapsed ? Math.max(0, 30 - Math.floor((Date.now() - disconnectedAt) / 1000)) : 0;
            const isHost = playerId === game.hostId;

            // my slots from private event

            const perRow = 2;
            const totalSlots = h.slots.length;
            const row1Count = Math.min(perRow, totalSlots);
            const row2Count = Math.max(0, totalSlots - perRow);

            return (
              <div key={h.playerId} style={{
                opacity: disconnected ? 0.7 : 1,
                padding: isTurn ? 12 : 0,
                borderRadius: isTurn ? theme.borderRadius.xl : 0,
                border: isTurn ? `2px solid ${isMe ? theme.colors.primary[500] : theme.colors.dark[500]}` : '2px solid transparent',
                boxShadow: isTurn && isMe ? theme.shadows.glow : 'none',
                transition: 'all 0.3s ease-in-out',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontWeight: 600, color: isMe ? theme.colors.primary[400] : theme.colors.dark[200] }}>
                    {player?.displayName}{isMe ? ' (you)' : ''}
                  </span>
                  {isTurn && !disconnected && <span style={{ fontSize: theme.typography.fontSize.xs, fontWeight: theme.typography.fontWeight.bold, background: theme.colors.primary[500], color: '#1d1607', padding: '2px 10px', borderRadius: 999 }}>Turn</span>}
                  {isTurn && disconnected && <span style={{ fontSize: theme.typography.fontSize.xs, fontWeight: theme.typography.fontWeight.semibold, background: theme.colors.warning[600], color: '#f5f4ec', padding: '2px 10px', borderRadius: 999 }}>Waiting…</span>}
                  {disconnected && <span style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.dark[500] }}><span style={{ display: 'inline-block', width: 10, height: 10, border: `2px solid ${theme.colors.dark[500]}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite', marginRight: 4 }} />disconnected</span>}
                  {cumulative !== undefined && <span style={{ fontSize: theme.typography.fontSize.xs, padding: '2px 8px', background: theme.colors.dark[700], border: `1px solid ${theme.colors.dark[600]}`, borderRadius: theme.borderRadius.lg, color: theme.colors.dark[300] }}>{cumulative} pts</span>}
                  {hasPendingDrawIndicator && !isMe && <span style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.primary[400] }}>deciding…</span>}
                  {hasBlackKingIndicator && !isMe && <span style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.secondary[400] }}>black king…</span>}
                  {h.playerId === caboCallerId && <span style={{ fontSize: theme.typography.fontSize.xs, background: `${theme.colors.warning[600]}44`, color: theme.colors.warning[400], padding: '2px 8px', borderRadius: theme.borderRadius.lg, border: `1px solid ${theme.colors.warning[600]}` }}>Called Cabo</span>}
                  {isHost && !isMe && disconnected && !graceElapsed && <span style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.dark[500] }}>kick in {kickSecondsLeft}s</span>}
                  {isHost && !isMe && disconnected && graceElapsed && <Btn size="sm" variant="error" onClick={() => emit('cabo:kickPlayer', { playerId: h.playerId }, (r: any) => { if (r?.error) notify(r.error); })}>Kick</Btn>}
                </div>

                {/* card grid (variable width) */}
                <div style={{ overflowX: 'auto' }}>
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
                              specialMode === 'peek-own' ||
                              specialMode === 'blind-swap-own' ||
                              (specialMode === 'black-king-decide' && blackKingSeen !== null) ||
                              (snapGap !== null && snapSlideSlot === null)
                            );
                            const isSlideTarget = !!(snapGap && snapSlideSlot === null);
                            return (
                              <CaboSlotView key={s.slotId}
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
                              />
                            );
                          } else {
                            const isOpponentSelectable = (
                              specialMode === 'spy' ||
                              specialMode === 'blind-swap-opponent' ||
                              specialMode === 'black-king-see'
                            );
                            return (
                              <CaboSlotView key={s.slotId}
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
        <Panel style={{ padding: theme.spacing['2xl'] }}>
          <div style={{ fontWeight: 600, color: theme.colors.primary[400], marginBottom: 12 }}>
            {phase === 'cabo-called' ? 'Your final turn' : 'Your turn'}
          </div>

          {!hasPendingDraw && !hasBlackKingPending && (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <Btn disabled={game.extraDeckCount === 0 && !game.discardTop} onClick={() => {
                setDeckShaking(true);
                setTimeout(() => setDeckShaking(false), 500);
                emit('cabo:draw', {}, (r: any) => {
                  if (r?.error) return notify(r.error);
                  setPendingDraw(r.card);
                });
              }}>Draw from deck</Btn>
              <Btn variant="outline" disabled={!game.discardTop} onClick={() => {
                const slots = mySlots;
                if (!slots || slots.length === 0) return notify('No slots to swap into');
                const slotId = selectedOwnSlot ?? slots[0].slotId;
                emit('cabo:takeDiscard', { slotId }, (r: any) => {
                  if (r?.error) return notify(r.error);
                  setSelectedOwnSlot(null);
                });
              }}>
                {selectedOwnSlot ? 'Take discard → selected slot' : 'Take discard (select slot first)'}
              </Btn>
              {phase === 'play' && (
                <Btn variant="warning" onClick={() => {
                  if (!window.confirm('Call Cabo? All other players get one more turn.')) return;
                  emit('cabo:callCabo', {}, (r: any) => { if (r?.error) notify(r.error); });
                }}>Call Cabo</Btn>
              )}
            </div>
          )}

          {hasPendingDraw && pendingDraw && !hasBlackKingPending && (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ color: theme.colors.dark[300] }}>Drawn:</span>
              <CardView card={pendingDraw} />
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
            <p style={{ margin: '8px 0 0', fontSize: theme.typography.fontSize.sm, color: theme.colors.dark[500] }}>
              Click one of your cards to select a slot (for Take Discard)
            </p>
          )}
        </Panel>
      )}
    </div>
  );
}

// ---- Main App ----

export function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [view, setView] = useState<'landing' | 'create' | 'join' | 'lobby' | 'table'>('landing');
  const [displayName, setDisplayName] = useState('');
  const [code, setCode] = useState('');
  const [game, setGame] = useState<GameSnapshot | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [playerToken, setPlayerToken] = useState<string | null>(null);
  const [hand, setHand] = useState<CardT[]>([]);
  const [cardsPerPlayer, setCardsPerPlayer] = useState(4);
  const [gameMode, setGameMode] = useState<'classic' | 'golf' | 'cabo'>('golf');
  const [myGolfSlots, setMyGolfSlots] = useState<Array<{ slotId: string; card: CardT; revealed: boolean; locked: boolean; peekOnly?: boolean }> | null>(null);
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

  const serverUrl = useMemo(() => ((import.meta as any).env?.VITE_SERVER_URL as string) || 'http://localhost:3001', []);

  function persistSession(pid: string, tok: string, gameCode: string) {
    localStorage.setItem('golf_playerId', pid);
    localStorage.setItem('golf_playerToken', tok);
    localStorage.setItem('golf_code', gameCode);
  }
  function clearSession() {
    localStorage.removeItem('golf_playerId');
    localStorage.removeItem('golf_playerToken');
    localStorage.removeItem('golf_code');
  }

  useEffect(() => {
    const s = io(serverUrl);
    setSocket(s);

    s.on('game:update', (snapshot: GameSnapshot) => {
      setGame(snapshot);
      if (snapshot.phase === 'peek' || snapshot.phase === 'play' || snapshot.phase === 'cabo-called') {
        setView((v) => (v === 'lobby' ? 'table' : v));
      }
    });
    s.on('hand:update', (cards: CardT[]) => setHand(cards));
    s.on('golf:hand', (slots: any) => setMyGolfSlots(slots));
    s.on('golf:pendingDraw', (card: CardT) => setPendingDraw(card));
    s.on('cabo:hand', (slots: CaboSlotPrivate[]) => setCaboMySlots(slots));
    s.on('cabo:pendingDraw', (card: CardT) => setCaboPendingDraw(card));

    s.on('connect', () => {
      const tok = localStorage.getItem('golf_playerToken');
      const savedCode = localStorage.getItem('golf_code');
      if (tok && savedCode) {
        s.emit('rejoinGame', { playerToken: tok }, (res: any) => {
          if (res?.error) {
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
          setView('table');
        });
      }
    });

    return () => { s.close(); };
  }, [serverUrl]);

  const phase = game?.phase;
  const isGolf = game?.config.gameMode === 'golf';
  const isCabo = game?.config.gameMode === 'cabo';
  const isHost = playerId === game?.hostId;

  function createGame() {
    if (!socket) return;
    const config = {
      maxPlayers: 8,
      totalCardsPerDeck: 52,
      numberOfDecks: 1,
      cardsPerPlayer: gameMode === 'cabo' ? 4 : cardsPerPlayer,
      gameMode,
    };
    socket.emit('createGame', { displayName, config }, (res: any) => {
      if (res?.error) return notify(res.error);
      setPlayerId(res.playerId);
      setPlayerToken(res.playerToken);
      setCode(res.code);
      persistSession(res.playerId, res.playerToken, res.code);
      setView('lobby');
    });
  }

  function joinGame() {
    if (!socket) return;
    socket.emit('joinGame', { code: code.trim(), displayName }, (res: any) => {
      if (res?.error) return notify(res.error);
      setPlayerId(res.playerId);
      setPlayerToken(res.playerToken);
      setCode(res.code);
      persistSession(res.playerId, res.playerToken, res.code);
      setView('lobby');
    });
  }

  function startGame() {
    socket?.emit('startGame', {}, (res: any) => {
      if (res?.error) return notify(res.error);
      setView('table');
    });
  }

  function fetchLeaderboard() {
    socket?.emit('getLeaderboard', {}, (res: any) => {
      if (res?.leaderboard) { setLeaderboard(res.leaderboard); setShowLeaderboard(true); }
    });
  }

  function ackNextRound() {
    const event = isCabo ? 'cabo:ackNextRound' : 'golf:ackNextRound';
    socket?.emit(event, {}, (res: any) => { if (res?.error) notify(res.error); });
  }

  function ackRematch() {
    const event = isCabo ? 'cabo:ackRematch' : 'golf:ackRematch';
    socket?.emit(event, {}, (res: any) => { if (res?.error) notify(res.error); });
  }

  function leaveGame() {
    const event = isCabo ? 'cabo:leaveGame' : 'golf:leaveGame';
    socket?.emit(event, {}, (res: any) => {
      if (res?.error) return notify(res.error);
      clearSession();
      setGame(null); setPlayerId(null); setPlayerToken(null); setCode('');
      setMyGolfSlots(null); setPendingDraw(null); setSelectedSlotId(null);
      setCaboMySlots(null); setCaboPendingDraw(null); setCaboSnapGap(null);
      setView('landing');
    });
  }

  function updateConfig(cpp: number) {
    socket?.emit('golf:updateConfig', { cardsPerPlayer: cpp }, (res: any) => { if (res?.error) notify(res.error); });
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: theme.spacing.lg,
    background: theme.colors.dark[900], border: `1px solid ${theme.colors.dark[600]}`,
    borderRadius: theme.borderRadius.lg, color: theme.colors.dark[100],
    fontSize: theme.typography.fontSize.base, fontFamily: theme.typography.fontFamily,
    outline: 'none', transition: 'border-color 0.15s ease, box-shadow 0.15s ease', boxSizing: 'border-box',
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

      {/* Landing */}
      {view === 'landing' && (
        <div className="view-enter" style={{ maxWidth: 400, margin: '0 auto', paddingTop: theme.spacing['5xl'], position: 'relative', zIndex: 1 }}>
          <div style={{ textAlign: 'center', marginBottom: theme.spacing['4xl'] }}>
            <div aria-hidden="true" style={{ color: theme.colors.primary[500], fontSize: theme.typography.fontSize.lg, letterSpacing: '0.5em', marginBottom: theme.spacing.md, paddingLeft: '0.5em' }}>♠ ♥ ♦ ♣</div>
            <h1 style={{ fontFamily: theme.typography.fontFamilyDisplay, fontSize: theme.typography.fontSize['4xl'], fontWeight: theme.typography.fontWeight.semibold, color: theme.colors.dark[50], margin: `0 0 ${theme.spacing.md}`, letterSpacing: '-0.01em', lineHeight: theme.typography.lineHeight.tight }}>Card Games</h1>
            <p style={{ color: theme.colors.dark[400], fontSize: theme.typography.fontSize.base, margin: 0 }}>Golf · Cabo · Classic — play with friends</p>
          </div>
          <Panel style={{ padding: theme.spacing['3xl'], marginBottom: theme.spacing['2xl'] }}>
            <div style={{ marginBottom: theme.spacing['2xl'] }}>
              <label style={labelStyle}>Display Name</label>
              <input placeholder="Enter your name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} style={inputStyle}
                onFocus={(e) => { e.target.style.borderColor = theme.colors.primary[500]; e.target.style.boxShadow = theme.shadows.glow; }}
                onBlur={(e) => { e.target.style.borderColor = theme.colors.dark[600]; e.target.style.boxShadow = 'none'; }} />
            </div>
            <div style={{ display: 'grid', gap: theme.spacing.lg }}>
              <Btn size="lg" onClick={() => setView('create')}>Create Game</Btn>
              <Btn variant="outline" size="lg" onClick={() => setView('join')}>Join Game</Btn>
              <Btn variant="ghost" size="lg" onClick={fetchLeaderboard}>View Leaderboard</Btn>
            </div>
          </Panel>
        </div>
      )}

      {/* Create */}
      {view === 'create' && (
        <div className="view-enter" style={{ maxWidth: 500, margin: '0 auto', paddingTop: theme.spacing['3xl'], position: 'relative', zIndex: 1 }}>
          <div style={{ marginBottom: theme.spacing['3xl'], textAlign: 'center' }}>
            <h2 style={{ fontFamily: theme.typography.fontFamilyDisplay, fontSize: theme.typography.fontSize['3xl'], fontWeight: theme.typography.fontWeight.semibold, color: theme.colors.dark[50], margin: 0 }}>Create a game</h2>
          </div>
          <Panel style={{ padding: theme.spacing['3xl'] }}>
            <div style={{ display: 'grid', gap: theme.spacing['2xl'] }}>
              <div>
                <label style={labelStyle}>Game Mode</label>
                <select value={gameMode} onChange={(e) => {
                  const m = e.target.value as 'classic' | 'golf' | 'cabo';
                  setGameMode(m);
                  if (m === 'golf' && ![4,6,8].includes(cardsPerPlayer)) setCardsPerPlayer(4);
                }} style={{ ...inputStyle, cursor: 'pointer' }}>
                  <option value="golf">Golf</option>
                  <option value="cabo">Cabo</option>
                  {/* classic hidden: half-finished (no turns, no game end) — GAPS.md #1.
                      Server handlers + table view kept for rejoin safety. */}
                </select>
              </div>
              {gameMode !== 'cabo' && (
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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: theme.spacing.lg, marginTop: theme.spacing.lg }}>
                <Btn variant="outline" onClick={() => setView('landing')}>Back</Btn>
                <Btn onClick={createGame} size="lg" disabled={!displayName.trim()}>Create Game</Btn>
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
            <div style={{ marginBottom: theme.spacing['2xl'] }}>
              <label style={labelStyle}>Game Code</label>
              <input placeholder="4-digit code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={4}
                style={{ ...inputStyle, fontSize: theme.typography.fontSize.xl, fontFamily: 'monospace', textAlign: 'center', letterSpacing: '0.2em' }}
                onFocus={(e) => { e.target.style.borderColor = theme.colors.primary[500]; e.target.style.boxShadow = theme.shadows.glow; }}
                onBlur={(e) => { e.target.style.borderColor = theme.colors.dark[600]; e.target.style.boxShadow = 'none'; }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: theme.spacing.lg }}>
              <Btn variant="outline" onClick={() => setView('landing')}>Back</Btn>
              <Btn onClick={joinGame} size="lg" disabled={code.length !== 4 || !displayName.trim()}>Join Game</Btn>
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
            <Btn variant="outline" size="sm" onClick={() => {
              navigator.clipboard?.writeText(game.code).then(() => notify('Code copied'));
            }}>Copy code</Btn>
            <div style={{ marginTop: theme.spacing.lg, fontSize: theme.typography.fontSize.sm, color: theme.colors.dark[400] }}>
              {game.config.gameMode === 'golf' ? `Golf · ${game.config.cardsPerPlayer} cards per player` : game.config.gameMode === 'cabo' ? 'Cabo · 4 cards · first past 100 loses' : 'Classic'}
            </div>
          </Panel>
          <Panel style={{ padding: theme.spacing['2xl'] }}>
            <div style={{ fontSize: theme.typography.fontSize.xs, fontWeight: theme.typography.fontWeight.semibold, color: theme.colors.dark[400], textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: theme.spacing.md }}>Players ({game.players.length}/{game.config.maxPlayers})</div>
            <div style={{ display: 'grid', gap: theme.spacing.sm }}>
              {game.players.map((p) => (
                <div key={p.playerId} style={{ display: 'flex', alignItems: 'center', gap: theme.spacing.md, padding: `${theme.spacing.sm} ${theme.spacing.md}`, background: theme.colors.dark[900], border: `1px solid ${theme.colors.dark[700]}`, borderRadius: theme.borderRadius.lg }}>
                  <span aria-hidden="true" style={{ width: 30, height: 30, borderRadius: '50%', background: p.playerId === playerId ? theme.colors.primary[500] : theme.colors.dark[600], color: p.playerId === playerId ? '#1d1607' : theme.colors.dark[100], display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: theme.typography.fontSize.sm, fontWeight: theme.typography.fontWeight.bold, flexShrink: 0 }}>
                    {(p.displayName || '?').trim().charAt(0).toUpperCase()}
                  </span>
                  <span style={{ color: p.playerId === playerId ? theme.colors.primary[300] : theme.colors.dark[100], fontWeight: theme.typography.fontWeight.medium, flex: 1, textAlign: 'left' }}>
                    {p.displayName}{p.playerId === playerId ? ' (you)' : ''}
                  </span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {p.playerId === game.hostId && <span style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.primary[400], border: `1px solid ${theme.colors.primary[700]}`, borderRadius: 999, padding: '2px 10px' }}>Host</span>}
                    {!p.connected && <span style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.dark[500] }}>disconnected</span>}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: theme.spacing.lg, marginTop: theme.spacing['2xl'] }}>
              {isHost && <Btn onClick={startGame} disabled={(game.players?.length || 0) < 2} style={{ flex: 1 }}>Start game</Btn>}
              <Btn variant="outline" onClick={() => setView('table')} style={isHost ? {} : { flex: 1 }}>Go to table</Btn>
            </div>
            {isHost && (game.players?.length || 0) < 2 && (
              <p style={{ margin: `${theme.spacing.md} 0 0`, fontSize: theme.typography.fontSize.sm, color: theme.colors.dark[500], textAlign: 'center' }}>You need at least 2 players to start</p>
            )}
          </Panel>
        </div>
      )}

      {/* Classic table */}
      {view === 'table' && game && !isGolf && !isCabo && (
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
                <button key={c.cardId} aria-label={`Play ${c.rank} of ${c.suit}`} onClick={() => socket?.emit('playCard', { cardId: c.cardId }, (r: any) => { if (r?.error) notify(r.error); })} style={{ padding: 0, border: 'none', background: 'none', cursor: 'pointer', borderRadius: theme.borderRadius.lg }}>
                  <CardView card={c} />
                </button>
              ))}
            </div>
            <div style={{ marginTop: theme.spacing.lg }}>
              <Btn onClick={() => socket?.emit('drawCard', {}, (r: any) => { if (r?.error) notify(r.error); })} disabled={game.extraDeckCount <= 0}>Draw a card</Btn>
            </div>
          </Panel>
        </div>
      )}

      {/* Golf table */}
      {view === 'table' && game && isGolf && (
        <div className="view-enter" style={{ position: 'relative', zIndex: 1 }}>
          <GolfTable game={game} playerId={playerId} myGolfSlots={myGolfSlots} socket={socket}
            pendingDraw={pendingDraw} setPendingDraw={setPendingDraw}
            selectedSlotId={selectedSlotId} setSelectedSlotId={setSelectedSlotId} />
        </div>
      )}

      {/* Cabo table */}
      {view === 'table' && game && isCabo && (
        <div className="view-enter" style={{ position: 'relative', zIndex: 1 }}>
          <CaboTable game={game} playerId={playerId} mySlots={caboMySlots} socket={socket}
            pendingDraw={caboPendingDraw} setPendingDraw={setCaboPendingDraw}
            snapGap={caboSnapGap} setSnapGap={setCaboSnapGap} />
        </div>
      )}

      {/* Golf between-rounds / rematch modal */}
      {game && isGolf && (phase === 'between-rounds' || phase === 'rematch-pending') && (
        <RoundScoreModal game={game} playerId={playerId} phase={phase}
          onAckNextRound={ackNextRound} onAckRematch={ackRematch}
          onLeave={leaveGame} onUpdateConfig={updateConfig} isHost={isHost} />
      )}

      {/* Cabo between-rounds / rematch modal */}
      {game && isCabo && (phase === 'between-rounds' || phase === 'rematch-pending') && (
        <CaboScoreModal game={game} playerId={playerId} phase={phase}
          onAckNextRound={ackNextRound} onAckRematch={ackRematch} onLeave={leaveGame} />
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
    </div>
  );
}
