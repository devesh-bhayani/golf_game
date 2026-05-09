import React, { useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

const globalStyles = `
  @keyframes float {
    0%, 100% { transform: translate(-50%, -50%) rotate(0deg); }
    33% { transform: translate(-48%, -52%) rotate(1deg); }
    66% { transform: translate(-52%, -48%) rotate(-1deg); }
  }
  @keyframes cardHover {
    0% { transform: translateY(0) scale(1); }
    100% { transform: translateY(-4px) scale(1.05); }
  }
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes slideIn {
    from { opacity: 0; transform: translateX(-20px); }
    to { opacity: 1; transform: translateX(0); }
  }
  @keyframes glow {
    0%, 100% { box-shadow: 0 0 5px rgba(14, 165, 233, 0.3); }
    50% { box-shadow: 0 0 20px rgba(14, 165, 233, 0.6); }
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
    0%, 100% { box-shadow: 0 0 0 0 rgba(14, 165, 233, 0.55); }
    50%       { box-shadow: 0 0 0 7px rgba(14, 165, 233, 0); }
  }
  @keyframes snapPulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); }
    50%       { box-shadow: 0 0 0 8px rgba(239, 68, 68, 0); }
  }
  @keyframes floatUpDrift {
    0%   { transform: translateY(110vh) rotate(0deg);   opacity: 0; }
    8%   { opacity: 1; }
    92%  { opacity: 1; }
    100% { transform: translateY(-15vh) rotate(200deg); opacity: 0; }
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
    from { opacity: 0; transform: translateY(16px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .card-hover:hover { animation: cardHover 0.3s ease-in-out forwards; }
  .fade-in   { animation: fadeIn   0.6s ease-out; }
  .slide-in  { animation: slideIn  0.4s ease-out; }
  .view-enter { animation: viewEnter 0.35s ease-out; }
  .glow      { animation: glow     2s ease-in-out infinite; }
  .slot-pulse { animation: slotPulse 1.4s ease-in-out infinite; }
  .snap-pulse { animation: snapPulse 0.9s ease-in-out infinite; }
  .slot-flip  { animation: flipReveal 0.5s ease-in-out; }
  .deck-shake { animation: deckShake 0.45s ease-in-out; }
`;

if (typeof document !== 'undefined') {
  const s = document.createElement('style');
  s.textContent = globalStyles;
  document.head.appendChild(s);
}

const theme = {
  colors: {
    primary: { 50: '#f0f9ff', 100: '#e0f2fe', 500: '#0ea5e9', 600: '#0284c7', 700: '#0369a1', 900: '#0c4a6e' },
    secondary: { 500: '#8b5cf6', 600: '#7c3aed', 700: '#6d28d9' },
    success: { 500: '#10b981', 600: '#059669', 700: '#047857' },
    warning: { 500: '#f59e0b', 600: '#d97706' },
    error: { 500: '#ef4444', 600: '#dc2626' },
    dark: {
      50: '#f8fafc', 100: '#f1f5f9', 200: '#e2e8f0', 300: '#cbd5e1',
      400: '#94a3b8', 500: '#64748b', 600: '#475569', 700: '#334155',
      800: '#1e293b', 900: '#0f172a', 950: '#020617',
    },
  },
  spacing: { xs: '0.25rem', sm: '0.5rem', md: '0.75rem', lg: '1rem', xl: '1.25rem', '2xl': '1.5rem', '3xl': '2rem', '4xl': '2.5rem', '5xl': '3rem' },
  borderRadius: { sm: '0.25rem', md: '0.375rem', lg: '0.5rem', xl: '0.75rem', '2xl': '1rem', '3xl': '1.5rem' },
  shadows: {
    sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
    md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
    lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
    xl: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
    glow: '0 0 20px rgb(14 165 233 / 0.3)',
  },
  typography: {
    fontFamily: '"Inter", "Segoe UI", system-ui, sans-serif',
    fontSize: { xs: '0.75rem', sm: '0.875rem', base: '1rem', lg: '1.125rem', xl: '1.25rem', '2xl': '1.5rem', '3xl': '1.875rem', '4xl': '2.25rem' },
    fontWeight: { normal: '400', medium: '500', semibold: '600', bold: '700' },
    lineHeight: { tight: '1.25', normal: '1.5', relaxed: '1.75' },
  },
};

type GamePhase = 'waiting' | 'peek' | 'play' | 'cabo-called' | 'between-rounds' | 'ended' | 'rematch-pending';

type CardT = {
  cardId: string;
  suit: 'spades' | 'hearts' | 'diamonds' | 'clubs';
  rank: 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';
  color: 'red' | 'black';
  value: number;
};

type GolfSlotT = { slotId: string; revealed: boolean; locked: boolean; card: CardT | null };
type CaboSlotPrivate = { slotId: string; card: CardT };

type GameSnapshot = {
  gameId: string;
  code: string;
  hostId: string;
  status: 'waiting' | 'active' | 'ended';
  phase: GamePhase;
  config: { maxPlayers: number; totalCardsPerDeck: number; numberOfDecks: number; cardsPerPlayer: number; gameMode?: 'classic' | 'golf' | 'cabo' };
  players: { playerId: string; displayName: string; connected: boolean; disconnectedAt?: number }[];
  centerPile: CardT[];
  extraDeckCount: number;
  currentRound: number;
  targetRounds: number;
  discardTop?: CardT | null;
  golf?: {
    hands: { playerId: string; slots: GolfSlotT[] }[];
    turn: string | null;
    round: number;
    peekPhaseActive?: boolean;
    peekAcks?: string[];
  };
  roundScores?: { playerId: string; scores: number[] }[];
  runningTotals?: Record<string, number>;
  betweenRoundAcks?: string[];
  rematchAcks?: string[];
  leaderboard?: Array<{ rank: number; displayName: string; score: number; playerId: string }>;
  cabo?: {
    hands: { playerId: string; slots: { slotId: string }[] }[];
    turn: string | null;
    round: number;
    peekPhaseActive: boolean;
    peekAcks: string[];
    caboCallerId: string | null;
    caboFinalTurnsLeft: number;
    pendingDrawPlayers: string[];
    blackKingPlayers: string[];
  };
  caboRoundScores?: { playerId: string; scores: number[] }[];
  caboCumulativeScores?: Record<string, number>;
  caboLeaderboard?: Array<{ rank: number; displayName: string; score: number; playerId: string }>;
};

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
    fontFamily: theme.typography.fontFamily, fontWeight: theme.typography.fontWeight.medium,
    borderRadius: theme.borderRadius.lg, border: 'none', outline: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
    transition: 'all 0.18s ease-out', pointerEvents: disabled ? 'none' : 'auto',
    transform: hovered && !disabled ? 'translateY(-2px) scale(1.03)' : 'translateY(0) scale(1)',
    filter: hovered && !disabled ? 'brightness(1.15)' : 'none',
  };
  const sizes = {
    sm: { padding: `${theme.spacing.sm} ${theme.spacing.md}`, fontSize: theme.typography.fontSize.sm },
    md: { padding: `${theme.spacing.md} ${theme.spacing.xl}`, fontSize: theme.typography.fontSize.base },
    lg: { padding: `${theme.spacing.lg} ${theme.spacing['2xl']}`, fontSize: theme.typography.fontSize.lg },
  };
  const variants: Record<string, React.CSSProperties> = {
    primary: { background: `linear-gradient(135deg, ${theme.colors.primary[500]}, ${theme.colors.primary[600]})`, color: 'white', boxShadow: hovered ? '0 8px 25px rgba(14,165,233,0.45)' : theme.shadows.md },
    secondary: { background: `linear-gradient(135deg, ${theme.colors.secondary[500]}, ${theme.colors.secondary[600]})`, color: 'white', boxShadow: hovered ? '0 8px 25px rgba(139,92,246,0.45)' : theme.shadows.md },
    outline: { background: 'transparent', color: theme.colors.dark[100], border: `1px solid ${theme.colors.dark[600]}` },
    ghost: { background: 'transparent', color: theme.colors.dark[300] },
    success: { background: `linear-gradient(135deg, ${theme.colors.success[500]}, ${theme.colors.success[600]})`, color: 'white', boxShadow: hovered ? '0 8px 25px rgba(16,185,129,0.45)' : theme.shadows.md },
    warning: { background: `linear-gradient(135deg, ${theme.colors.warning[500]}, ${theme.colors.warning[600]})`, color: 'white', boxShadow: hovered ? '0 8px 25px rgba(245,158,11,0.45)' : theme.shadows.md },
    error: { background: `linear-gradient(135deg, ${theme.colors.error[500]}, ${theme.colors.error[600]})`, color: 'white', boxShadow: hovered ? '0 8px 25px rgba(239,68,68,0.45)' : theme.shadows.md },
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
    background: `linear-gradient(145deg, ${theme.colors.dark[800]}, ${theme.colors.dark[900]})`,
    borderRadius: theme.borderRadius.xl, border: `1px solid ${theme.colors.dark[700]}`,
    boxShadow: theme.shadows.lg, ...s,
  }} {...props}>
    {children}
  </div>
);

