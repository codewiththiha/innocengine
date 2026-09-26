# AGENTS.md

Working rules for anyone — human or agent — changing this repository. They exist
because the history and the diff are read far more often than they are written.
The plan itself is [`PLAN.md`](PLAN.md).

## Code quality

- Prefer clear names and small, ownership-focused types.
- Comments explain *why*: an invariant, a non-obvious constraint, a lifecycle
  rule, the reference behaviour being ported. Nothing else.
- **Comment budget.** A module doc is one short paragraph. An item doc is one to
  three lines. An inline comment is one or two, and only where the code cannot
  say it itself. No design essays, no narration of the next line, no arguing
  with alternatives the code does not contain. Delete a comment when the code it
  described moves or goes away.
- No speculative abstraction "for later use". Build the contracts the current
  increment can actually exercise.
- No optional fields where the domain guarantees presence. Prefer
  compiler-enforced invariants over defensive runtime branching.
- Never swallow an error merely to keep a superseded path alive.
- Logging stays useful: no per-move, per-evaluation or per-scroll logs in ordinary
  operation.
- No error context that only restates the underlying error.
- **Thread boundaries.** Heavy computation (WASM engine execution, deep FEN parsing) 
  belongs in a Web Worker. The Content Script main thread is strictly for DOM 
  observation and SVG rendering. Never block the UI thread.
- **Message contracts.** Communication between Popup, Background, Content, and 
  Worker must use strongly typed message routers. No untyped `postMessage` payloads.
- **DOM resilience.** Target sites obfuscate classes. Selectors must rely on 
  stable attributes (e.g., custom elements, coordinate transforms) or fail loudly. 
  Never silently guess the board state.
- **Overlay isolation.** Injected SVGs or Canvases must enforce `pointer-events: none` 
  and strictly bounded `z-index` to prevent hijacking user clicks on the actual board.

## Change discipline

- Keep the change coherent inside the current phase and increment.
- No pile of dead scaffolding in anticipation of later phases.
- When a new implementation becomes authoritative, delete the old one or reduce
  it to a clearly time-bounded compatibility adapter. Never leave an unused copy
  of the production implementation in the tree.
- **Permission minimalism.** Manifest permissions and `host_permissions` must be 
  strictly limited to what the current increment requires. Never request 
  `<all_urls>` or broad host permissions "just in case".
- **Asset hygiene.** Do not commit unused WASM builds, uncompressed engine binaries, 
  or dead icon assets. Keep the extension package size minimal and deliberate.

## Definition of done

An increment is done only when:

- the new path is exercised by production code;
- the old path is no longer the authority;
- the requested behaviour still works, and is visually checkable on the day;
- affected tests pass and every CI lane is green;
- stale call sites were searched for and removed;
- lifecycle and ownership are documented where they are not obvious;
- no unexplained fallback remains;
- the extension loads in `chrome://extensions` with zero Manifest V3 warnings or errors;
- memory and thread leaks are verified absent (e.g., `MutationObserver` disconnects, 
  Web Workers terminate on navigation/unmount).

If a criterion cannot be met, report the concrete blocker. Do not silently
revert to the legacy implementation.

## Commit messages

Conventional Commits, one coherent change per commit.

### Subject

```text
<type>[optional scope]: <description>
```

- Exactly one line, with `: ` after the type or scope; imperative, present
  tense; lowercase description unless a proper noun requires otherwise; no
  trailing period.
- **Hard limit: 72 characters**, counting the whole line — type, scope, spaces,
  punctuation. **Prefer ≤ 50.** Do not stretch a subject toward 72 for detail,
  and never cut one mid-word to fit.
- Describe *what changed*. Why it changed, how it works and what was tested
  belong in the body.

| type       | use                                          |
| ---------- | -------------------------------------------- |
| `feat`     | new user-visible functionality               |
| `fix`      | bug correction                               |
| `perf`     | performance or memory improvement            |
| `refactor` | structural change, no intended behaviour change |
| `docs`     | documentation only                           |
| `test`     | tests or test infrastructure                 |
| `ci`       | CI workflow or check changes                 |
| `build`    | build, dependency or toolchain changes       |
| `chore`    | maintenance that fits nothing else           |

A scope is optional and uses repository terms — `content`, `worker`, `popup`,
`overlay`, `wasm`, `uci`, `manifest`, `ci`, `docs` —
kept short: `fix(content):`, not `fix(chess-dom-observer-lifecycle):`.

Breaking changes use the Conventional Commits syntax:

```text
feat(worker)!: replace the global engine session

BREAKING CHANGE: callers must create an explicit engine session.
```

A subject is never a progress report (`phase 2 complete`, `final fixes`) and
never an implementation essay. A phase number may appear in the scope when it
helps a search — `docs(phase-2): record the baseline` — never as the
description.

```text
feat(overlay): draw best move arrow via SVG
fix(content): disconnect observer on tab navigation
perf(worker): offload FEN parsing from main thread
refactor(uci): isolate message router contracts
docs(manifest): document host permission rationale
test(wasm): cover single-threaded engine initialization
ci: run the extension lint and build gate
```

### Body

Optional, and exactly one blank line after the subject. Wrap lines near 72
columns. Say why the change was made, the constraint that shaped it, and what
was checked.

### Verify, every commit

Count the complete subject — spaces and punctuation included — before
committing:

```bash
node -e 'const s=process.argv[1]; const n=[...s].length; console.log(`${n}/72`); if (n>72) process.exit(1)' "feat(overlay): draw best move arrow via SVG"
```

Then confirm what actually landed:

```bash
git log -1 --pretty=%s
```

A commit is not correctly formatted because the command that created it looked
correct.
