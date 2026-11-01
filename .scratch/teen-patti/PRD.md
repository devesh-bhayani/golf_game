# Teen Patti with play coins

Status: ready-for-agent (house rules agreed 2026-11-01, see Decisions)

## Outcome

A third game in The Card Room. 2–8 people (or bots) play Teen Patti from one invite link, betting **play coins**: free, worthless, reset with the room. Same server-authoritative design as Golf and Cabo: the server owns every rule, deals, checks bets, and never sends a card to anyone who isn't allowed to see it.

## Rules (house rules v1)

Researched from pagat.com, Wikipedia, gamerules.com, Bhoos and Zigya (links at the bottom). The sources agree on everything below except the items marked **[house rule]**. A-2-3 is fixed to our family rule. Side shows and the blind limit are room options with the defaults shown.

### Setup
- One standard 52-card deck, no jokers. 2–8 players (8 × 3 = 24 cards).
- Each hand: every seated player pays the **boot** (ante) into the pot, then gets 3 cards face down.
- The dealer moves one seat clockwise each hand. The player after the dealer acts first; play goes clockwise.

### Hand ranking (high to low)

| Hand | Example | Ways to make it | Chance |
| --- | --- | --- | --- |
| Trail (trio) | A A A | 52 | 0.24% |
| Pure sequence (straight flush) | Q♠ K♠ A♠ | 48 | 0.22% |
| Sequence (straight) | 4♦ 5♣ 6♥ | 720 | 3.26% |
| Color (flush) | 2♥ 7♥ J♥ | 1,096 | 4.96% |
| Pair | 9 9 K | 3,744 | 16.94% |
| High card | A 10 4 | 16,440 | 74.39% |

22,100 possible hands (verified by enumeration). Any higher category beats any lower one.

Within a category:
- **Trail:** higher rank wins (AAA best, 222 worst).
- **Sequences:** **A-2-3 is the highest run**, then A-K-Q, K-Q-J … down to 4-3-2 (our house rule, as on pagat; Wikipedia ranks it second). K-A-2 does not count. Same order for pure sequences and plain sequences.
- **Color / High card:** compare highest card, then middle, then lowest.
- **Pair:** compare the pair, then the odd card.
- Suits never rank. Identical hands tie (see Ties).

### Blind and seen
- Everyone starts **blind**. A blind player may **See cards** at any time; once seen, always seen.
- **Current stake** starts at the boot.
- Blind player's bet: **1× or 2× the stake**. Afterwards the stake becomes that bet.
- Seen player's bet (**chaal**): **2× or 4× the stake**. Afterwards the stake becomes half that bet.
- Two buttons per state (min, double), so every amount stays a whole multiple of the boot.
- **Pack** (fold) any time it's your turn. Coins already bet stay in the pot.
- **[house rule] Blind limit:** off by default; optionally a player must see after 3 or 4 blind turns.

### Show (two players left)
- A **blind** player can ask for a show against anyone by paying **1× the stake**.
- A **seen** player can ask only if the other player is also seen, paying **2× the stake**. A seen player cannot force a show against a blind player.
- Both hands are revealed to the table and the higher hand wins.
- **Tie:** the player who did **not** pay for the show wins (pagat, Zigya).

### Side show (three or more players left)
- On your turn, if you **and the previous active player** are both seen, you may bet the seen minimum (2× stake) and ask that player for a side show.
- They **accept** or **decline**. Declined: play continues with the next player.
- Accepted: the two hands are compared **privately**; only those two see each other's cards. The lower hand packs. **Tie:** the requester packs.
- **[house rule] Side shows:** on by default; host can turn them off.
- Disconnected or bot targets answer automatically (disconnected = decline).

### Pot limit and forced show
- **Pot limit:** default **32× boot**. A bet that would take the pot past the limit is trimmed to fit. Then every remaining hand is revealed and the best one wins.
- **Tie in a forced show:** the tied best hands split the pot (odd coin to the first tied player after the dealer).

### End of a hand
- Last player standing wins the pot without showing.
- The result panel shows who won and how (everyone packed / show / pot limit), the hands that were shown, and every player's coin change. Everyone presses Ready. Bots are ready instantly.

## Play coins

- **Not money.** No buying, no cash-out, no transfers, nothing persists after the room closes. The UI says "play coins" everywhere and the rules guide states it plainly.
- **Default stakes:** start 10,000 coins, boot 100, pot limit 3,200. The host picks a stake level when creating the room.
- **No all-ins or side pots.** Nobody can put more than the pot limit into a single hand. So a player needs at least the pot limit in coins to be dealt in, and is then always able to pay. Below it, you sit out until you tap **Refill** (free, back to the starting amount, between hands). This keeps the betting rules simple and identical for everyone.
- **Standings:** coins, plus *net* = coins − starting stack − refills. Shown between hands and at match end.
- **Match length:** host picks 10 / 20 / unlimited hands. At the end: winner by net coins, then "Play again" resets coins.
- **Persistence:** none in v1. Coins live in the room, like everything else (in-memory server, no database by design). A saved wallet across visits would need accounts or a database. See decision 3.
- **Invariant (tested):** sum of all coins + pot = coins issued (starting stacks + refills), at every step.

