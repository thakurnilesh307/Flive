#!/usr/bin/env bash
# Ship Flive from this laptop to the VM and (re)start it there.
#
#   bash scripts/ship_vm.sh ubuntu@1.2.3.4 path/to/ssh_key [--with-env]
#
# Sends the committed code (git archive HEAD, so commit first) plus the trained
# models, which aren't in git, then runs deploy/vm_setup.sh on the VM. --with-env
# also copies .env (API keys); without it the VM uses the keyless defaults.
# Re-run after every retrain or code change.
set -euo pipefail
cd "$(dirname "$0")/.."

host=${1:?usage: ship_vm.sh user@host ssh_key [--with-env]}
key=${2:?usage: ship_vm.sh user@host ssh_key [--with-env]}
ssh_=(ssh -i "$key" -o StrictHostKeyChecking=accept-new "$host")

[[ -z $(git status --porcelain --untracked-files=no) ]] || echo "note: uncommitted changes are NOT shipped"

echo "== code ($(git rev-parse --short HEAD))"
"${ssh_[@]}" 'mkdir -p ~/flive/data/models'
git archive HEAD | "${ssh_[@]}" 'tar -x -C ~/flive'

echo "== models"
tar -c data/models/*.joblib | "${ssh_[@]}" 'tar -x -C ~/flive'

if [[ ${3:-} == --with-env ]]; then
    echo "== .env"
    "${ssh_[@]}" 'cat > ~/flive/.env && chmod 600 ~/flive/.env' < .env
fi

echo "== setup on the VM"
"${ssh_[@]}" 'cd ~/flive && bash deploy/vm_setup.sh'
