# Contest release: The Card Room

Status: in-progress

## Product outcome

A new player can learn the rules before starting, invite friends, finish a match, understand the result, and replay. Golf is the lead mode; Cabo remains fully supported. Preserve the existing green-and-gold card-room style and no-account multiplayer flow.

## Owner decision

Only identical ranks form Golf combinations. A 10 and a Jack do not cancel. Updated `CARDS/GOLF_RULES.md`, the in-app guide, and regression examples accordingly.

## Implemented

- First-game walkthrough on the landing page.
- Golf/Cabo rules and how-to-play guide available from lobby, play, and results.
- Card values, rank-combination examples, powers, snaps, reconnect and leaving guidance.
- Correct lobby restoration, invite links, name entry on invite screens, connection feedback.
- Immediate peek hiding and server-enforced own-card privacy; no repeat peek on refresh.
- Mode/phase/connection checks; duplicate draws and restarting an active match rejected.
- Host transfer, disconnect grace, voluntary forfeit, reusable lobby after departures.
- Pending Black King and snap-gap state included in reconnect state.
- Cabo final-turn queue handles departures without dead turns.
- Golf tie-break rounds and defined multi-deck scoring.
- Per-hand scoring explanations and keyboard-selectable card controls.
- Native modal dialogs with focus handling; reduced-motion styles retained.
- Nine automated suites wired into CI, plus client/server production compilation.
- Reconnect timeouts retain the saved seat while retrying.

## Verification

All eight pre-existing suites and the new release regression suite passed during implementation. Final rerun results are recorded in the chat deliverable. Browser checks confirmed guide content, lobby refresh, prefilled invite joins, two-player peek, immediate card hiding, keyboard card selection, and synchronized discard swaps.

Browser testing was interrupted by an automatic approval-review usage limit. Do not describe the entire browser/device matrix as passed. Remaining release gates below are still required.

## Remaining release gates

- [ ] Finish browser playthrough of results, rematch, and help opened from results.
- [ ] Check narrow phones/tablets and eight-player layout on real or emulated devices.
- [ ] Verify a network interruption and retry in the browser.
- [ ] Deploy backend/frontend to the owner's hosting account.
- [ ] Complete a public two-device, different-network playtest.
- [ ] Capture a current gameplay cover image and prepare the final project description.
- [ ] Complete the Handshake mission and submit through its form before the official cutoff.

No public deployment or contest submission has been performed.
