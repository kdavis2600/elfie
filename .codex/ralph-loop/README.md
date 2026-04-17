# Ralph In This Repo

The `ralph-wiggum-codex` skill is already installed globally at:

- `/Users/kizzle/.codex/skills/ralph-wiggum-codex`

This directory provides the repo-backed state files Ralph expects.

Start command:

```bash
~/.codex/skills/ralph-wiggum-codex/scripts/ralph-loop-codex.sh \
  --cwd /Users/kizzle/aicoding/elfie \
  --objective-file /Users/kizzle/aicoding/elfie/.codex/ralph-loop/objective.md \
  --acceptance-file /Users/kizzle/aicoding/elfie/.codex/ralph-loop/acceptance-criteria.md \
  --feedback-file /Users/kizzle/aicoding/elfie/.codex/ralph-loop/feedback.md \
  --max-iterations 40 \
  --max-stagnant-iterations 6 \
  --progress-scope "app/" \
  --progress-scope "src/" \
  --progress-scope "server/" \
  --progress-scope ".codex/ralph-loop/" \
  --idle-timeout-seconds 900 \
  --hard-timeout-seconds 14400
```

Resume command:

```bash
~/.codex/skills/ralph-wiggum-codex/scripts/ralph-loop-codex.sh \
  --cwd /Users/kizzle/aicoding/elfie \
  --resume
```

Safe stop:

```bash
touch /Users/kizzle/aicoding/elfie/.codex/ralph-loop/STOP
```
