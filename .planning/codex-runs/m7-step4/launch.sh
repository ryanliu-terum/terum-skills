#!/bin/zsh
# Step 4 driver: launch the built app against a HOME, watch its CLI children, quit it, report orphans.
# Usage: launch.sh <app-binary> <HOME> <label> [seconds=45]
BIN=$1; H=$2; LABEL=$3; SECS=${4:-45}; S4=/Users/ryanliu/Documents/Terum/m7-step4; LOG=$S4/launch-$LABEL.log
: > $LOG
echo "launch $(date -u) HOME=$H" >> $LOG
HOME=$H nohup "$BIN" >> $S4/app-$LABEL.stdout.log 2>> $S4/app-$LABEL.stderr.log &
PID=$!; echo "app pid $PID" >> $LOG
for i in $(seq 1 $SECS); do
  sleep 1
  if ! kill -0 $PID 2>/dev/null; then echo "t=${i}s app EXITED early" >> $LOG; break; fi
  KIDS=$(pgrep -P $PID | tr '\n' ' ')
  if [ -n "$KIDS" ]; then echo "t=${i}s children: $(ps -o pid=,command= -p ${=KIDS} 2>/dev/null | cut -c1-140 | tr '\n' '|')" >> $LOG; fi
done
kill -0 $PID 2>/dev/null && echo "t=${SECS}s app still up" >> $LOG
echo "quit $(date -u)" >> $LOG; kill -TERM $PID 2>/dev/null; sleep 3
kill -0 $PID 2>/dev/null && { echo "app did not exit on TERM; KILL" >> $LOG; kill -KILL $PID; sleep 1; }
ORPHANS=$(pgrep -fl "dist/index.js" | grep -v launch.sh | cut -c1-140)
echo "orphaned CLI children after quit: ${ORPHANS:-none}" >> $LOG
echo "app stderr lines: $(wc -l < $S4/app-$LABEL.stderr.log)" >> $LOG
cat $LOG
