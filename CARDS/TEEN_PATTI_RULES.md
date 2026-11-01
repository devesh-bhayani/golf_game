# Teen Patti — house rules

These are the rules the server enforces (`CARDS/server/src/teenpatti.ts` for ranking and bet math, the Teen Patti section of `index.ts` for the hand lifecycle). Change them together.

Teen Patti here uses **play coins only**. Coins cannot be bought, sold, or cashed out, and they reset every match.

## Setup

- 2–8 players, one 52-card deck, three cards each, face down.
- The host picks the stakes when creating the room:

| Stakes | Boot | Starting coins | Pot limit (32 boots) |
|---|---|---|---|
| Low | 10 | 1,000 | 320 |
| Medium (default) | 100 | 10,000 | 3,200 |
| High | 1,000 | 100,000 | 32,000 |

- Other options: hands per match (10, 20, or unlimited; default 10), side shows (on by default), blind limit (none, 3, or 4 blind bets; default none).

## A hand

1. **Boot.** Every player dealt in puts one boot into the pot. The **stake** starts at one boot.
2. **Dealer.** The dealer button moves one seat clockwise each hand. The player after the dealer acts first; play goes clockwise.
3. **Blind or seen.** Everyone starts blind. A player can look at their cards at any time (`See cards`); after that they are *seen* for the rest of the hand. Blind players receive no card values from the server at all.
4. **Betting on your turn.**
   - Blind: bet 1× or 2× the stake. The stake becomes the amount bet.
   - Seen (chaal): bet 2× or 4× the stake. The stake becomes half the amount bet.
   - **Pack** (fold) at any time on your turn. Coins already bet stay in the pot.
   - **Blind limit** (if set): after that many blind bets you must look before betting again.
5. **Show** — only when two players are left.
   - A blind player pays 1× the stake. A seen player pays 2×, and only if the other player is also seen (a seen player cannot force a show against a blind one).
   - Both hands are revealed. The higher hand takes the pot. **A tie goes against the player who paid for the show.**
6. **Side show** — only with three or more players left, and only if the host left side shows on.
   - A seen player bets the minimum chaal (2× the stake) and asks the previous active player, who must also be seen.
   - The asked player accepts or declines. On accept, the two hands are compared privately (only those two see both hands); the lower hand packs, and **a tie packs the asker**. On decline, play continues with the next player.
   - A disconnected target declines automatically.
7. **Last player standing** takes the pot when everyone else has packed. Nothing is revealed.
8. **Pot limit.** When the pot reaches 32 boots, the bet that crosses it is trimmed to land exactly on the limit, then every remaining hand is shown. The best hand wins; **exact ties split the pot** (odd coins go to the winners closest to the dealer's left).

## Hand ranking (best first)

| Hand | Example | Combinations (of 22,100) |
|---|---|---|
| Trail (three of a kind) | A A A | 52 (0.24%) |
| Pure sequence (run in one suit) | Q♠ K♠ A♠ | 48 (0.22%) |
| Sequence (run) | 4♦ 5♣ 6♥ | 720 (3.26%) |
| Color (one suit) | 2♥ 7♥ J♥ | 1,096 (4.96%) |
| Pair | 9 9 K | 3,744 (16.94%) |
| High card | A 10 4 | 16,440 (74.39%) |

Within a category:

- **Trails** compare rank: A A A is best, 2 2 2 lowest.
- **Runs** (pure or not): **A-2-3 is the highest run** (our house rule), then A-K-Q, K-Q-J, … down to 4-3-2. K-A-2 is not a run.
- **Colors and high cards** compare the highest card, then the next, then the last.
- **Pairs** compare the pair, then the odd card.
- **Suits never rank.** Identical ranks tie.

## Coins and standings

- Everyone starts the match with the stake level's starting coins (100 boots).
- You need at least the pot limit (32 boots) to be dealt into a hand. That rule means nobody can run out of coins mid-hand, so there are no all-ins or side pots.
- Below that, you sit out until you **refill**: free, any time you are not in a hand, back up to the starting amount. Bots refill on their own.
- **Net** = coins held − (starting coins + every refill top-up). Standings and the end-of-match leaderboard rank by net. Refills are counted and shown, never hidden.
- A match ends after the chosen number of hands (unlimited matches run until players leave). *Play again* starts a fresh match with fresh coins.

## Privacy

- The public snapshot shows seats, coins, bets, blind/seen/packed status, the pot and the stake — never a card until a show, a pot-limit show, or the hand result reveals it.
- Your own cards reach you only after you see them (or after the hand ends).
- Side-show hands go only to the two players involved.
