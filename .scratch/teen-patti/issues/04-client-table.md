# Client: create options, table, actions, results

Status: done (PR feat/teen-patti)

- Create screen: "Teen Patti — bet with play coins", stake level, hands per match, side shows, blind limit.
- `TeenPattiTable`: seat panels (coins, Blind/Seen/Packed, bet this hand, card backs or own cards when seen), center strip (pot, stake, boot, hand #), Last move line.
- Action bar from `tpOptions` only (no rule logic on the client): See, Pack, Blind ×1/×2 or Chaal ×2/×4 with amounts, Show (cost), Side show; pinned on phones.
- Side-show Accept/Decline prompt; hand result dialog (winner, how, shown hands with category names, coin changes, standings, Refill, Ready); match-end standings and Play again.
- Works at 390px wide with 8 seats.
