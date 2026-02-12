@ECHO OFF
set ANTHROPIC_BASE_URL=http://localhost:4141
set ANTHROPIC_AUTH_TOKEN=dummy
set ANTHROPIC_MODEL=claude-opus-4-6
set ANTHROPIC_DEFAULT_SONNET_MODEL=claude-sonnet-4-5
set ANTHROPIC_SMALL_FAST_MODEL=claude-sonnet-4-5
set ANTHROPIC_DEFAULT_HAIKU_MODEL=claude-haiku-4-5
set CLAUDE_CODE_SUBAGENT_MODEL=claude-opus-4-6
set CLAUDE_CODE_ATTRIBUTION_HEADER=0
set CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1
set CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=88
set CLAUDE_CODE_EFFORT_LEVEL=high
set CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1

if not exist "c:\src\controlplane" mkdir "c:\src\controlplane"
pushd "c:\src\controlplane"
ECHO === Claude starting ===
ECHO === (Ctrl+C to stop Claude only) ===
cmd /k claude