# Golf Card Game Rules

## Setup

- 2–8 players
- Standard 52-card deck
- Each player gets 4, 6, or 8 cards arranged in 2 rows
- Remaining cards form the draw pile; the top card starts the discard pile
- The player who sets up the game deals

## Initial Phase

- Cards are dealt face-down in a grid (2 rows)
- Each player briefly sees their bottom row once, then hides all cards
- Only you see your own bottom-row peek — other players cannot see it
- No re-peeking during the game — the initial peek is one-time only

## Turn Order

- The player to the right of the dealer (game setter) goes first
- Play proceeds clockwise thereafter

## Gameplay

Players take turns with 2 options:

### Option 1: Swap with Discard

- Take the top discard card
- Replace any of your hidden cards
- The replaced card becomes the new discard top
- Your new card is revealed and locked (cannot change again)

### Option 2: Draw from Deck

- Draw the next card from the deck
- **Accept:** swap with any hidden card (new card revealed/locked)
- **Reject:** discard the drawn card, then reveal one of your hidden cards (locks it)

### If the Draw Pile Runs Out

- Reshuffle the discard pile to form a new draw pile
- Keep the current top discard card in place

## Game End

- The round ends when all players' cards have been revealed/locked
- The number of rounds equals the number of cards dealt per player

## Scoring (Lower is Better)

### Card Values

| Card | Value |
| --- | --- |
| A | 1 |
| 2–9 | face value |
| 10 / J / Q | 10 |
| K | 0 |

### Kings (special bonuses)

| Kings | Points |
| --- | --- |
| 1 King | 0 |
| 2 Kings | −5 |
| 3 Kings | −10 |
| 4 Kings | −20 |

### Combinations (non-King, by same RANK, anywhere in layout)

Only identical ranks combine: a 10, J, and Q are different ranks even though each scores 10. Cards may match anywhere in the layout. Score groups of four first, then apply the pair/triple/single rules to any remainder:

- **Pair** (2 of same value) = 0 points for those 2 cards
- **Three of a kind** (3 of same value) = 0 points for those 3 cards; the 4th card sums normally
- **Four of a kind** (4 of same value) = −20 points bonus

#### Multiple Pairs

If you have two separate pairs (e.g., two 5s *and* two 8s), both pairs score 0.

#### No Combinations

Sum all card values normally.

## Leaderboard & Tiebreakers

- Maintain a scoring table tracking each player's score per round
- The room scoreboard totals completed rounds in the current match.
- Ranked by lowest total score; a rematch resets scores.
- **Tiebreaker:** if two or more players are tied at the end of a session, scores continue to accumulate across additional rounds until the tie is broken — the player with the lowest overall total wins

### Multiple decks

For five or more of a rank, score each complete group of four as −20, then score the remaining cards by the same rules. Five Kings score −20, six −25, seven −30, and eight −40. Five 5s score −15, six 5s −20, seven 5s −20, and eight 5s −40.

### Examples

- 5, 5, 8, K → 8 points.
- 10, J, 2, 3 → 25 points (different ranks do not cancel).
- K, K, 3, 4 → 2 points.

## Reconnection and leaving

A seat is stored in the current browser tab and survives a refresh. A second independent tab can join as another player. A duplicate connection to the same seat replaces its previous connection.

A disconnected player has 30 seconds to return. With fewer than two connected players, play pauses. The host role immediately transfers to a connected player. If someone remains online, a player absent for 30 seconds automatically leaves. Explicitly leaving a running match forfeits that seat. If fewer than two players remain, the room returns to the lobby for a new match.

Rooms are held in memory and expire when abandoned or when the server restarts. They are not durable accounts or saved games.

## Cabo house rules

- 2–8 players; four hidden cards each. Peek at the bottom two once.
- On your turn, take the discard and replace a card, or draw and place/discard/use its power.
- A = 0; 2–10 = face value; J/Q/black K = 10; red K = −1.
- Drawn 7/8: peek own card; 9/10: spy opponent; J/Q: blind swap; black K: see opponent card, then optionally swap.
- Anyone can snap a card matching the discard **rank**. Correct snaps remove it. Wrong snaps draw up to two penalty cards, limited by available cards. Snapping an opponent permits an optional card slide into their hand.
- Snaps wait during a Black King decision. A pending snap slide must be resolved before snapping again.
- Call Cabo on your turn before drawing: every other player gets one final turn. A departing player forfeits their remaining turn.
- The lowest hand (including ties) scores 0; others score their hand. A caller who is not lowest adds 5.
- When any cumulative total exceeds 100, the lowest total wins. Tied lowest totals share the win.
- The winner of the last round starts the next; tied round winners use player order.

## Goal

Get as few points as possible.
