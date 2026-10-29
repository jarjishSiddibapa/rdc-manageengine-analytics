@AGENTS.md

# Claude Code notes

- The graphify rules and the project knowledge are in `AGENTS.md` (imported above). Keep it as the single source: edit that file, not a copy here.
- Query the graph before reading code: `graphify query "<question>"`, then `Read` only the lines it points to. Run `graphify update .` after code changes.
- Reply style for this project's user: say plainly what is done and what is not verified; list anything that needs their action (restart, password, SMTP settings) at the end.