// ---- Card rendering ----

function CardView({ card, size = 'md', hover = true }: { card: CardT; size?: 'sm' | 'md' | 'lg'; hover?: boolean }) {
  const sizes = { sm: { width: 60, height: 84, fs: 10 }, md: { width: 80, height: 110, fs: 12 }, lg: { width: 100, height: 140, fs: 14 } };
  const { width, height, fs } = sizes[size];
  const suits = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' };
  const isRed = card.color === 'red';
  const isFace = ['J', 'Q', 'K'].includes(card.rank);
  return (
    <div style={{
      border: `2px solid ${theme.colors.dark[600]}`, borderRadius: theme.borderRadius.xl,
      width, height, background: 'linear-gradient(145deg,#fff,#f8fafc)',
      position: 'relative', fontFamily: '"Georgia",serif', color: isRed ? '#dc2626' : '#1f2937',
      boxShadow: theme.shadows.lg, overflow: 'hidden', cursor: hover ? 'pointer' : 'default',
      transition: 'all 0.3s ease-in-out', flexShrink: 0,
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'radial-gradient(circle at 30% 20%,rgba(255,255,255,0.8) 0%,transparent 50%)', pointerEvents: 'none' }} />
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
            <div style={{ fontSize: fs + 4, padding: '2px 6px', background: isRed ? '#fee2e2' : '#f1f5f9', borderRadius: theme.borderRadius.sm, border: `1px solid ${isRed ? '#fca5a5' : '#cbd5e1'}` }}>{card.rank}</div>
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
      border: `2px solid ${theme.colors.dark[600]}`, borderRadius: theme.borderRadius.xl,
      width, height, background: `linear-gradient(135deg,${theme.colors.primary[900]},${theme.colors.secondary[900]})`,
      boxShadow: theme.shadows.lg, position: 'relative', overflow: 'hidden', flexShrink: 0,
    }}>
      <div style={{ position: 'absolute', inset: 0, background: 'repeating-linear-gradient(45deg,rgba(255,255,255,0.1) 0px,rgba(255,255,255,0.1) 2px,transparent 2px,transparent 8px),repeating-linear-gradient(-45deg,rgba(255,255,255,0.05) 0px,rgba(255,255,255,0.05) 2px,transparent 2px,transparent 8px)' }} />
      <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: '60%', height: '60%', border: '1px solid rgba(255,255,255,0.3)', borderRadius: theme.borderRadius.lg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: width * 0.2, color: 'rgba(255,255,255,0.7)', fontWeight: 'bold' }}>
        ♠♥♦♣
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

