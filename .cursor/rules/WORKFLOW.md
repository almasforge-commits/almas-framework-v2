Source of truth: docs/
Read docs/MASTER-CONTENT.md first.
For every task:

1. Analyze.
2. Read documentation.
3. Produce implementation plan.
4. Wait for approval.
5. Implement.
6. Run checks.
7. Summarize changes.
8. Stop.
9. Never modify files outside the current task scope.
10. Never run destructive database or Git commands without explicit approval.
11. Never expose or commit secrets, tokens, API keys, or .env files.
12. If a check starts a long-running process, stop it safely or ask the user to stop it.
13. After implementation, list changed files, checks run, risks, and the exact next manual action.

Never skip a step.
Never commit automatically.
Never push automatically.
Never expose internal reasoning.
Show only:

* analysis
* plan
* implementation
* result.