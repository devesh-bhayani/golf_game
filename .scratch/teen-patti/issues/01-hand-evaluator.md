# Hand evaluator and bet rules (pure functions)

Status: done (PR feat/teen-patti)

Pure, socket-free rules in `CARDS/server/src/teenpatti.ts` (owner-approved exception to the one-file rule):
- `evaluate(cards) -> { category, tiebreak[] }` and `compare(a, b) -> -1 | 0 | 1`. A-2-3 is the highest run, then A-K-Q down to 4-3-2.
- `betBounds({ seen, stake })`: blind 1×/2×, seen 2×/4×; `nextStake(bet, seen)`.
- `showCost` and `canShow`; `canSideShow`; pot-limit trim.
- Strength percentile table over all 22,100 hands, for bots.

Acceptance
- `test:tp:rank` passes: category counts 52 / 48 / 720 / 1,096 / 3,744 / 16,440; spot orderings (AAA > Q♠K♠A♠ > A-K-Q mixed > A-K-J color > A-A-K > A-K-J high); K-A-2 is not a run; A-2-3 beats A-K-Q in both pure and plain sequences.
- `teenpatti.ts` compiles into the prod build (it is not a test file); the rank test is excluded in `tsconfig.json`; prod `tsc` passes.