## How it fits the codebase

### Server (`CARDS/server/src/index.ts` for handlers, `CARDS/server/src/teenpatti.ts` for pure rules)
- `GameMode` gains `'teenpatti'`. `sanitizeConfig` accepts `tpStakes`, `tpHands`, `tpSideShow`, `tpBlindLimit` (whitelisted, clamped).
- New state on `GameState` (prefixed `tp`, like the `cabo*` fields): coins, hands, seen/packed sets, per-hand contributions, pot, stake, dealer and turn index, blind-turn counts, a pending side show, last hand result, hand number, refills.
- Events (`tp:` prefix, mode-gated in the middleware, turn-gated like Cabo):
  `tp:see`, `tp:bet {double: boolean}`, `tp:pack`, `tp:show`, `tp:sideShow`, `tp:sideShowAnswer {accept}`, `tp:refill`, `tp:ackNextHand`, `tp:ackRematch`.
- The server computes the turn player's legal moves and costs (`tpOptions` in `game:private`), so the client never works out a rule.
- Every mutation logs a public `lastAction`: "Bot Ada raised to 400 (seen)", "Alex asked Bot Rex for a side show — declined". These lines never name a hidden card.
- `removePlayer` / disconnect / kick handle a player leaving mid-hand: their coins in the pot stay, and the turn or side show moves on.

### Privacy (the important part)
- **A blind player's own cards are not sent to them** until they press See. A browser can't peek, so blind betting stays honest.
- The public snapshot carries coins, blind/seen/packed status, bets, pot, stake and turn only. It never carries cards, except hands revealed in a show or forced show.
- Side-show cards go only to the two players involved, through private events.
- Packed hands are never revealed.

### Bots
Bots keep using the `BotSocket`, so they get the same privacy as people. Strategy:
- Hand strength = the hand's percentile among all 22,100 hands (precomputed at startup).
- Stay blind for 1–2 turns at low stakes, then see.
- Pack weak hands as the stake climbs. Chaal with middling hands. Raise (4×) with strong ones, and bluff-raise occasionally.
- Ask for a show or side show with good hands; accept side shows above a strength bar.
- Always refill when below the table minimum, so bots never stall a room.

### Client (`App.tsx`)
- **Create screen:** "Teen Patti — bet with play coins" plus the room options.
- **Table:** a seat panel per player (name, coins, Blind/Seen/Packed, bet this hand, 3 card backs, your own cards once seen), a center strip (pot, stake, boot, hand number), and the "Last move" line.
- **Action bar:** pinned on phones like the other games. Buttons for See cards, Pack, Blind ×1/×2 or Chaal ×2/×4 (with the coin amounts), Show (with cost), and Side show (when allowed).
- **Side-show prompt** for the asked player: Accept / Decline.
- **Hand result dialog:** winner, how, revealed hands with category names, coin changes, standings, Refill and Ready.
- **Rules guide:** a third tab with the ranking table and odds, blind vs seen, show, side show, and "play coins only".

### Tests (all wired into CI)
- `test:tp:rank`: the evaluator produces exactly the counts in the table across all 22,100 hands; ordering spot checks, including A-2-3 above A-K-Q.
- `test:tp`: stacked decks via `TEST_HOOKS`. Covers:
  - bet bounds and stake updates for blind and seen
  - who may show, its cost, and the payer-loses tie
  - side show accept, decline and tie
  - pot-limit trim, forced show and split
  - refill and sit-out
  - coin conservation after every action
  - privacy (a blind player's private state has no cards; snapshots never carry unshown or packed cards; side-show cards reach only the pair)
  - a player leaving mid-hand
- `test:bots` gains a Teen Patti match with bots finishing several hands.
- A browser playtest (desktop and phone) before release, like the last change.

## Out of scope for v1
- Variants: Muflis/lowball, AK47, Joker or wild cards, dealer's choice.
- Accounts, saved wallets, leaderboards across rooms.
- Turn timers. The room relies on the existing disconnect grace and kick, as in Golf and Cabo.
- Anything resembling real money.

## Decisions (agreed with the owner, 2026-11-01)
1. **A-2-3 sequence ranks highest**, above A-K-Q (fixed, not an option).
2. **Side shows on**; the host can switch them off for a room.
3. **Coins are per room** and reset each match. Nothing is saved between visits.
4. **Pure rules live in `CARDS/server/src/teenpatti.ts`** (hand evaluator, bet bounds, strength table). This is an explicit exception to the one-server-file rule. Socket handlers stay in `index.ts`.

## Sources
- [Pagat — Teen Patti](https://pagat.com/vying/teen_patti.html)
- [Wikipedia — Teen patti](https://en.wikipedia.org/wiki/Teen_patti)
- [gamerules.com — Teen Patti](https://gamerules.com/rules/teen-patti-card-game/)
- [Bhoos — How to play Teen Patti](https://bhoos.com/blog/how-to-play-teen-patti-rules-strategies-and-tips)
- [Zigya — 3 Patti rules guide](https://www.zigya.com/blog/3-patti-rules-complete-guide)
