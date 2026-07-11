#!/bin/sh
# Runs inside the ipfs/kubo container (mounted into /container-init.d/).
# Bind the API to all interfaces so the cluster peer can reach it over the
# docker network, and allow the cluster's HTTP origin.
set -e
ipfs config Addresses.API /ip4/0.0.0.0/tcp/5001
ipfs config --json API.HTTPHeaders.Access-Control-Allow-Origin '["*"]'
ipfs config --json API.HTTPHeaders.Access-Control-Allow-Methods '["PUT","POST","GET"]'

# Resource tuning. This node serves content via its HTTP gateway and the
# private cluster swarm — it does not rely on public DHT discovery — so it runs
# as a lightweight routing *client* (no DHT server / large routing table) and
# caps peer connections. Cuts idle memory from ~1GB+ to a few hundred MB.
# `|| true`-guarded so an unsupported key can never abort container init.
ipfs config Routing.Type autoclient || echo "[init] warn: Routing.Type not set"
ipfs config --json Swarm.ConnMgr.HighWater 150 || echo "[init] warn: ConnMgr.HighWater not set"
ipfs config --json Swarm.ConnMgr.LowWater 50 || echo "[init] warn: ConnMgr.LowWater not set"
