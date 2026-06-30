# AGENTS.md

## Mission

Move the project forward with very high reliability.

This is a fragile browser-based Three.js game. Work must be careful, small, reversible, and tested. The main failure to avoid is a loop where one fix breaks another system, then the next turn repairs the new break instead of making progress.

Aim for 99% accuracy in the working process: verify facts, avoid guesses, and prefer no code change over a risky unproven change.

## Hard Rules

- Do not rewrite the project.
- Do not refactor unless the user explicitly asks.
- Do not make broad cleanup changes.
- Do not change unrelated systems.
- Do not edit maps, saves, localStorage keys, or generated files unless the user explicitly asks.
- Do not add libraries, frameworks, build tools, or new architecture.
- Do not hide bugs with fallbacks that only mask symptoms.
- Do not increase per-frame work unless performance has been measured first.
- Do not claim something is fixed unless it was tested.
- Do not make a change if the cause is not understood.
- Do not edit while angry/frustration is high unless the change is rollback, rules, or diagnosis only.

## Work Order

Every task must follow this order:

1. Identify the exact requested change or bug.
2. Check current repo status.
3. Identify the smallest likely file/function responsible.
4. State what must not be touched.
5. Reproduce or inspect the issue before editing when possible.
6. Make one small change.
7. Test the exact same scenario again.
8. If it fails, lags, freezes, or creates a regression, roll back that change immediately.
9. Report the result and the next safe action.

Skip no steps for runtime bugs.

## Accuracy Gate

Before changing code, there must be evidence for the cause.

Accepted evidence includes:

- reproduced browser behavior
- browser console error
- measured object/entity count
- measured CPU/FPS/performance signal
- exact code path showing the bug
- data file proving wrong input
- git diff proving a regression source

Not accepted:

- guessing
- changing several possible causes at once
- adding fallback logic because it "might help"
- changing performance settings without measurement

## No Loop Rule

If a fix creates a new bug, the next action is rollback, not another patch on top.

If two attempts fail:

- stop editing
- keep or restore the last known good state
- write what is known
- write what is unknown
- write the single safest next test

Do not continue stacking changes.

## One-Variable Rule

Only change one behavior at a time.

Bad:

- changing spawning, collision, cache tags, and performance in one pass

Good:

- prove spawning failed, patch spawning only, test spawning only

If more than one behavior must change, split it into separate commits or separate turns.

## Patch Size

- Prefer one-file changes.
- Normal bug fixes should be under about 50 changed lines.
- If more than 2 files are needed, explain why before editing.
- Change imports/cache tags only when duplicate module loading is proven.
- Change gameplay constants only when the current value is proven wrong.

## Performance Rule

Lag, page unresponsive dialogs, high CPU, high GPU, and browser freezing are priority bugs.

When performance is bad:

- stop feature work
- do not add active entities
- do not add loops, timers, raycasts, collision scans, or per-frame allocations
- check console errors first
- check duplicate render loops
- check duplicate module imports
- check object counts
- check zombie/enemy counts
- check model loading loops
- check collision loops
- prefer rollback over workaround

A performance fix is done only when Chrome stays responsive in the tested scenario.

## Browser Testing

For game changes, test in Chrome whenever possible.

Required checks:

- page loads
- WebGL scene renders
- no new browser console errors
- player movement still works
- settings still opens
- minimap/HUD still appears if relevant
- FPS/performance is not worse
- the reported bug is fixed

If browser testing is unavailable, say exactly what was checked instead.

## Rollback Safety

Before risky edits:

- confirm current `git status`
- prefer a stash or clean commit boundary
- know the exact file(s) to revert

Never leave the project in a worse state at the end of the turn.

## Baseline Rule

Before new work after a regression:

- reset or confirm last known good state
- clear browser cache or use Incognito when testing
- confirm whether localStorage/save data affects the result
- record the exact URL/map used for testing

Do not debug from a stale Chrome tab.

## Communication

Be direct and action-focused.

- Do not spend the answer on excuses.
- Do not over-explain unless asked.
- Say what changed, what was tested, and what remains.
- If blocked, give the next exact command/test/action.

## Final Response Format

After coding, respond with:

1. Summary
2. Changed files
3. What was fixed
4. What was not changed
5. Tests/checks performed
6. Known risks
