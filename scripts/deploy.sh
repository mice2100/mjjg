#!/usr/bin/env bash
# Production deploy for the "jadegarden" Worker. See AGENTS.md §10.
#
#   scripts/deploy.sh setup      first time only: find or create the D1 database, write its id into
#                                wrangler.jsonc, generate SESSION_SECRET, then run a normal deploy
#   scripts/deploy.sh            every update: test, build, back up + migrate D1, deploy, smoke test
#   scripts/deploy.sh status     current deployments, secrets and pending migrations
#   scripts/deploy.sh rollback   roll the Worker back to the previous version (D1 is not rolled back)
#
# Local, git-ignored files:
#   .deploy.env   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, optional DEPLOY_URL (see .deploy.env.example).
#                 Without it, wrangler uses `wrangler login`. For the custom domains in wrangler.jsonc
#                 "routes", the token also needs Zone > Workers Routes > Edit on their zone.
#   .prod.vars    production secrets (see .prod.vars.example). Sent with every deploy and only adds or
#                 updates secrets. Empty values are skipped, so a secret that is missing here keeps
#                 its current value in Cloudflare.
# Set ALLOW_DIRTY=1 to deploy with uncommitted changes (the version is then tagged "-dirty").

set -euo pipefail
cd "$(dirname "$0")/.."

DB_NAME="jadegarden-db"
PLACEHOLDER_DB_ID="00000000-0000-0000-0000-000000000000"
# The only names that may be sent as secrets. Anything else in .prod.vars is rejected, so a stray
# ENVIRONMENT=development (which turns off staff auth) can never reach production.
SECRET_NAMES="SESSION_SECRET WC_CONSUMER_KEY WC_CONSUMER_SECRET WC_WEBHOOK_SECRET TURNSTILE_SECRET_KEY CLOVER_PRIVATE_KEY CLOVER_WEBHOOK_SECRET FACEBOOK_APP_SECRET"

wr() { npx --no-install wrangler "$@"; }
say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

if [[ -f .deploy.env ]]; then
  set -a; source .deploy.env; set +a
fi
# Also accept CF_ACCOUNT_TOKEN / CF_ACCOUNT_ID (e.g. exported by mise).
export CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN:-${CF_ACCOUNT_TOKEN:-}}"
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-${CF_ACCOUNT_ID:-}}"

require_auth() {
  wr whoami 2>&1 | grep -q "You are not authenticated" &&
    die "not signed in to Cloudflare. Fill in .deploy.env (see .deploy.env.example) or run: npx wrangler login"
  return 0
}

db_id_in_config() {
  node -e 'const t=require("fs").readFileSync("wrangler.jsonc","utf8");const m=t.match(/"database_id":\s*"([^"]+)"/);console.log(m?m[1]:"")'
}

# Prints the id of the remote D1 database, or nothing if it does not exist.
remote_db_id() {
  wr d1 list --json | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      const db=JSON.parse(s).find(d=>d.name===process.argv[1]);console.log(db?db.uuid:"")})' "$DB_NAME"
}

# Writes the non-empty, allowed secrets from .prod.vars to $TMP_DIR/secrets.env and prints its path.
secrets_file() {
  [[ -f .prod.vars ]] || return 0
  local out="$TMP_DIR/secrets.env" line key value
  : > "$out"
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
    [[ "$line" == *=* ]] || die ".prod.vars: line is not KEY=VALUE: $line"
    key="${line%%=*}"; value="${line#*=}"
    [[ " $SECRET_NAMES " == *" $key "* ]] || die ".prod.vars: $key is not a known secret (allowed: $SECRET_NAMES)"
    [[ -n "$value" ]] && printf '%s=%s\n' "$key" "$value" >> "$out"
  done < .prod.vars
  [[ -s "$out" ]] && echo "$out"
  return 0
}

config_warnings() {
  local var
  for var in ACCESS_TEAM_DOMAIN ACCESS_AUD_KITCHEN ACCESS_AUD_POS ACCESS_AUD_ADMIN; do
    grep -q "\"$var\": \"\"" wrangler.jsonc && warn "$var is empty: that staff API refuses every request until its Cloudflare Access application is set up"
  done
  grep -q '"CLOVER_MERCHANT_ID": ""' wrangler.jsonc && warn "CLOVER_MERCHANT_ID is empty: web orders return 503 until Clover is set up"
  grep -q '"CLOVER_ENV": "sandbox"' wrangler.jsonc && warn "CLOVER_ENV is sandbox: checkout takes Clover test cards only, no real money"
  grep -q '"TURNSTILE_SITE_KEY": ""' wrangler.jsonc && warn "TURNSTILE_SITE_KEY is empty: the order form has no bot protection"
  return 0
}