function FloatingCards() {
  const items = useMemo(() => Array.from({ length: 14 }, (_, i) => ({
    id: i,
    suit: ['♠', '♥', '♦', '♣'][i % 4],
    x: 5 + (i * 7) % 90,
    size: 24 + (i * 13) % 36,
    duration: 18 + (i * 3.7) % 18,
    delay: -(i * 4.1) % 30,
    isRed: i % 4 >= 2,
  })), []);
  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, overflow: 'hidden' }}>
      {items.map((item) => (
        <div key={item.id} style={{
          position: 'absolute', left: `${item.x}%`, bottom: '-10%',
          fontSize: item.size,
          color: item.isRed ? 'rgba(220,38,38,0.13)' : 'rgba(255,255,255,0.07)',
          animation: `floatUpDrift ${item.duration}s ${item.delay}s linear infinite`,
          userSelect: 'none',
        }}>{item.suit}</div>
      ))}
    </div>
  );
}

function Confetti() {
  const pieces = useMemo(() => Array.from({ length: 65 }, (_, i) => ({
    id: i,
    x: (i * 1.57) % 100,
    delay: (i * 0.047) % 2,
    duration: 2.5 + (i * 0.07) % 2,
    color: ['#f59e0b','#10b981','#3b82f6','#ef4444','#8b5cf6','#06b6d4','#f97316'][i % 7],
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
          <h2 style={{ margin: '0 0 1rem', color: theme.colors.dark[100], fontSize: theme.typography.fontSize['2xl'] }}>
            {isEnd ? '🏆 Game Over!' : `Round ${game.currentRound} Complete`}
          </h2>
          {isEnd && winners && winners.length > 0 && (
            <div style={{ marginBottom: theme.spacing['2xl'], padding: theme.spacing.lg, background: `${theme.colors.success[600]}33`, border: `1px solid ${theme.colors.success[500]}`, borderRadius: theme.borderRadius.lg }}>
              <span style={{ color: theme.colors.success[500], fontWeight: 700 }}>
                {winners.length === 1 ? `Winner: ${winners[0].displayName}` : `Co-winners: ${winners.map((w) => w.displayName).join(', ')}`}
              </span>
              <span style={{ color: theme.colors.dark[300], marginLeft: 8 }}>({winners[0].score} pts)</span>
            </div>
          )}
          <div style={{ overflowX: 'auto', marginBottom: theme.spacing['2xl'] }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: theme.typography.fontSize.sm, color: theme.colors.dark[200] }}>
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
                    <tr key={p.playerId} style={{ borderBottom: `1px solid ${theme.colors.dark[700]}`, background: isLowest ? `${theme.colors.success[600]}22` : 'transparent' }}>
                      <td style={{ padding: '6px 8px', color: p.playerId === playerId ? theme.colors.primary[400] : theme.colors.dark[200] }}>
                        {p.displayName}{p.playerId === playerId ? ' (you)' : ''}
                        {isLowest && <span style={{ marginLeft: 6, color: theme.colors.success[500] }}>★</span>}
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
          <h2 style={{ margin: '0 0 1rem', color: theme.colors.dark[100], fontSize: theme.typography.fontSize['2xl'] }}>
            {isEnd ? '🏆 Game Over!' : `Round ${game.currentRound} Complete`}
          </h2>
          {isEnd && winners && winners.length > 0 && (
            <div style={{ marginBottom: theme.spacing['2xl'], padding: theme.spacing.lg, background: `${theme.colors.success[600]}33`, border: `1px solid ${theme.colors.success[500]}`, borderRadius: theme.borderRadius.lg }}>
              <span style={{ color: theme.colors.success[500], fontWeight: 700 }}>
                {winners.length === 1 ? `Winner: ${winners[0].displayName}` : `Co-winners: ${winners.map((w) => w.displayName).join(', ')}`}
              </span>
              <span style={{ color: theme.colors.dark[300], marginLeft: 8 }}>({winners[0].score} pts cumulative)</span>
            </div>
          )}
          <div style={{ overflowX: 'auto', marginBottom: theme.spacing['2xl'] }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: theme.typography.fontSize.sm, color: theme.colors.dark[200] }}>
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
                    <tr key={p.playerId} style={{ borderBottom: `1px solid ${theme.colors.dark[700]}`, background: isWinner ? `${theme.colors.success[600]}22` : 'transparent' }}>
                      <td style={{ padding: '6px 8px', color: p.playerId === playerId ? theme.colors.primary[400] : theme.colors.dark[200] }}>
                        {p.displayName}{p.playerId === playerId ? ' (you)' : ''}
                        {isWinner && <span style={{ marginLeft: 6, color: theme.colors.success[500] }}>★</span>}
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
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <span style={{ fontWeight: 700, color: theme.colors.dark[100] }}>Round {game.currentRound} / {game.targetRounds}</span>
          <span style={{ color: theme.colors.dark[400], fontSize: theme.typography.fontSize.sm }}>Code: <strong style={{ color: theme.colors.dark[200] }}>{game.code}</strong></span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span className={deckShaking ? 'deck-shake' : ''} style={{ color: theme.colors.dark[400], fontSize: theme.typography.fontSize.sm, display: 'inline-block' }}>🂠 {game.extraDeckCount}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: theme.colors.dark[400], fontSize: theme.typography.fontSize.sm }}>Discard:</span>
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
          <Btn disabled={peekAcked} onClick={() => { setPeekAcked(true); emit('golf:ackPeek', {}, (r: any) => { if (r?.error) { setPeekAcked(false); alert(r.error); } }); }}>
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
                  {isTurn && !disconnected && <span style={{ fontSize: theme.typography.fontSize.xs, background: theme.colors.primary[600], color: 'white', padding: '2px 8px', borderRadius: theme.borderRadius.lg }}>Turn</span>}
                  {isTurn && disconnected && <span style={{ fontSize: theme.typography.fontSize.xs, background: theme.colors.warning[600], color: 'white', padding: '2px 8px', borderRadius: theme.borderRadius.lg }}>Waiting…</span>}
                  {disconnected && <span style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.dark[500] }}><span style={{ display: 'inline-block', width: 10, height: 10, border: `2px solid ${theme.colors.dark[500]}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite', marginRight: 4 }} />disconnected</span>}
                  {running !== undefined && <span style={{ fontSize: theme.typography.fontSize.xs, padding: '2px 8px', background: theme.colors.dark[700], border: `1px solid ${theme.colors.dark[600]}`, borderRadius: theme.borderRadius.lg, color: theme.colors.dark[300] }}>{running} pts</span>}
                  {isHost && !isMe && disconnected && !graceElapsed && <span style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.dark[500] }}>kick in {kickSecondsLeft}s</span>}
                  {isHost && !isMe && disconnected && graceElapsed && <Btn size="sm" variant="error" onClick={() => emit('golf:kickPlayer', { playerId: h.playerId }, (r: any) => { if (r?.error) alert(r.error); })}>Kick</Btn>}
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
                <Btn onClick={() => { if (!selectedSlotId) return alert('Select a slot first'); emit('golf:swapWithDiscard', { slotId: selectedSlotId }, (r: any) => { if (r?.error) return alert(r.error); setSelectedSlotId(null); }); }} disabled={!game.discardTop}>Swap with discard</Btn>
                <Btn variant="outline" onClick={() => { setDeckShaking(true); setTimeout(() => setDeckShaking(false), 500); emit('golf:draw', {}, (r: any) => { if (r?.error) return alert(r.error); setPendingDraw(r.card); }); }}>Draw from deck</Btn>
              </>
            )}
            {pendingDraw && (
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ color: theme.colors.dark[300] }}>Drawn:</span>
                <CardView card={pendingDraw} />
                <Btn variant="success" onClick={() => { if (!selectedSlotId) return alert('Select a slot to swap'); emit('golf:acceptDrawAndSwap', { slotId: selectedSlotId }, (r: any) => { if (r?.error) return alert(r.error); setPendingDraw(null); setSelectedSlotId(null); }); }}>Accept & swap</Btn>
                <Btn variant="warning" onClick={() => { if (!selectedSlotId) return alert('Select a slot to reveal'); emit('golf:rejectDrawAndReveal', { slotId: selectedSlotId }, (r: any) => { if (r?.error) return alert(r.error); setPendingDraw(null); setSelectedSlotId(null); }); }}>Reject & reveal</Btn>
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
      if (r?.error && r.error !== 'Wrong rank — 2 penalty cards drawn') {
        alert(r.error);
      }
      setSnapMode(false);
    });
  }

  function handleOwnSlotClick(slotId: string) {
    if (snapMode) { handleSnapSlot(playerId!, slotId); return; }

    if (specialMode === 'peek-own') {
      emit('cabo:useSpecialPower', { action: 'peek-own', ownSlotId: slotId }, (r: any) => {
        if (r?.error) return alert(r.error);
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
        if (r?.error) return alert(r.error);
        setBlackKingSeen(null);
        setSpecialMode('none');
        setSelectedOwnSlot(null);
      });
      return;
    }

    // place drawn card
    if (hasPendingDraw && isMyTurn && !hasBlackKingPending) {
      emit('cabo:placeDrawn', { slotId }, (r: any) => {
        if (r?.error) return alert(r.error);
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
        if (r?.error) return alert(r.error);
        setSpecialMode('none');
        setSelectedOpponentSlot(null);
      });
      return;
    }
    if (specialMode === 'blind-swap-opponent') {
      if (!selectedOwnSlot) { setSpecialMode('blind-swap-own'); return; }
      emit('cabo:useSpecialPower', { action: 'blind-swap', ownSlotId: selectedOwnSlot, targetPlayerId: targetPid, targetSlotId: slotId }, (r: any) => {
        if (r?.error) return alert(r.error);
        setSpecialMode('none');
        setSelectedOwnSlot(null);
        setSelectedOpponentSlot(null);
      });
      return;
    }
    if (specialMode === 'black-king-see') {
      emit('cabo:useSpecialPower', { action: 'black-king-see', targetPlayerId: targetPid, targetSlotId: slotId }, (r: any) => {
        if (r?.error) return alert(r.error);
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
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <span style={{ fontWeight: 700, color: theme.colors.dark[100] }}>Cabo · Round {game.currentRound}</span>
          <span style={{ color: theme.colors.dark[400], fontSize: theme.typography.fontSize.sm }}>Code: <strong style={{ color: theme.colors.dark[200] }}>{game.code}</strong></span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span className={deckShaking ? 'deck-shake' : ''} style={{ color: theme.colors.dark[400], fontSize: theme.typography.fontSize.sm, display: 'inline-block' }}>🂠 {game.extraDeckCount}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: theme.colors.dark[400], fontSize: theme.typography.fontSize.sm }}>Discard:</span>
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
          <Btn disabled={peekAcked} onClick={() => { setPeekAcked(true); emit('cabo:ackPeek', {}, (r: any) => { if (r?.error) { setPeekAcked(false); alert(r.error); } }); }}>
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
                  if (r?.error) return alert(r.error);
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
                  if (r?.error) return alert(r.error);
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

            // my slots from private event
            const privateSlots = isMe ? (mySlots ?? []) : null;

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
                  {isTurn && !disconnected && <span style={{ fontSize: theme.typography.fontSize.xs, background: theme.colors.primary[600], color: 'white', padding: '2px 8px', borderRadius: theme.borderRadius.lg }}>Turn</span>}
                  {isTurn && disconnected && <span style={{ fontSize: theme.typography.fontSize.xs, background: theme.colors.warning[600], color: 'white', padding: '2px 8px', borderRadius: theme.borderRadius.lg }}>Waiting…</span>}
                  {disconnected && <span style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.dark[500] }}><span style={{ display: 'inline-block', width: 10, height: 10, border: `2px solid ${theme.colors.dark[500]}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite', marginRight: 4 }} />disconnected</span>}
                  {cumulative !== undefined && <span style={{ fontSize: theme.typography.fontSize.xs, padding: '2px 8px', background: theme.colors.dark[700], border: `1px solid ${theme.colors.dark[600]}`, borderRadius: theme.borderRadius.lg, color: theme.colors.dark[300] }}>{cumulative} pts</span>}
                  {hasPendingDrawIndicator && !isMe && <span style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.primary[400] }}>deciding…</span>}
                  {hasBlackKingIndicator && !isMe && <span style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.secondary[400] }}>black king…</span>}
                  {h.playerId === caboCallerId && <span style={{ fontSize: theme.typography.fontSize.xs, background: `${theme.colors.warning[600]}44`, color: theme.colors.warning[400], padding: '2px 8px', borderRadius: theme.borderRadius.lg, border: `1px solid ${theme.colors.warning[600]}` }}>Called Cabo</span>}
                </div>

                {/* card grid (variable width) */}
                <div style={{ overflowX: 'auto' }}>
                  {[h.slots.slice(0, row1Count), h.slots.slice(row1Count)].map((rowSlots, rowIdx) => {
                    if (rowSlots.length === 0) return null;
                    return (
                      <div key={rowIdx} style={{ display: 'grid', gridTemplateColumns: `repeat(${rowSlots.length}, auto)`, gap: cardGap, width: 'fit-content', marginTop: rowIdx > 0 ? cardGap : 0 }}>
                        {rowSlots.map((s) => {
                          if (isMe) {
                            const privateCard = privateSlots?.find((ps) => ps.slotId === s.slotId)?.card ?? null;
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
                                card={privateCard}
                                selectable={isSelectableOwnSlot || isSlideTarget}
                                selected={selectedOwnSlot === s.slotId || snapSlideSlot === s.slotId}
                                snapTarget={snapMode}
                                onSelect={() => {
                                  if (isSlideTarget && !snapMode) { setSnapSlideSlot(s.slotId); return; }
                                  handleOwnSlotClick(s.slotId);
                                }}
                                cardSize={cardSize}
                                showFaceUp={!!privateCard}
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
              <Btn onClick={() => {
                setDeckShaking(true);
                setTimeout(() => setDeckShaking(false), 500);
                emit('cabo:draw', {}, (r: any) => {
                  if (r?.error) return alert(r.error);
                  setPendingDraw(r.card);
                });
              }}>Draw from deck</Btn>
              <Btn variant="outline" disabled={!game.discardTop} onClick={() => {
                const slots = mySlots;
                if (!slots || slots.length === 0) return alert('No slots to swap into');
                const slotId = selectedOwnSlot ?? slots[0].slotId;
                emit('cabo:takeDiscard', { slotId }, (r: any) => {
                  if (r?.error) return alert(r.error);
                  setSelectedOwnSlot(null);
                });
              }}>
                {selectedOwnSlot ? 'Take discard → selected slot' : 'Take discard (select slot first)'}
              </Btn>
              {phase === 'play' && (
                <Btn variant="warning" onClick={() => {
                  if (!window.confirm('Call Cabo? All other players get one more turn.')) return;
                  emit('cabo:callCabo', {}, (r: any) => { if (r?.error) alert(r.error); });
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
                      if (r?.error) return alert(r.error);
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
      if (res?.error) return alert(res.error);
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
      if (res?.error) return alert(res.error);
      setPlayerId(res.playerId);
      setPlayerToken(res.playerToken);
      setCode(res.code);
      persistSession(res.playerId, res.playerToken, res.code);
      setView('lobby');
    });
  }

  function startGame() {
    socket?.emit('startGame', {}, (res: any) => {
      if (res?.error) return alert(res.error);
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
    socket?.emit(event, {}, (res: any) => { if (res?.error) alert(res.error); });
  }

  function ackRematch() {
    const event = isCabo ? 'cabo:ackRematch' : 'golf:ackRematch';
    socket?.emit(event, {}, (res: any) => { if (res?.error) alert(res.error); });
  }

  function leaveGame() {
    const event = isCabo ? 'cabo:leaveGame' : 'golf:leaveGame';
    socket?.emit(event, {}, (res: any) => {
      if (res?.error) return alert(res.error);
      clearSession();
      setGame(null); setPlayerId(null); setPlayerToken(null); setCode('');
      setMyGolfSlots(null); setPendingDraw(null); setSelectedSlotId(null);
      setCaboMySlots(null); setCaboPendingDraw(null); setCaboSnapGap(null);
      setView('landing');
    });
  }

  function updateConfig(cpp: number) {
    socket?.emit('golf:updateConfig', { cardsPerPlayer: cpp }, (res: any) => { if (res?.error) alert(res.error); });
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: theme.spacing.lg,
    background: theme.colors.dark[800], border: `1px solid ${theme.colors.dark[600]}`,
    borderRadius: theme.borderRadius.lg, color: theme.colors.dark[100],
    fontSize: theme.typography.fontSize.base, fontFamily: theme.typography.fontFamily,
    outline: 'none', transition: 'all 0.2s ease-in-out', boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: theme.typography.fontSize.sm, fontWeight: theme.typography.fontWeight.medium,
    color: theme.colors.dark[300], marginBottom: theme.spacing.sm,
    textTransform: 'uppercase', letterSpacing: '0.05em',
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: `
        repeating-linear-gradient(45deg,  rgba(255,255,255,0.012) 0px, rgba(255,255,255,0.012) 1px, transparent 1px, transparent 7px),
        repeating-linear-gradient(-45deg, rgba(255,255,255,0.012) 0px, rgba(255,255,255,0.012) 1px, transparent 1px, transparent 7px),
        radial-gradient(ellipse at 30% 30%, #1e5c2e 0%, #0f3d1f 50%, #071a0e 100%)
      `,
      fontFamily: theme.typography.fontFamily, color: theme.colors.dark[100],
      padding: isMobile ? theme.spacing.lg : theme.spacing['3xl'], position: 'relative',
    }}>
      <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.55) 100%)', zIndex: 0, pointerEvents: 'none' }} />
      <FloatingCards />

      {/* Landing */}
      {view === 'landing' && (
        <div className="view-enter" style={{ maxWidth: 400, margin: '0 auto', paddingTop: theme.spacing['5xl'], position: 'relative', zIndex: 1 }}>
          <div style={{ textAlign: 'center', marginBottom: theme.spacing['5xl'] }}>
            <h1 style={{ fontSize: theme.typography.fontSize['4xl'], fontWeight: theme.typography.fontWeight.bold, background: `linear-gradient(135deg,${theme.colors.primary[400]},${theme.colors.secondary[400]})`, backgroundClip: 'text', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', marginBottom: theme.spacing.md, letterSpacing: '-0.02em' }}>Card Games</h1>
            <p style={{ color: theme.colors.dark[300], fontSize: theme.typography.fontSize.lg, fontWeight: theme.typography.fontWeight.bold, letterSpacing: '0.06em' }}>MULTIPLAYER</p>
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
            <h2 style={{ fontSize: theme.typography.fontSize['3xl'], fontWeight: theme.typography.fontWeight.bold, color: theme.colors.dark[100], marginBottom: theme.spacing.md }}>Create Game</h2>
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
                  <option value="classic">Classic</option>
                </select>
              </div>
              {gameMode !== 'cabo' && (
                <div>
                  <label style={labelStyle}>Cards Per Player</label>
                  {gameMode === 'golf' ? (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: theme.spacing.md }}>
                      {[4, 6, 8].map((n) => (
                        <button key={n} onClick={() => setCardsPerPlayer(n)}
                          style={{ padding: theme.spacing.lg, background: cardsPerPlayer === n ? `linear-gradient(135deg,${theme.colors.primary[500]},${theme.colors.primary[600]})` : theme.colors.dark[800], border: `1px solid ${cardsPerPlayer === n ? theme.colors.primary[500] : theme.colors.dark[600]}`, borderRadius: theme.borderRadius.lg, color: theme.colors.dark[100], fontWeight: theme.typography.fontWeight.medium, cursor: 'pointer', transition: 'all 0.2s' }}>
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
            <h2 style={{ fontSize: theme.typography.fontSize['3xl'], fontWeight: theme.typography.fontWeight.bold, color: theme.colors.dark[100], marginBottom: theme.spacing.md }}>Join Game</h2>
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
        <div className="view-enter" style={{ maxWidth: 480, margin: '0 auto', display: 'grid', gap: 16, position: 'relative', zIndex: 1 }}>
          <h2 style={{ margin: 0, color: theme.colors.dark[100] }}>Lobby</h2>
          <Panel style={{ padding: theme.spacing['2xl'] }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: theme.spacing.lg }}>
              <span style={{ color: theme.colors.dark[400] }}>Code</span>
              <strong style={{ color: theme.colors.primary[400], fontFamily: 'monospace', letterSpacing: '0.2em' }}>{game.code}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: theme.spacing.lg }}>
              <span style={{ color: theme.colors.dark[400] }}>Mode</span>
              <span style={{ color: theme.colors.dark[200] }}>
                {game.config.gameMode === 'golf' ? `Golf (${game.config.cardsPerPlayer} cards)` : game.config.gameMode === 'cabo' ? 'Cabo (4 cards, first to 100+)' : 'Classic'}
              </span>
            </div>
            <div style={{ marginBottom: theme.spacing.lg }}>
              <div style={{ color: theme.colors.dark[400], marginBottom: theme.spacing.sm }}>Players ({game.players.length}/{game.config.maxPlayers})</div>
              <div style={{ display: 'grid', gap: theme.spacing.sm }}>
                {game.players.map((p) => (
                  <div key={p.playerId} style={{ display: 'flex', justifyContent: 'space-between', padding: `${theme.spacing.sm} ${theme.spacing.md}`, background: theme.colors.dark[800], borderRadius: theme.borderRadius.lg }}>
                    <span style={{ color: p.playerId === playerId ? theme.colors.primary[400] : theme.colors.dark[200] }}>{p.displayName}</span>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {p.playerId === game.hostId && <span style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.warning[500] }}>Host</span>}
                      {!p.connected && <span style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.dark[500] }}>disconnected</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: theme.spacing.lg }}>
              {isHost && <Btn onClick={startGame} disabled={(game.players?.length || 0) < 2}>Start Game</Btn>}
              <Btn variant="outline" onClick={() => setView('table')}>Go to Table</Btn>
            </div>
          </Panel>
        </div>
      )}

      {/* Classic table */}
      {view === 'table' && game && !isGolf && !isCabo && (
        <div style={{ display: 'grid', gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div>Code: <strong>{game.code}</strong></div>
            <div>Extra deck: {game.extraDeckCount}</div>
          </div>
          <div>
            Center pile:
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: 8, border: `1px solid ${theme.colors.dark[600]}`, minHeight: 64 }}>
              {game.centerPile.slice(-10).map((c) => <CardView key={c.cardId} card={c} />)}
            </div>
          </div>
          <div>
            My hand:
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: 8 }}>
              {hand.map((c) => (
                <button key={c.cardId} onClick={() => socket?.emit('playCard', { cardId: c.cardId }, (r: any) => { if (r?.error) alert(r.error); })} style={{ padding: 0, border: 'none', background: 'none' }}>
                  <CardView card={c} />
                </button>
              ))}
            </div>
          </div>
          <button onClick={() => socket?.emit('drawCard', {}, (r: any) => { if (r?.error) alert(r.error); })} disabled={game.extraDeckCount <= 0}>Draw</button>
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
              <h2 style={{ margin: 0, color: theme.colors.dark[100] }}>Leaderboard</h2>
              <Btn variant="ghost" size="sm" onClick={() => setShowLeaderboard(false)}>✕</Btn>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: theme.typography.fontSize.sm, color: theme.colors.dark[200] }}>
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
