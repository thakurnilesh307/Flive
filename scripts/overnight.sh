#!/usr/bin/env bash
# Unattended "more data, retrain everything" run. From the repo root:
#   bash scripts/overnight.sh 2026-11-01 2026-11-11
# 1. imports every day in the range for all prediction airports (already-imported
#    airport/days are skipped), 2. rebuilds datasets and retrains each airport's
#    landing-time and runway models, 3. retrains the global model, 4. re-scores the
#    landing detector against OpenSky. Each script only saves at the end, so a failed
#    step leaves the previous model in place. Log: data/overnight.log
cd "$(dirname "$0")/.." || exit 1
LOG=data/overnight.log
start=${1:?start date}; end=${2:?end date}
say() { echo "[$(date '+%H:%M')] $*" | tee -a "$LOG"; }

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

for a in KBOS KJFK EGLL; do
  say "train $a"
  python dataset.py $a 2>&1 | tail -1 | tee -a "$LOG"
  python train_eta.py $a 2>&1 | grep -E "rows from|straight line|^model|contained|widened|Saved|Error" | tee -a "$LOG"
  python train_runway.py $a 2>&1 | grep -E "model .* vs|Saved|Error" | tee -a "$LOG"
done
say "train global"
python global_model.py 2>&1 | grep -vE "^  " | tee -a "$LOG"
for a in KBOS KJFK EGLL; do
  say "validate $a"
  python scripts/validate_events.py $a 2>&1 | grep -E "arrivals in|Recall|Precision|median" | tee -a "$LOG"
done
say "OVERNIGHT DONE"
