#!/usr/bin/env bash
# Unattended "more data, retrain everything" run. From the repo root:
#   bash scripts/overnight.sh 2026-11-01 2026-11-11
# 1. imports every day in the range for all prediction airports (already-imported
#    airport/days are skipped), 2. rebuilds datasets and retrains each airport's
#    landing-time, runway and arrival ("is it landing here?") models, 3. retrains the
#    global model, 4. re-scores the landing detector against OpenSky, 5. scores the
#    live predictions in the logs, 6. re-runs the analysis (time lost, scheduler,
#    transfer controller) and re-exports the Results page data. Each script only saves
#    at the end, so a failed step leaves the previous model in place. Log: data/overnight.log
# The live server only loads models at startup: restart it afterwards to use them.
# Resume an interrupted run by naming the first step still to do, e.g.
#   FROM=KJFK:runway bash scripts/overnight.sh 2026-10-18 2026-11-19
# Steps: import, <ICAO>:dataset|eta|runway|arrival, global, validate, score, analysis.
cd "$(dirname "$0")/.." || exit 1
LOG=data/overnight.log
start=${1:?start date}; end=${2:?end date}
say() { echo "[$(date '+%H:%M')] $*" | tee -a "$LOG"; }
# step NAME: true once the run has reached $FROM (always true when FROM is unset)
reached=yes; [[ -n $FROM ]] && reached=no
step() { [[ $reached == no && $1 == "$FROM" ]] && reached=yes; [[ $reached == yes ]]; }
[[ -n $FROM ]] && say "resuming from $FROM"

if step import; then
  say "import $start .. $end"
  d=$start
  while [[ "$d" < "$end" || "$d" == "$end" ]]; do
    PYTHONUNBUFFERED=1 python scripts/import_history.py "$d" 2>&1 | grep -E "came near|worldwide|failed|no adsb|already" | tee -a "$LOG"
    d=$(date -d "$d + 1 day" +%F)
  done
  # one retry pass for days that failed mid-download
  d=$start
  while [[ "$d" < "$end" || "$d" == "$end" ]]; do
    PYTHONUNBUFFERED=1 python scripts/import_history.py "$d" 2>&1 | grep -E "came near|failed" | tee -a "$LOG"
    d=$(date -d "$d + 1 day" +%F)
  done
  rm -f data/history/*/*.tmp
fi

for a in KBOS KJFK EGLL; do
  if step $a:dataset; then
    say "train $a"
    python dataset.py $a 2>&1 | tail -1 | tee -a "$LOG"
  fi
  if step $a:eta; then
    python train_eta.py $a 2>&1 | grep -E "rows from|straight line|^model|contained|widened|Saved|Error" | tee -a "$LOG"
  fi
  if step $a:runway; then
    say "runway $a"
    python train_runway.py $a 2>&1 | grep -E "model .* vs|Saved|Error" | tee -a "$LOG"
  fi
  if step $a:arrival; then
    python arrival_model.py $a 2>&1 | grep -E "rows from|rule:|threshold|Saved|Error" | tee -a "$LOG"
  fi
done
if step global; then
  say "train global"
  python global_model.py 2>&1 | grep -vE "^  " | tee -a "$LOG"
fi
if step validate; then
  for a in KBOS KJFK EGLL; do
    say "validate $a"
    python scripts/validate_events.py $a 2>&1 | grep -E "arrivals in|Recall|Precision|median" | tee -a "$LOG"
  done
fi
if step score; then
  for a in KBOS KJFK EGLL; do
    say "score live predictions $a"
    python score_predictions.py $a 2>&1 | grep -vE "^  20[0-9]{2}-" | tee -a "$LOG"
  done
fi
step analysis
say "analysis: time lost, scheduler, transfer"
# cached inputs built from the old history must be rebuilt
rm -f data/models/*_arrival_dataset.csv.gz data/scheduler/*_takeoffs.csv
for a in KBOS KJFK EGLL; do
  python time_lost.py $a 2>&1 | grep -E "measured|time lost|Error" | tee -a "$LOG"
done
python scheduler.py 2>&1 | grep -E "40\+|moved|real beats|Error|Traceback" | tee -a "$LOG"
PYTHONUNBUFFERED=1 python transfer.py 2>&1 | grep -E "Saved|Error|Traceback" | tee -a "$LOG"
python scripts/export_results.py 2>&1 | tee -a "$LOG"
say "OVERNIGHT DONE"
