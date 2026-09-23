#!/bin/zsh
# run-hs.sh - hands-free HOTSEAT repro for the "Timeline crashes in multiplayer" report.
# Installs the probe mod, launches the game, lets hs-shell.js host a two-human hotseat game and
# hs-game.js play turns and open Demographics > History > Timeline, then collects the [HS] log
# lines, the UI.log tail and any macOS crash report. Restores autosaves and removes the probe.
#   zsh run-hs.sh            # output: runs/<stamp>/
set -u
S="$HOME/Library/Application Support/Civilization VII"
MODS="$S/Mods"; LOG="$S/Logs/UI.log"; DB="$S/Mods.sqlite"; DEST="$MODS/demographics-mp-probe"
CRASH="$HOME/Library/Logs/DiagnosticReports"
HERE="$(cd "$(dirname "$0")" && pwd)"
STAMP=$(date +%Y%m%d-%H%M%S); RUN="$HERE/runs/$STAMP"; BAK="$RUN/backup"
TIMEOUT="${TIMEOUT:-900}"
say() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$RUN/harness.txt"; }
mkdir -p "$BAK"

if pgrep -x CivilizationVII >/dev/null; then say "quitting the running game"; pkill -TERM -x CivilizationVII; until ! pgrep -x CivilizationVII >/dev/null; do sleep 2; done; sleep 14; fi
for other in emig-engine-probe cultural-diffusion-probe persist-probe storage-survival-probe storage-repair-probe geo-test-probe; do
  if [ -d "$MODS/$other" ]; then
    dis=$(sqlite3 "$DB" "select group_concat(ifnull(Disabled,'null')) from Mods where ModId='$other'")
    if [ "$dis" != "1" ]; then echo "Probe mod '$other' is installed and not disabled (Disabled=$dis)."; exit 1; fi
  fi
done
cp -R "$S/Saves/Single/auto" "$BAK/auto" 2>/dev/null || true
cp "$S/LocalStorage.sqlite" "$BAK/"
ls "$CRASH" 2>/dev/null | grep -i "CivilizationVII" > "$RUN/crash-before.txt" || true
say "backup -> $BAK"

cleanup() {
  pgrep -x CivilizationVII >/dev/null && { pkill -TERM -x CivilizationVII; sleep 10; pgrep -x CivilizationVII >/dev/null && pkill -KILL -x CivilizationVII; sleep 3; }
  rm -rf "$DEST"
  sqlite3 "$DB" "delete from Mods where ModId='demographics-mp-probe'" 2>/dev/null
  if [ -d "$BAK/auto" ]; then rm -rf "$S/Saves/Single/auto"; cp -R "$BAK/auto" "$S/Saves/Single/auto"; fi
  say "probe removed; autosaves restored"
}
trap 'say "interrupted"; cleanup; exit 130' INT TERM

mkdir -p "$DEST"
cp "$HERE/demographics-mp-probe.modinfo" "$HERE/hs-shell.js" "$HERE/hs-game.js" "$DEST/"
: > "$LOG" 2>/dev/null
open "steam://rungameid/1295660"
n=0; until pgrep -x CivilizationVII >/dev/null; do sleep 2; n=$((n+1)); if [ $n -gt 90 ]; then say "game did not start"; cleanup; exit 1; fi; done
PID=$(pgrep -x CivilizationVII | head -1); say "pid $PID"
t=0; result=timeout
while [ $t -lt $TIMEOUT ]; do
  sleep 5; t=$((t+5))
  if grep -q "\[HS\] DONE" "$LOG" 2>/dev/null; then result=done; break; fi
  if ! ps -p "$PID" >/dev/null; then result=exited; break; fi
done
say "result=$result after ${t}s"
sleep 30   # crash reports land 20-50 s after a crash
grep -a "\[HS\]" "$LOG" | sed 's/.*\[HS\]/[HS]/' | cut -c1-600 > "$RUN/HS.log"
grep -a "Demographics\|error\|Error" "$LOG" | grep -v "Custom CSS\|Unable to parse declaration" | tail -80 > "$RUN/errors.log"
tail -60 "$LOG" > "$RUN/UI-tail.log"
cp "$LOG" "$RUN/UI.log"
ls "$CRASH" 2>/dev/null | grep -i "CivilizationVII" > "$RUN/crash-after.txt" || true
comm -13 "$RUN/crash-before.txt" "$RUN/crash-after.txt" > "$RUN/crash-new.txt"
if [ -s "$RUN/crash-new.txt" ]; then while read -r f; do cp "$CRASH/$f" "$RUN/"; done < "$RUN/crash-new.txt"; say "NEW CRASH REPORT(S): $(cat "$RUN/crash-new.txt" | tr '\n' ' ')"; else say "no new crash report"; fi
cleanup
say "FINISHED -> $RUN"
