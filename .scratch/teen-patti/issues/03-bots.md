# Bots for Teen Patti

Status: done (PR feat/teen-patti)

`BotSocket` gains `tpMove()`:
- Stay blind 1–2 turns at low stakes, then see.
- Strength percentile drives pack / chaal / raise, with an occasional bluff.
- Show and side-show requests with good hands; accept side shows above a bar.
- Refill when below the table minimum; Ready between hands.
- Bots learn their cards only via `tp:see` (same privacy as people).

Acceptance
- `test:bots` plays a Teen Patti match with one human and three bots for at least 5 hands, with coins conserved and no stalls.
- Bots never act while no human is connected (existing rule).
