#!/usr/bin/env bash
# Deterministic HUB.md mechanical refresh (no LLM). Regenerates the <!-- auto:clog --> block
# with the latest daily clog link. Run by the hub-mechanical GitHub Action on push.
set -euo pipefail
HUB=HUB.md
[ -f "$HUB" ] || { echo "no HUB.md"; exit 0; }
CLOGDIR=""
for d in src/clog clog; do [ -d "$d" ] && { CLOGDIR="$d"; break; }; done
[ -n "$CLOGDIR" ] || { echo "no clog dir"; exit 0; }
# latest daily log by DDMMYY-in-name (convert to YYMMDD for correct chronological order)
LATEST=$(
  for f in "$CLOGDIR"/[0-9]*.md; do
    [ -f "$f" ] || continue
    b=$(basename "$f" .md)
    [ ${#b} -eq 6 ] || continue
    printf '%s\t%s\n' "${b:4:2}${b:2:2}${b:0:2}" "$f"
  done | sort | tail -1 | cut -f2
)
[ -n "$LATEST" ] || { echo "no dated clog"; exit 0; }
REPL="[$CLOGDIR/]($CLOGDIR/) — latest [$(basename "$LATEST")]($LATEST)"
REPL="$REPL" perl -0pi -e 's{<!-- auto:clog -->.*?<!-- /auto:clog -->}{<!-- auto:clog -->$ENV{REPL}<!-- /auto:clog -->}s' "$HUB"
echo "auto:clog -> $LATEST"
