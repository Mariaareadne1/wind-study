#!/bin/sh
# Render the portfolio hero at the reference's size and stack it under the target: scripts/hero.sh name [extra query]
SCENE=portfolio W=1914 H=1048 DPR=1 node scripts/vs.mjs "artifacts/vs/$1" 600 "$2" && node scripts/stack.mjs "artifacts/vs/$1.png" "artifacts/vs/$1-st.jpg"
