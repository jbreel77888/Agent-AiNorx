#!/bin/bash
# ╔══════════════════════════════════════════════════════════════════════╗
# ║  Deploy Kortix to Render — Automated Setup Script                  ║
# ║                                                                    ║
# ║  This script creates all required services on Render via API.      ║
# ║  Prerequisites:                                                    ║
# ║    1. Add payment info at https://dashboard.render.com/billing     ║
# ║    2. Set RENDER_API_KEY below                                     ║
# ║    3. Set SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY   ║
# ║       (from https://supabase.com free project)                     ║
# ╚══════════════════════════════════════════════════════════════════════╝

set -e

# ── Configuration ──────────────────────────────────────────────────────
RENDER_API_KEY="${RENDER_API_KEY:-rnd_ZlVgT1r922aaxXY19AkguyPkaM9o}"
OWNER_ID="tea-d8u662b7uimc73dqk7k0"
REPO="https://github.com/jbreel77888/Agent-AiNorx"
BRANCH="main"
REGION="oregon"

# Supabase credentials (fill these in from your Supabase project)
SUPABASE_URL="${SUPABASE_URL:-}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-}"
SUPABASE_SERVICE_KEY="${SUPABASE_SERVICE_KEY:-}"

# ── Colors ─────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${BLUE}[deploy]${NC} $1"; }
ok()   { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; }

# ── Validate ───────────────────────────────────────────────────────────
if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_ANON_KEY" ] || [ -z "$SUPABASE_SERVICE_KEY" ]; then
    err "Missing Supabase credentials!"
    echo ""
    echo "Create a free Supabase project at https://supabase.com and set:"
    echo "  export SUPABASE_URL=https://xxxxx.supabase.co"
    echo "  export SUPABASE_ANON_KEY=eyJhb..."
    echo "  export SUPABASE_SERVICE_KEY=eyJhb..."
    exit 1
fi

API_BASE="https://api.render.com/v1"
AUTH_HEADER="Authorization: Bearer $RENDER_API_KEY"