cmd_setup() {
  require_auth
  local id
  id="$(db_id_in_config)"
  if [[ "$id" == "$PLACEHOLDER_DB_ID" ]]; then
    id="$(remote_db_id)"
    if [[ -z "$id" ]]; then
      say "Creating D1 database $DB_NAME"
      wr d1 create "$DB_NAME" --location=wnam >/dev/null
      id="$(remote_db_id)"
      [[ -n "$id" ]] || die "could not find $DB_NAME after creating it"
    fi
    say "Writing database_id $id into wrangler.jsonc"
    sed -i '' "s/$PLACEHOLDER_DB_ID/$id/" wrangler.jsonc
    git add wrangler.jsonc && git commit -q -m "Set production D1 database id" &&
      echo "Committed wrangler.jsonc. Push it so other machines deploy to the same database."
  else
    echo "wrangler.jsonc already points at D1 database $id"
  fi

  [[ -f .prod.vars ]] || { cp .prod.vars.example .prod.vars; echo "Created .prod.vars from the template"; }
  if ! grep -q '^SESSION_SECRET=.' .prod.vars; then
    say "Generating SESSION_SECRET in .prod.vars"
    local secret
    secret="$(openssl rand -base64 32)"
    if grep -q '^SESSION_SECRET=' .prod.vars; then
      sed -i '' "s|^SESSION_SECRET=.*|SESSION_SECRET=$secret|" .prod.vars
    else
      echo "SESSION_SECRET=$secret" >> .prod.vars
    fi
  fi
  cmd_deploy
}

cmd_deploy() {
  require_auth
  [[ "$(db_id_in_config)" == "$PLACEHOLDER_DB_ID" ]] && die "wrangler.jsonc has no real D1 id yet. Run: scripts/deploy.sh setup"

  local sha
  sha="$(git rev-parse --short HEAD)"
  if [[ -n "$(git status --porcelain)" ]]; then
    [[ "${ALLOW_DIRTY:-}" == 1 ]] || die "uncommitted changes. Commit first, or rerun with ALLOW_DIRTY=1"
    sha="$sha-dirty"
  fi
  config_warnings

  say "Running tests"
  npm test --silent
  say "Building the site"
  npm run build --silent

  say "Checking D1 migrations"
  if wr d1 migrations list "$DB_NAME" --remote 2>&1 | grep -q "No migrations to apply"; then
    echo "Schema is up to date"
  else
    mkdir -p backups
    local backup="backups/d1-$(date +%Y%m%d-%H%M%S).sql"
    say "Backing up D1 to $backup"
    wr d1 export "$DB_NAME" --remote --output="$backup"
    say "Applying migrations"
    wr d1 migrations apply "$DB_NAME" --remote
  fi

  say "Deploying $sha"
  local args=(--tag "$sha" --message "$(git log -1 --format=%s | cut -c1-100)")
  local secrets
  secrets="$(secrets_file)"
  if [[ -n "$secrets" ]]; then
    args+=(--secrets-file "$secrets")
    echo "Sending secrets: $(cut -d= -f1 "$secrets" | tr '\n' ' ')"
  else
    warn "no .prod.vars values: secrets already in Cloudflare stay as they are"
  fi
  wr deploy "${args[@]}" | tee "$TMP_DIR/deploy.log"

  # Smoke test the workers.dev host, every custom domain and DEPLOY_URL.
  local urls url
  urls="$( { grep -oE 'https://[a-z0-9.-]+\.workers\.dev' "$TMP_DIR/deploy.log" | head -1
    node -e 'const t=require("fs").readFileSync("wrangler.jsonc","utf8");
      for (const m of t.matchAll(/"pattern":\s*"([^"/*]+)",\s*"custom_domain":\s*true/g)) console.log("https://"+m[1])'
    [[ -n "${DEPLOY_URL:-}" ]] && echo "$DEPLOY_URL"; } | awk 'NF && !seen[$0]++')"
  [[ -n "$urls" ]] || { warn "no URL to smoke test. Set DEPLOY_URL in .deploy.env"; return 0; }
  for url in $urls; do smoke_test "$url"; done
}

smoke_test() {
  local url="$1" fail=0 code path
  say "Smoke testing $url"
  # A new custom domain needs a moment for DNS and its certificate.
  for _ in {1..12}; do
    [[ "$(curl -s -o /dev/null -w '%{http_code}' "$url/")" == 200 ]] && break
    sleep 5
  done
  for path in / /order/ /gallery/ /privacy/ /api/config /api/menu; do
    code="$(curl -s -o /dev/null -w '%{http_code}' "$url$path" || true)"
    printf '  %-16s %s\n' "$path" "$code"
    [[ "$code" == 200 ]] || fail=1
  done
  # Staff data must never be public: Access (302/403) or the Worker's own JWT check (401/403).
  for path in /api/kitchen/orders /api/pos/customers/lookup /api/admin/combos /staff/ /pos/ /jadmin/; do
    code="$(curl -s -o /dev/null -w '%{http_code}' "$url$path" || true)"
    printf '  %-26s %s (must not be 200)\n' "$path" "$code"
    [[ "$code" == 200 ]] && fail=1
  done
  (( fail == 0 )) || die "smoke test failed. To undo the code change: scripts/deploy.sh rollback"
  echo "All good."
}

cmd_status() {
  require_auth
  say "Deployments"; wr deployments list | tail -n 30
  say "Secrets"; wr secret list
  say "Migrations"; wr d1 migrations list "$DB_NAME" --remote
}

cmd_rollback() {
  require_auth
  warn "this rolls back code only. D1 migrations and data stay as they are"
  wr rollback
}

case "${1:-deploy}" in
  setup) cmd_setup ;;
  deploy) cmd_deploy ;;
  status) cmd_status ;;
  rollback) cmd_rollback ;;
  *) die "usage: scripts/deploy.sh [setup|deploy|status|rollback]" ;;
esac
