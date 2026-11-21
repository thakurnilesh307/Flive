#!/usr/bin/env bash
# Install and start Flive on a fresh Ubuntu VM (written for Oracle Cloud Always Free,
# works on any Ubuntu 22.04/24.04 box). Run ON the VM, from the repo root:
#
#   bash deploy/vm_setup.sh            first install, and again to update after git pull
#
# The models (data/models/*.joblib) are not in git: copy them up first, see
# scripts/ship_vm.sh. Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")/.."

say() { echo "== $*"; }

if ! command -v docker >/dev/null; then
    say "installing Docker"
    sudo apt-get update -y
    sudo apt-get install -y ca-certificates curl
    sudo install -m 0755 -d /etc/apt/keyrings
    sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
        | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
    sudo apt-get update -y
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    sudo usermod -aG docker "$USER"
fi

# Oracle's Ubuntu images block everything but SSH in iptables, on top of the cloud
# firewall (the subnet's security list, which needs 80 and 443 opened in the console).
for port in 80 443; do
    if ! sudo iptables -C INPUT -p tcp --dport $port -j ACCEPT 2>/dev/null; then
        say "opening port $port in iptables"
        sudo iptables -I INPUT 5 -p tcp --dport $port -j ACCEPT
    fi
done
if command -v netfilter-persistent >/dev/null; then sudo netfilter-persistent save >/dev/null; fi

# Small VMs (1 GB) run out of memory building the frontend: add swap once.
if [[ $(free -m | awk '/Mem:/ {print $2}') -lt 2000 && ! -f /swapfile ]]; then
    say "adding 2 GB swap"
    sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
    sudo mkswap /swapfile >/dev/null && sudo swapon /swapfile
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

ls data/models/*.joblib >/dev/null 2>&1 || { echo "no models in data/models: run scripts/ship_vm.sh from the laptop first"; exit 1; }
touch .env

# HTTPS needs a hostname: sslip.io maps 1-2-3-4.sslip.io to 1.2.3.4, no DNS setup.
if [[ -z ${SITE_ADDRESS:-} ]]; then
    ip=$(curl -fsS https://api.ipify.org)
    SITE_ADDRESS="${ip//./-}.sslip.io"
fi
export SITE_ADDRESS
echo "SITE_ADDRESS=$SITE_ADDRESS" > deploy/.env    # compose reads it on later runs too

say "building and starting (first build takes a few minutes)"
sudo docker compose -f deploy/docker-compose.yml up -d --build
sudo docker image prune -f >/dev/null

# The server logs every snapshot (~0.5 GB/day over three airports): keep a week.
cron="0 4 * * * docker exec flive-flive-1 find /home/user/app -maxdepth 1 -name '*.jsonl' -mtime +7 -delete"
( sudo crontab -l 2>/dev/null | grep -v "flive-flive-1 find" ; echo "$cron" ) | sudo crontab -

say "done: https://$SITE_ADDRESS (the certificate can take a minute on first start)"
