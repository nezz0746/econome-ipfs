#!/bin/sh
# Runs inside the ipfs/kubo container (mounted into /container-init.d/).
# Bind the API to all interfaces so the cluster peer can reach it over the
# docker network, and allow the cluster's HTTP origin.
set -e
ipfs config Addresses.API /ip4/0.0.0.0/tcp/5001
ipfs config --json API.HTTPHeaders.Access-Control-Allow-Origin '["*"]'
ipfs config --json API.HTTPHeaders.Access-Control-Allow-Methods '["PUT","POST","GET"]'
