# Kimi fork: local build + upstream sync

This fork carries the Kimi CLI provider (branch `feat/kimi-provider`) on top of
`pingdotgg/t3code`. Use this doc to:

1. Pull upstream updates without losing Kimi work
2. Rebuild the local `.dmg` after you sync
3. Open a PR back to `pingdotgg/t3code`

All commands are from the repo root. The upstream remote is named `upstream`:

```
origin    -> github.com/MCMike0399/t3code   (your fork)
upstream  -> github.com/pingdotgg/t3code    (official)
```

## 1. Pull upstream updates

```bash
# Fetch latest upstream history + tags
git fetch upstream

# Fast-forward local main to upstream/main
git checkout main
git merge --ff-only upstream/main
git push origin main

# Rebase the Kimi branch on top of the new main
git checkout feat/kimi-provider
git rebase main

# If rebase hits conflicts, resolve them and continue:
#   git rebase --continue
# If the rebase is going sideways, you can always bail:
#   git rebase --abort
```

Push the rebased branch to your fork. Because rebase rewrites history, you
need `--force-with-lease` (safer than `--force`):

```bash
git push --force-with-lease origin feat/kimi-provider
```

## 2. Rebuild the macOS app after a sync

```bash
bun install                          # in case deps changed
bun run build:desktop                # bundle server/web/electron
bun run dist:desktop:dmg:arm64       # produce the .dmg (Apple Silicon)
```

The `.dmg` lands in `apps/desktop/dist-electron/` (file name varies by
version). Open it and drag **T3 Code (Alpha).app** to `/Applications`,
replacing the previous install.

If you want to keep the official nightly installed side-by-side, edit
`apps/desktop/package.json` → `productName` to something like
`"T3 Code (Kimi)"` *before* packaging. The app will install into
`/Applications/T3 Code (Kimi).app` and not collide with the nightly.

## 3. Validate the local build

```bash
bun fmt
bun lint
bun typecheck
bun run test
```

For a live smoke test of the Kimi adapter against the real `kimi acp`
binary:

```bash
bun apps/server/scripts/kimi-smoke.ts
```

This drives one turn end-to-end and prints every `ProviderRuntimeEvent`
the adapter emits. Useful for catching upstream changes that break the
ACP event pipeline.

## 4. Open a PR to upstream

When the Kimi branch is rebased on current upstream and all checks pass:

```bash
gh pr create \
  --repo pingdotgg/t3code \
  --base main \
  --head MCMike0399:feat/kimi-provider \
  --title "feat: add Kimi CLI as an ACP provider" \
  --body-file docs/kimi-pr-body.md
```

(You'll need to push the branch to `origin` first with `git push -u
origin feat/kimi-provider`.)

## Troubleshooting

**Rebase conflicts in `packages/contracts/src/orchestration.ts`**
This file gets touched often upstream (new provider kinds, schema
tweaks). The Kimi change registers `"kimi"` as a `ProviderKind`. Keep
upstream's version and re-add `"kimi"` to the literals list.

**Tests fail after rebase with `item.updated` vs `item.started`**
The ACP tool-call lifecycle changed to emit `item.started` on the first
tool frame. Any test newly added upstream that expects `item.updated`
for a new tool call needs to accept either event type — see the pattern
in `apps/server/src/provider/Layers/CursorAdapter.test.ts`.

**`kimi acp` emits a tool call with no icon / wrong kind**
Check `apps/server/src/provider/acp/AcpRuntimeModel.ts` —
`SHELL_TITLE_PREFIX_REGEX` infers `kind: "execute"` from Kimi's
`"Shell: <cmd>"` titles. If Kimi changes its title format, extend the
regex there.
