# Server: Teen Patti mode, betting engine, play coins

Status: done (PR feat/teen-patti)

- `'teenpatti'` mode; `sanitizeConfig` whitelists the room options (stakes, hands, side show, blind limit, A-2-3).
- `tp*` state, deal (boot from every seat with ≥ pot-limit coins; others sit out), dealer rotation.
- Handlers `tp:see`, `tp:bet`, `tp:pack`, `tp:show`, `tp:sideShow`, `tp:sideShowAnswer`, `tp:refill`, `tp:ackNextHand`, `tp:ackRematch`. They follow the existing handler shape and end with `broadcastSnapshot`; they're gated in the middleware like `cabo:`.
- Hand end: last player standing / show (payer loses ties) / side show (requester loses ties) / pot-limit forced show (split ties).
- `tpOptions` (legal moves + costs) for the turn player in `game:private`; blind players get no cards until `tp:see`.
- Public snapshot block `tp`: seats (coins, status, bet this hand), pot, stake, boot, dealer, turn, hand number, pending side show (names only), last result (only shown hands).
- `logAction` lines for every move; `removePlayer`/disconnect/kick mid-hand.

Acceptance (`test:tp`, stacked decks via `TEST_HOOKS`)
- Bet bounds and stake updates; seen-vs-blind show refused; show cost and tie rule; side show accept/decline/tie; pot-limit trim + forced show + split.
- Coin conservation (coins + pot = issued) checked after every action.
- Privacy: blind player's private state has no cards; snapshots never contain unshown or packed cards; side-show cards reach only the two players.
- Refill only between hands and only below the table minimum; leaving mid-hand keeps the pot intact and passes the turn.
