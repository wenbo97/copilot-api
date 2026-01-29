@ECHO OFF
set ANTHROPIC_BASE_URL=http://localhost:4141
set ANTHROPIC_AUTH_TOKEN=dummy-key
set ANTHROPIC_API_KEY=dummy-key
set ANTHROPIC_MODEL=claude-opus-4.5
set ANTHROPIC_DEFAULT_SONNET_MODEL=claude-sonnet-4.5
set ANTHROPIC_DEFAULT_HAIKU_MODEL=claude-haiku-4.5
set ANTHROPIC_DEFAULT_OPUS_MODEL=claude-opus-4.5
set CLAUDE_CODE_ATTRIBUTION_HEADER=0
if not exist "c:/src/controlplane" mkdir "c:/src/controlplane"
pushd c:/src/controlplane
ECHO === Claude starting ===
ECHO === (Ctrl+C to stop Claude only) ===
cmd /k claude