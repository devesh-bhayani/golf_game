import React, { useEffect, useMemo, useState } from 'react';
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
  .card-hover:hover { animation: cardHover 0.3s ease-in-out forwards; }
  .fade-in { animation: fadeIn 0.6s ease-out; }
  .slide-in { animation: slideIn 0.4s ease-out; }
  .glow { animation: glow 2s ease-in-out infinite; }
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

type GamePhase = 'waiting' | 'peek' | 'play' | 'between-rounds' | 'ended' | 'rematch-pending';

type CardT = {
  cardId: string;
  suit: 'spades' | 'hearts' | 'diamonds' | 'clubs';
  rank: 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';
  color: 'red' | 'black';
  value: number;
};

type GolfSlotT = { slotId: string; revealed: boolean; locked: boolean; card: CardT | null };

type GameSnapshot = {
  gameId: string;
  code: string;
  hostId: string;
  status: 'waiting' | 'active' | 'ended';
  phase: GamePhase;
  config: { maxPlayers: number; totalCardsPerDeck: number; numberOfDecks: number; cardsPerPlayer: number; gameMode?: 'classic' | 'golf' };
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
  const base: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: theme.typography.fontFamily, fontWeight: theme.typography.fontWeight.medium,
    borderRadius: theme.borderRadius.lg, border: 'none', outline: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
    transition: 'all 0.2s ease-in-out', pointerEvents: disabled ? 'none' : 'auto',
  };
  const sizes = {
    sm: { padding: `${theme.spacing.sm} ${theme.spacing.md}`, fontSize: theme.typography.fontSize.sm },
    md: { padding: `${theme.spacing.md} ${theme.spacing.xl}`, fontSize: theme.typography.fontSize.base },
    lg: { padding: `${theme.spacing.lg} ${theme.spacing['2xl']}`, fontSize: theme.typography.fontSize.lg },
  };
  const variants: Record<string, React.CSSProperties> = {
    primary: { background: `linear-gradient(135deg, ${theme.colors.primary[500]}, ${theme.colors.primary[600]})`, color: 'white', boxShadow: theme.shadows.md },
    secondary: { background: `linear-gradient(135deg, ${theme.colors.secondary[500]}, ${theme.colors.secondary[600]})`, color: 'white' },
    outline: { background: 'transparent', color: theme.colors.dark[100], border: `1px solid ${theme.colors.dark[600]}` },
    ghost: { background: 'transparent', color: theme.colors.dark[300] },
    success: { background: theme.colors.success[500], color: 'white' },
    warning: { background: theme.colors.warning[500], color: 'white' },
    error: { background: theme.colors.error[500], color: 'white' },
  };
  return (
    <button style={{ ...base, ...sizes[size], ...variants[variant], ...extraStyle }} onClick={onClick} disabled={disabled} {...props}>
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

// ---- Slot ----

function SlotView({ slot, selectable, selected, onSelect, cardSize = 'md' }: {
  slot: GolfSlotT; selectable: boolean; selected: boolean; onSelect: () => void; cardSize?: 'sm' | 'md';
}) {
  const borderColor = selected ? theme.colors.primary[500] : slot.locked ? theme.colors.success[500] : theme.colors.dark[600];
  return (
    <div
      onClick={() => selectable && onSelect()}
      style={{ cursor: selectable ? 'pointer' : 'default', border: `2px solid ${borderColor}`, borderRadius: theme.borderRadius.lg, padding: 2, transition: 'border-color 0.2s' }}
    >
      {slot.card ? <CardView card={slot.card} size={cardSize} /> : <CardBack size={cardSize} />}
    </div>
  );
}

// ---- Round score modal ----

function RoundScoreModal({
  game, playerId, phase, onAckNextRound, onAckRematch, onLeave,
  onUpdateConfig, isHost,
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
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <Panel style={{ padding: theme.spacing['3xl'], maxWidth: 640, width: '95%', maxHeight: '90vh', overflowY: 'auto' }} className="fade-in">
        <h2 style={{ margin: '0 0 1rem', color: theme.colors.dark[100], fontSize: theme.typography.fontSize['2xl'] }}>
          {isEnd ? 'Game Over!' : `Round ${game.currentRound} Complete`}
        </h2>

        {isEnd && winners && winners.length > 0 && (
          <div style={{ marginBottom: theme.spacing['2xl'], padding: theme.spacing.lg, background: `${theme.colors.success[600]}33`, border: `1px solid ${theme.colors.success[500]}`, borderRadius: theme.borderRadius.lg }}>
            <span style={{ color: theme.colors.success[500], fontWeight: 700 }}>
              {winners.length === 1 ? `Winner: ${winners[0].displayName}` : `Co-winners: ${winners.map((w) => w.displayName).join(', ')}`}
            </span>
            <span style={{ color: theme.colors.dark[300], marginLeft: 8 }}>({winners[0].score} pts)</span>
          </div>
        )}

        {/* Score table */}
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
                    <td style={{ textAlign: 'center', padding: '6px 8px', fontWeight: 700, color: theme.colors.dark[100] }}>{total}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Config for next game */}
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

        {/* Ack indicators */}
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
          {isEnd && (
            <Btn variant="outline" onClick={onLeave}>Leave</Btn>
          )}
          <Btn
            variant="success"
            onClick={isBetween ? onAckNextRound : onAckRematch}
            disabled={alreadyAcked}
          >
            {alreadyAcked ? 'Waiting…' : isEnd ? 'Play Again' : 'Ready'}
          </Btn>
        </div>
      </Panel>
    </div>
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

  const isMyTurn = game.golf?.turn === playerId;
  const perRow = Math.floor((game.config.cardsPerPlayer || 4) / 2);
  const peekActive = game.golf?.peekPhaseActive !== false;

  const emit = (event: string, payload: any, cb?: (r: any) => void) => socket?.emit(event, payload, cb);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <span style={{ fontWeight: 700, color: theme.colors.dark[100] }}>
            Round {game.currentRound} / {game.targetRounds}
          </span>
          <span style={{ color: theme.colors.dark[400], fontSize: theme.typography.fontSize.sm }}>Code: <strong style={{ color: theme.colors.dark[200] }}>{game.code}</strong></span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ color: theme.colors.dark[400], fontSize: theme.typography.fontSize.sm }}>Deck: {game.extraDeckCount}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: theme.colors.dark[400], fontSize: theme.typography.fontSize.sm }}>Discard:</span>
            {game.discardTop ? <CardView card={game.discardTop} size="sm" /> : <span style={{ color: theme.colors.dark[500] }}>—</span>}
          </div>
        </div>
      </div>

      {/* Peek phase */}
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
          <Btn
            disabled={peekAcked}
            onClick={() => {
              setPeekAcked(true);
              emit('golf:ackPeek', {}, (r: any) => { if (r?.error) { setPeekAcked(false); alert(r.error); } });
            }}
          >
            {peekAcked ? 'Waiting for others…' : 'Got it — hide cards'}
          </Btn>
        </Panel>
      )}

      {/* Main table */}
      {!peekActive && (
        <div style={{
          display: 'grid', gap: 20,
          maxHeight: isMobile ? 'none' : 'calc(100vh - 260px)',
          overflowY: isMobile ? 'visible' : 'auto',
          paddingRight: isMobile ? 0 : 4,
        }}>
          {game.golf?.hands.map((h) => {
            const player = game.players.find((p) => p.playerId === h.playerId);
            const isMe = h.playerId === playerId;
            const isTurn = h.playerId === game.golf?.turn;
            const running = game.runningTotals?.[h.playerId];
            const disconnected = player && !player.connected;
            const disconnectedAt = player?.disconnectedAt;
            const graceElapsed = disconnectedAt && Date.now() - disconnectedAt >= 30_000;
            const kickSecondsLeft = disconnectedAt && !graceElapsed
              ? Math.max(0, 30 - Math.floor((Date.now() - disconnectedAt) / 1000))
              : 0;
            const isHost = playerId === game.hostId;

            return (
              <div key={h.playerId} style={{
                opacity: disconnected ? 0.7 : 1,
                padding: isTurn ? 12 : 0,
                borderRadius: isTurn ? theme.borderRadius.xl : 0,
                border: isTurn ? `2px solid ${isMe ? theme.colors.primary[500] : theme.colors.dark[500]}` : '2px solid transparent',
                boxShadow: isTurn && isMe ? theme.shadows.glow : 'none',
                transition: 'all 0.3s ease-in-out',
              }}>
                {/* Player nameplate */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontWeight: 600, color: isMe ? theme.colors.primary[400] : theme.colors.dark[200] }}>
                    {player?.displayName}{isMe ? ' (you)' : ''}
                  </span>
                  {isTurn && !disconnected && (
                    <span style={{ fontSize: theme.typography.fontSize.xs, background: theme.colors.primary[600], color: 'white', padding: '2px 8px', borderRadius: theme.borderRadius.lg }}>
                      Turn
                    </span>
                  )}
                  {isTurn && disconnected && (
                    <span style={{ fontSize: theme.typography.fontSize.xs, background: theme.colors.warning[600], color: 'white', padding: '2px 8px', borderRadius: theme.borderRadius.lg }}>
                      Waiting…
                    </span>
                  )}
                  {disconnected && (
                    <span style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.dark[500] }}>
                      <span style={{ display: 'inline-block', width: 10, height: 10, border: `2px solid ${theme.colors.dark[500]}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite', marginRight: 4 }} />
                      disconnected
                    </span>
                  )}
                  {/* Running total badge */}
                  {running !== undefined && (
                    <span style={{
                      fontSize: theme.typography.fontSize.xs, padding: '2px 8px',
                      background: theme.colors.dark[700], border: `1px solid ${theme.colors.dark[600]}`,
                      borderRadius: theme.borderRadius.lg, color: theme.colors.dark[300],
                    }}>
                      {running} pts
                    </span>
                  )}
                  {/* Kick countdown / button */}
                  {isHost && !isMe && disconnected && !graceElapsed && (
                    <span style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.dark[500] }}>
                      kick in {kickSecondsLeft}s
                    </span>
                  )}
                  {isHost && !isMe && disconnected && graceElapsed && (
                    <Btn size="sm" variant="error"
                      onClick={() => emit('golf:kickPlayer', { playerId: h.playerId }, (r: any) => { if (r?.error) alert(r.error); })}>
                      Kick
                    </Btn>
                  )}
                </div>

                {/* Card grid */}
                <div style={{ overflowX: 'auto' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${perRow}, auto)`, gap: cardGap, width: 'fit-content' }}>
                    {h.slots.slice(0, perRow).map((s) => (
                      <SlotView key={s.slotId} slot={s}
                        selectable={!!(isMe && isMyTurn && !s.locked)}
                        selected={selectedSlotId === s.slotId}
                        onSelect={() => setSelectedSlotId(s.slotId)}
                        cardSize={cardSize} />
                    ))}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${perRow}, auto)`, gap: cardGap, marginTop: cardGap, width: 'fit-content' }}>
                    {h.slots.slice(perRow).map((s) => (
                      <SlotView key={s.slotId} slot={s}
                        selectable={!!(isMe && isMyTurn && !s.locked)}
                        selected={selectedSlotId === s.slotId}
                        onSelect={() => setSelectedSlotId(s.slotId)}
                        cardSize={cardSize} />
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Turn actions */}
      {isMyTurn && !peekActive && (
        <Panel style={{ padding: theme.spacing['2xl'] }}>
          <div style={{ fontWeight: 600, color: theme.colors.primary[400], marginBottom: 12 }}>Your turn</div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            {!pendingDraw && (
              <>
                <Btn
                  onClick={() => {
                    if (!selectedSlotId) return alert('Select a slot first');
                    emit('golf:swapWithDiscard', { slotId: selectedSlotId }, (r: any) => {
                      if (r?.error) return alert(r.error);
                      setSelectedSlotId(null);
                    });
                  }}
                  disabled={!game.discardTop}
                >
                  Swap with discard
                </Btn>
                <Btn variant="outline"
                  onClick={() => emit('golf:draw', {}, (r: any) => {
                    if (r?.error) return alert(r.error);
                    setPendingDraw(r.card);
                  })}>
                  Draw from deck
                </Btn>
              </>
            )}
            {pendingDraw && (
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ color: theme.colors.dark[300] }}>Drawn:</span>
                <CardView card={pendingDraw} />
                <Btn variant="success"
                  onClick={() => {
                    if (!selectedSlotId) return alert('Select a slot to swap');
                    emit('golf:acceptDrawAndSwap', { slotId: selectedSlotId }, (r: any) => {
                      if (r?.error) return alert(r.error);
                      setPendingDraw(null); setSelectedSlotId(null);
                    });
                  }}>
                  Accept & swap
                </Btn>
                <Btn variant="warning"
                  onClick={() => {
                    if (!selectedSlotId) return alert('Select a slot to reveal');
                    emit('golf:rejectDrawAndReveal', { slotId: selectedSlotId }, (r: any) => {
                      if (r?.error) return alert(r.error);
                      setPendingDraw(null); setSelectedSlotId(null);
                    });
                  }}>
                  Reject & reveal
                </Btn>
              </div>
            )}
          </div>
          {!selectedSlotId && <p style={{ margin: '8px 0 0', fontSize: theme.typography.fontSize.sm, color: theme.colors.dark[500] }}>Click one of your face-down cards to select a slot</p>}
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
  const [gameMode, setGameMode] = useState<'classic' | 'golf'>('golf');
  const [myGolfSlots, setMyGolfSlots] = useState<Array<{ slotId: string; card: CardT; revealed: boolean; locked: boolean; peekOnly?: boolean }> | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [pendingDraw, setPendingDraw] = useState<CardT | null>(null);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);

  const windowWidth = useWindowWidth();
  const isMobile = windowWidth < 640;

  const serverUrl = useMemo(() => ((import.meta as any).env?.VITE_SERVER_URL as string) || 'http://localhost:3001', []);

  // Persist session to localStorage
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
    const s = io(serverUrl, { transports: ['websocket'] });
    setSocket(s);

    s.on('game:update', (snapshot: GameSnapshot) => {
      setGame(snapshot);
      // Auto-navigate to table when game starts
      if (snapshot.phase === 'peek' || snapshot.phase === 'play') {
        setView((v) => (v === 'lobby' ? 'table' : v));
      }
    });
    s.on('hand:update', (cards: CardT[]) => setHand(cards));
    s.on('golf:hand', (slots: any) => setMyGolfSlots(slots));
    s.on('golf:pendingDraw', (card: CardT) => setPendingDraw(card));

    // Attempt rejoin from localStorage
    s.on('connect', () => {
      const tok = localStorage.getItem('golf_playerToken');
      const savedCode = localStorage.getItem('golf_code');
      if (tok && savedCode) {
        s.emit('rejoinGame', { playerToken: tok }, (res: any) => {
          if (res?.error) { clearSession(); return; }
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
  const isHost = playerId === game?.hostId;

  function createGame() {
    if (!socket) return;
    const config = { maxPlayers: 8, totalCardsPerDeck: 52, numberOfDecks: 1, cardsPerPlayer, gameMode };
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
    socket?.emit('golf:ackNextRound', {}, (res: any) => { if (res?.error) alert(res.error); });
  }

  function ackRematch() {
    socket?.emit('golf:ackRematch', {}, (res: any) => { if (res?.error) alert(res.error); });
  }

  function leaveGame() {
    socket?.emit('golf:leaveGame', {}, (res: any) => {
      if (res?.error) return alert(res.error);
      clearSession();
      setGame(null); setPlayerId(null); setPlayerToken(null); setCode('');
      setMyGolfSlots(null); setPendingDraw(null); setSelectedSlotId(null);
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
      background: `linear-gradient(135deg,${theme.colors.dark[950]} 0%,${theme.colors.dark[900]} 50%,${theme.colors.dark[800]} 100%)`,
      fontFamily: theme.typography.fontFamily, color: theme.colors.dark[100],
      padding: isMobile ? theme.spacing.lg : theme.spacing['3xl'], position: 'relative',
    }}>
      <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: `radial-gradient(circle at 20% 80%,${theme.colors.primary[900]}22 0%,transparent 50%),radial-gradient(circle at 80% 20%,${theme.colors.secondary[900]}22 0%,transparent 50%)`, animation: 'float 20s ease-in-out infinite', zIndex: -1, pointerEvents: 'none' }} />

      {/* --- Landing --- */}
      {view === 'landing' && (
        <div style={{ maxWidth: 400, margin: '0 auto', paddingTop: theme.spacing['5xl'] }}>
          <div style={{ textAlign: 'center', marginBottom: theme.spacing['5xl'] }}>
            <h1 style={{ fontSize: theme.typography.fontSize['4xl'], fontWeight: theme.typography.fontWeight.bold, background: `linear-gradient(135deg,${theme.colors.primary[400]},${theme.colors.secondary[400]})`, backgroundClip: 'text', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', marginBottom: theme.spacing.md, letterSpacing: '-0.02em' }}>Golf</h1>
            <p style={{ color: theme.colors.dark[300], fontSize: theme.typography.fontSize.lg, fontWeight: theme.typography.fontWeight.bold, letterSpacing: '0.06em' }}>MULTIPLAYER CARD GAME</p>
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

      {/* --- Create --- */}
      {view === 'create' && (
        <div style={{ maxWidth: 500, margin: '0 auto', paddingTop: theme.spacing['3xl'] }}>
          <div style={{ marginBottom: theme.spacing['3xl'], textAlign: 'center' }}>
            <h2 style={{ fontSize: theme.typography.fontSize['3xl'], fontWeight: theme.typography.fontWeight.bold, color: theme.colors.dark[100], marginBottom: theme.spacing.md }}>Create Game</h2>
          </div>
          <Panel style={{ padding: theme.spacing['3xl'] }}>
            <div style={{ display: 'grid', gap: theme.spacing['2xl'] }}>
              <div>
                <label style={labelStyle}>Game Mode</label>
                <select value={gameMode} onChange={(e) => { const m = e.target.value as 'classic' | 'golf'; setGameMode(m); if (m === 'golf' && ![4,6,8].includes(cardsPerPlayer)) setCardsPerPlayer(4); }}
                  style={{ ...inputStyle, cursor: 'pointer' }}>
                  <option value="golf">Golf Mode</option>
                  <option value="classic">Classic Mode</option>
                </select>
              </div>
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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: theme.spacing.lg, marginTop: theme.spacing.lg }}>
                <Btn variant="outline" onClick={() => setView('landing')}>Back</Btn>
                <Btn onClick={createGame} size="lg" disabled={!displayName.trim()}>Create Game</Btn>
              </div>
            </div>
          </Panel>
        </div>
      )}

      {/* --- Join --- */}
      {view === 'join' && (
        <div style={{ maxWidth: 400, margin: '0 auto', paddingTop: theme.spacing['3xl'] }}>
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

      {/* --- Lobby --- */}
      {view === 'lobby' && game && (
        <div style={{ maxWidth: 480, margin: '0 auto', display: 'grid', gap: 16 }}>
          <h2 style={{ margin: 0, color: theme.colors.dark[100] }}>Lobby</h2>
          <Panel style={{ padding: theme.spacing['2xl'] }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: theme.spacing.lg }}>
              <span style={{ color: theme.colors.dark[400] }}>Code</span>
              <strong style={{ color: theme.colors.primary[400], fontFamily: 'monospace', letterSpacing: '0.2em' }}>{game.code}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: theme.spacing.lg }}>
              <span style={{ color: theme.colors.dark[400] }}>Mode</span>
              <span style={{ color: theme.colors.dark[200] }}>{game.config.gameMode === 'golf' ? `Golf (${game.config.cardsPerPlayer} cards)` : 'Classic'}</span>
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
              {isHost && (
                <Btn onClick={startGame} disabled={(game.players?.length || 0) < 2}>Start Game</Btn>
              )}
              <Btn variant="outline" onClick={() => setView('table')}>Go to Table</Btn>
            </div>
          </Panel>
        </div>
      )}

      {/* --- Classic table --- */}
      {view === 'table' && game && !isGolf && (
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

      {/* --- Golf table --- */}
      {view === 'table' && game && isGolf && (
        <GolfTable
          game={game} playerId={playerId} myGolfSlots={myGolfSlots} socket={socket}
          pendingDraw={pendingDraw} setPendingDraw={setPendingDraw}
          selectedSlotId={selectedSlotId} setSelectedSlotId={setSelectedSlotId}
        />
      )}

      {/* --- Between-rounds modal --- */}
      {game && isGolf && (phase === 'between-rounds' || phase === 'rematch-pending') && (
        <RoundScoreModal
          game={game} playerId={playerId} phase={phase}
          onAckNextRound={ackNextRound} onAckRematch={ackRematch}
          onLeave={leaveGame} onUpdateConfig={updateConfig} isHost={isHost}
        />
      )}

      {/* --- Global leaderboard modal --- */}
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
