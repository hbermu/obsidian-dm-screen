@AGENTS.md

Claude-specific notes:
- The `obsidian-dm-screen` skill (loaded from the user's `.claude/commands/`) covers Docker plumbing and the release workflow; `.agent/features/` is canonical for feature behaviour.
- Before editing files in any subsystem, read the matching `.agent/features/<feature>/overview.md` and any sub-spec files relevant to your change. Update them in the same commit.
