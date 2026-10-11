#!/bin/zsh
# run-probe.sh - hands-free hotseat run of the Demographics probe mod.
#   hotseat  repro for the "Timeline crashes in multiplayer" report: hotseat-shell.js hosts a two-human
#            hotseat game and hotseat-game.js plays turns and opens Demographics > History > Timeline.
#   smoke    the same game driven by smoke-shell.js / smoke-game.js, which open every view and sub-tab;
#            also records the LocalStorage keys and sizes before and after.
# Installs the probe mod, launches the game, collects the [HS] log lines, the UI.log tail and any
# macOS crash report, then restores autosaves and removes the probe.
#   zsh run-probe.sh hotseat     # output: runs/<stamp>/
#   zsh run-probe.sh smoke
set -u
MODE="${1:-}"
case "$MODE" in
  hotseat|smoke) ;;
  *) echo "usage: zsh run-probe.sh <hotseat|smoke>"; exit 2 ;;
esac
S="$HOME/Library/Application Support/Civilization VII"
MODS="$S/Mods"
LOG="$S/Logs/UI.log"
DB="$S/Mods.sqlite"
DEST="$MODS/demographics-mp-probe"
CRASH="$HOME/Library/Logs/DiagnosticReports"
HERE="$(cd "$(dirname "$0")" && pwd)"
STAMP=$(date +%Y%m%d-%H%M%S)
RUN="$HERE/runs/$STAMP"
BAK="$RUN/backup"
LS="$S/LocalStorage.sqlite"
TIMEOUT="${TIMEOUT:-900}"
say() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$RUN/harness.txt"; }
mkdir -p "$BAK"

# LocalStorage keeps one table; dump each key with its value length.
localstorage_sizes() {
  local table
  table=$(sqlite3 "$LS" "select name from sqlite_master where type='table' limit 1")
  sqlite3 "$LS" "select key, length(value) from \"$table\"" > "$RUN/localstorage-$1.txt" 2>/dev/null || true
}

if pgrep -x CivilizationVII >/dev/null; then
  say "quitting the running game"
  pkill -TERM -x CivilizationVII
  until ! pgrep -x CivilizationVII >/dev/null; do sleep 2; done
  sleep 14
fi
for other in emig-engine-probe cultural-diffusion-probe persist-probe storage-survival-probe storage-repair-probe \
  geo-test-probe; do
  if [ -d "$MODS/$other" ]; then
    dis=$(sqlite3 "$DB" "select group_concat(ifnull(Disabled,'null')) from Mods where ModId='$other'")
    if [ "$dis" != "1" ]; then echo "Probe mod '$other' is installed and not disabled (Disabled=$dis)."; exit 1; fi
  fi
done
cp -R "$S/Saves/Single/auto" "$BAK/auto" 2>/dev/null || true
cp "$LS" "$BAK/"
ls "$CRASH" 2>/dev/null | grep -i "CivilizationVII" > "$RUN/crash-before.txt" || true
say "mode $MODE; backup -> $BAK"
[ "$MODE" = smoke ] && localstorage_sizes before

cleanup() {
  if pgrep -x CivilizationVII >/dev/null; then
    pkill -TERM -x CivilizationVII
    sleep 10
    pgrep -x CivilizationVII >/dev/null && pkill -KILL -x CivilizationVII
    sleep 3
  fi
  rm -rf "$DEST"
  sqlite3 "$DB" "delete from Mods where ModId='demographics-mp-probe'" 2>/dev/null
  if [ -d "$BAK/auto" ]; then
    rm -rf "$S/Saves/Single/auto"
    cp -R "$BAK/auto" "$S/Saves/Single/auto"
  fi
  say "probe removed; autosaves restored"
}
trap 'say "interrupted"; cleanup; exit 130' INT TERM

# The modinfo names the hotseat drivers; the smoke run installs a copy that names its own.
mkdir -p "$DEST"
cp "$HERE/hotseat-helpers.js" "$HERE/$MODE-shell.js" "$HERE/$MODE-game.js" "$DEST/"
sed -e "s/hotseat-shell\.js/$MODE-shell.js/" -e "s/hotseat-game\.js/$MODE-game.js/" \
  "$HERE/demographics-mp-probe.modinfo" > "$DEST/demographics-mp-probe.modinfo"
: > "$LOG" 2>/dev/null
open "steam://rungameid/1295660"
n=0
until pgrep -x CivilizationVII >/dev/null; do
  sleep 2
  n=$((n+1))
  if [ $n -gt 90 ]; then say "game did not start"; cleanup; exit 1; fi
done
PID=$(pgrep -x CivilizationVII | head -1)
say "pid $PID"
t=0
result=timeout
while [ $t -lt $TIMEOUT ]; do
  sleep 5
  t=$((t+5))
  if grep -q "\[HS\] DONE" "$LOG" 2>/dev/null; then result=done; break; fi
  if ! ps -p "$PID" >/dev/null; then result=exited; break; fi
done
say "result=$result after ${t}s"
sleep 30   # crash reports land 20-50 s after a crash
grep -a "\[HS\]" "$LOG" | sed 's/.*\[HS\]/[HS]/' | cut -c1-600 > "$RUN/HS.log"
grep -a "Demographics\|error\|Error" "$LOG" | grep -v "Custom CSS\|Unable to parse declaration" | tail -80 \
  > "$RUN/errors.log"
tail -60 "$LOG" > "$RUN/UI-tail.log"
cp "$LOG" "$RUN/UI.log"
ls "$CRASH" 2>/dev/null | grep -i "CivilizationVII" > "$RUN/crash-after.txt" || true
comm -13 "$RUN/crash-before.txt" "$RUN/crash-after.txt" > "$RUN/crash-new.txt"
if [ -s "$RUN/crash-new.txt" ]; then
  while read -r f; do cp "$CRASH/$f" "$RUN/"; done < "$RUN/crash-new.txt"
  say "NEW CRASH REPORT(S): $(cat "$RUN/crash-new.txt" | tr '\n' ' ')"
else
  say "no new crash report"
fi
[ "$MODE" = smoke ] && localstorage_sizes after
cleanup
say "FINISHED -> $RUN"