# ── Step 1: Create PostgreSQL Database ─────────────────────────────────
log "Creating PostgreSQL database..."
DB_RESPONSE=$(curl -s -X POST "$API_BASE/services" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d "{
    \"type\": \"private_service\",
    \"name\": \"kortix-db\",
    \"ownerId\": \"$OWNER_ID\",
    \"region\": \"$REGION\",
    \"plan\": \"starter\",
    \"serviceDetails\": {
      \"env\": \"docker\",
      \"dockerfilePath\": \"Dockerfile.postgres\",
      \"dockerContext\": \".\"
    },
    \"repo\": \"$REPO\",
    \"branch\": \"$BRANCH\",
    \"envVars\": [
      {\"key\": \"POSTGRES_DB\", \"value\": \"kortix\"},
      {\"key\": \"POSTGRES_USER\", \"value\": \"kortix_user\"},
      {\"key\": \"POSTGRES_PASSWORD\", \"value\": \"kortix_secure_2024\"}
    ]
  }" 2>&1)

if echo "$DB_RESPONSE" | grep -q '"id"'; then
    DB_ID=$(echo "$DB_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['service']['id'])" 2>/dev/null || echo "unknown")
    ok "Database created: $DB_ID"
else
    warn "Database creation response: $DB_RESPONSE"
fi

# ── Step 2: Create API Service ────────────────────────────────────────
log "Creating API service..."
API_RESPONSE=$(curl -s -X POST "$API_BASE/services" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d "{
    \"type\": \"web_service\",
    \"name\": \"kortix-api\",
    \"ownerId\": \"$OWNER_ID\",
    \"region\": \"$REGION\",
    \"plan\": \"starter\",
    \"serviceDetails\": {
      \"env\": \"docker\",
      \"dockerfilePath\": \"apps/api/Dockerfile\",
      \"dockerContext\": \".\"
    },
    \"repo\": \"$REPO\",
    \"branch\": \"$BRANCH\",
    \"envVars\": [
      {\"key\": \"PORT\", \"value\": \"8008\"},
      {\"key\": \"NODE_ENV\", \"value\": \"production\"},
      {\"key\": \"INTERNAL_KORTIX_ENV\", \"value\": \"production\"},
      {\"key\": \"DATABASE_URL\", \"value\": \"postgresql://kortix_user:kortix_secure_2024@kortix-db:5432/kortix\"},
      {\"key\": \"SUPABASE_URL\", \"value\": \"$SUPABASE_URL\"},
      {\"key\": \"SUPABASE_SERVICE_ROLE_KEY\", \"value\": \"$SUPABASE_SERVICE_KEY\"},
      {\"key\": \"SUPABASE_ANON_KEY\", \"value\": \"$SUPABASE_ANON_KEY\"},
      {\"key\": \"API_KEY_SECRET\", \"generateValue\": true},
      {\"key\": \"ALLOWED_SANDBOX_PROVIDERS\", \"value\": \"none\"},
      {\"key\": \"KORTIX_BILLING_INTERNAL_ENABLED\", \"value\": \"false\"},
      {\"key\": \"SCHEDULER_ENABLED\", \"value\": \"false\"},
      {\"key\": \"LLM_GATEWAY_ENABLED\", \"value\": \"false\"}
    ]
  }" 2>&1)

if echo "$API_RESPONSE" | grep -q '"id"'; then
    API_ID=$(echo "$API_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['service']['id'])" 2>/dev/null || echo "unknown")
    API_URL=$(echo "$API_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['service']['serviceDetails']['url'])" 2>/dev/null || echo "pending")
    ok "API service created: $API_ID"
    ok "API URL: https://$API_URL"
else
    warn "API creation response: $API_RESPONSE"
fi

# ── Step 3: Create Web Service ────────────────────────────────────────
log "Creating Web frontend service..."
WEB_RESPONSE=$(curl -s -X POST "$API_BASE/services" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d "{
    \"type\": \"web_service\",
    \"name\": \"kortix-web\",
    \"ownerId\": \"$OWNER_ID\",
    \"region\": \"$REGION\",
    \"plan\": \"starter\",
    \"serviceDetails\": {
      \"env\": \"docker\",
      \"dockerfilePath\": \"apps/web/Dockerfile.render\",
      \"dockerContext\": \".\"
    },
    \"repo\": \"$REPO\",
    \"branch\": \"$BRANCH\",
    \"envVars\": [
      {\"key\": \"PORT\", \"value\": \"3000\"},
      {\"key\": \"NEXT_PUBLIC_SUPABASE_URL\", \"value\": \"$SUPABASE_URL\"},
      {\"key\": \"NEXT_PUBLIC_SUPABASE_ANON_KEY\", \"value\": \"$SUPABASE_ANON_KEY\"},
      {\"key\": \"NEXT_PUBLIC_BACKEND_URL\", \"value\": \"https://kortix-api.onrender.com/v1\"},
      {\"key\": \"NEXT_PUBLIC_BILLING_ENABLED\", \"value\": \"false\"},
      {\"key\": \"BACKEND_URL\", \"value\": \"https://kortix-api.onrender.com/v1\"},
      {\"key\": \"APP_URL\", \"value\": \"https://kortix-web.onrender.com\"}
    ]
  }" 2>&1)

if echo "$WEB_RESPONSE" | grep -q '"id"'; then
    WEB_ID=$(echo "$WEB_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['service']['id'])" 2>/dev/null || echo "unknown")
    WEB_URL=$(echo "$WEB_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['service']['serviceDetails']['url'])" 2>/dev/null || echo "pending")
    ok "Web service created: $WEB_ID"
    ok "Web URL: https://$WEB_URL"
else
    warn "Web creation response: $WEB_RESPONSE"
fi

# ── Summary ────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  Kortix Deployment Summary"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "  Database:  kortix-db (PostgreSQL)"
echo "  API:       https://kortix-api.onrender.com"
echo "  Web:       https://kortix-web.onrender.com"
echo ""
echo "  Health:    https://kortix-api.onrender.com/v1/health"
echo ""
echo "═══════════════════════════════════════════════════════════════"
