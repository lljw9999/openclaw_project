#!/bin/bash
# OpenClaw Enterprise Control Plane — Live Demo Script
# Usage: bash demo.sh

BASE_URL="https://openclaw-projectopenclaw-control-plane.onrender.com"
BOLD="\033[1m"
GREEN="\033[32m"
RED="\033[31m"
YELLOW="\033[33m"
CYAN="\033[36m"
RESET="\033[0m"

echo ""
echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════${RESET}"
echo -e "${BOLD}${CYAN}   OpenClaw Enterprise Control Plane — Live Demo   ${RESET}"
echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════${RESET}"
echo ""

# ── Health Check ──
echo -e "${BOLD}1️⃣  Health Check${RESET}"
echo -e "   GET /health"
RESULT=$(curl -s "$BASE_URL/health")
echo -e "   ${GREEN}→ $RESULT${RESET}"
echo ""
sleep 1

# ── Demo 1: Safe tool (auto-allowed) ──
echo -e "${BOLD}2️⃣  Safe Read Tool — web_search (auto-allowed)${RESET}"
echo -e "   POST /v1/tool-calls/intercept"
RESULT=$(curl -s "$BASE_URL/v1/tool-calls/intercept" \
  -H 'content-type: application/json' \
  -d '{
    "toolName": "web_search",
    "params": {"query": "latest AI news"},
    "context": {"source": "research-agent", "userId": "analyst@company.com"}
  }')
DECISION=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['decision'])" 2>/dev/null)
echo -e "   ${GREEN}→ Decision: $DECISION${RESET}"
echo -e "   ${CYAN}(web_search is in the safe-tools allowlist)${RESET}"
echo ""
sleep 1

# ── Demo 2: Risky tool (requires human approval) ──
echo -e "${BOLD}3️⃣  Risky Tool — shell_exec 'ls -la' (requires approval)${RESET}"
echo -e "   POST /v1/tool-calls/intercept"
RESULT=$(curl -s "$BASE_URL/v1/tool-calls/intercept" \
  -H 'content-type: application/json' \
  -d '{
    "toolName": "shell_exec",
    "params": {"command": "ls -la /etc/passwd"},
    "context": {"source": "slack-bot", "sessionId": "demo-1", "userId": "intern@company.com"}
  }')
DECISION=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['decision'])" 2>/dev/null)
APPROVAL_ID=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('approvalId','n/a'))" 2>/dev/null)
echo -e "   ${YELLOW}→ Decision: $DECISION${RESET}"
echo -e "   ${YELLOW}→ Approval ID: $APPROVAL_ID${RESET}"
echo -e "   ${CYAN}(Go to the dashboard to approve/reject this!)${RESET}"
echo ""
sleep 1

# ── Demo 3: Dangerous command (auto-denied) ──
echo -e "${BOLD}4️⃣  Dangerous Command — 'rm -rf /' (auto-denied)${RESET}"
echo -e "   POST /v1/tool-calls/intercept"
RESULT=$(curl -s "$BASE_URL/v1/tool-calls/intercept" \
  -H 'content-type: application/json' \
  -d '{
    "toolName": "shell_exec",
    "params": {"command": "rm -rf /"},
    "context": {"source": "rogue-agent"}
  }')
DECISION=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['decision'])" 2>/dev/null)
REASON=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('reason',''))" 2>/dev/null)
echo -e "   ${RED}→ Decision: $DECISION${RESET}"
echo -e "   ${RED}→ Reason: $REASON${RESET}"
echo ""
sleep 1

# ── Demo 4: DLP — Redact leaked API keys ──
echo -e "${BOLD}5️⃣  DLP — Redact Leaked API Keys${RESET}"
echo -e "   POST /v1/tool-results/sanitize"
RESULT=$(curl -s "$BASE_URL/v1/tool-results/sanitize" \
  -H 'content-type: application/json' \
  -d '{
    "output": "Config found: AWS_KEY=AKIAIOSFODNN7EXAMPLE and OPENAI_KEY=sk-proj1234567890abcdefghij connected successfully."
  }')
REDACTIONS=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['redactions'])" 2>/dev/null)
SANITIZED=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['sanitized'])" 2>/dev/null)
echo -e "   ${GREEN}→ Redactions found: $REDACTIONS${RESET}"
echo -e "   ${GREEN}→ Sanitized output: $SANITIZED${RESET}"
echo ""
sleep 1

# ── Demo 5: Outbound DLP — Block sensitive data ──
echo -e "${BOLD}6️⃣  Outbound DLP — Block 'private key' Leak${RESET}"
echo -e "   POST /v1/outbound/check"
RESULT=$(curl -s "$BASE_URL/v1/outbound/check" \
  -H 'content-type: application/json' \
  -d '{
    "message": "Sure! Here is the private key for the wallet: abc123xyz789"
  }')
ALLOWED=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['allowed'])" 2>/dev/null)
PATTERN=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('deniedPattern','none'))" 2>/dev/null)
echo -e "   ${RED}→ Allowed: $ALLOWED${RESET}"
echo -e "   ${RED}→ Blocked by pattern: $PATTERN${RESET}"
echo ""
sleep 1

# ── Demo 6: Cost-aware routing (cheap) ──
echo -e "${BOLD}7️⃣  Cost Routing — Simple Task → Cheap Model${RESET}"
echo -e "   POST /v1/model-router/route"
RESULT=$(curl -s "$BASE_URL/v1/model-router/route" \
  -H 'content-type: application/json' \
  -d '{"prompt": "Summarize these meeting notes briefly", "metadata": {"taskType": "summary"}}')
TIER=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['tier'])" 2>/dev/null)
MODEL=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['model'])" 2>/dev/null)
echo -e "   ${GREEN}→ Tier: $TIER | Model: $MODEL${RESET}"
echo ""
sleep 1

# ── Demo 7: Cost-aware routing (premium) ──
echo -e "${BOLD}8️⃣  Cost Routing — Complex Task → Premium Model${RESET}"
echo -e "   POST /v1/model-router/route"
RESULT=$(curl -s "$BASE_URL/v1/model-router/route" \
  -H 'content-type: application/json' \
  -d '{"prompt": "Create a comprehensive threat model and security architecture review for our microservices with regulatory compliance analysis"}')
TIER=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['tier'])" 2>/dev/null)
MODEL=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['model'])" 2>/dev/null)
echo -e "   ${YELLOW}→ Tier: $TIER | Model: $MODEL${RESET}"
echo ""
sleep 1

# ── Demo 8: View metrics ──
echo -e "${BOLD}9️⃣  Governance Metrics Summary (last 60 min)${RESET}"
echo -e "   GET /v1/metrics/summary"
curl -s "$BASE_URL/v1/metrics/summary?windowMinutes=60" | python3 -m json.tool
echo ""

# ── Demo 9: Audit trail ──
echo -e "${BOLD}🔟  Audit Trail (last 5 events)${RESET}"
echo -e "   GET /v1/audit/events"
curl -s "$BASE_URL/v1/audit/events?limit=5" | python3 -m json.tool
echo ""

echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════${RESET}"
echo -e "${BOLD}${CYAN}   Demo complete! Check the dashboards:            ${RESET}"
echo -e "${CYAN}   📊 $BASE_URL/ui/approvals.html${RESET}"
echo -e "${CYAN}   📈 $BASE_URL/ui/metrics.html${RESET}"
echo -e "${CYAN}   📋 $BASE_URL/ui/policies.html${RESET}"
echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════${RESET}"
echo ""
