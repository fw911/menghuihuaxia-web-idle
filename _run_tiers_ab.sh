#!/bin/bash
# 一进程一次：每个 (mode, seed) 组合都重开一个 node 进程
cd "$(dirname "$0")"
: > _tiers_ab_results.txt
for spec in "post 42" "post 42" "pre 42" "post 7" "pre 7" "post 99" "pre 99"; do
  set -- $spec
  echo ">>> MODE=$1 SEED=$2" | tee -a _tiers_ab_results.txt
  MODE="$1" SIM_SEED="$2" node _probe_tiers_ab.js 2>&1 | tee -a _tiers_ab_results.txt | grep -E '^RESULT'
done
echo "=== DONE ==="
