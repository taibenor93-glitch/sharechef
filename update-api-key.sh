#!/usr/bin/env bash
# Securely update OPENAI_API_KEY in local .env files.
# The key is read silently — it never appears in shell history or output.
set -euo pipefail

ENV_ROOT="/Users/taibenor/Projects/sharechef-ai/.env"
ENV_SERVER="/Users/taibenor/Projects/sharechef-ai/server/.env"

printf "Enter new OpenAI API key (input hidden): "
read -rs NEW_KEY
printf "\n"

if [[ -z "$NEW_KEY" ]]; then
  echo "Error: no key entered. Aborting." >&2
  exit 1
fi

# Replace VITE_OPENAI_API_KEY in root .env
if grep -q "^VITE_OPENAI_API_KEY=" "$ENV_ROOT"; then
  sed -i '' "s|^VITE_OPENAI_API_KEY=.*|VITE_OPENAI_API_KEY=${NEW_KEY}|" "$ENV_ROOT"
  echo "✓ Updated VITE_OPENAI_API_KEY in .env"
else
  echo "VITE_OPENAI_API_KEY=${NEW_KEY}" >> "$ENV_ROOT"
  echo "✓ Added VITE_OPENAI_API_KEY to .env"
fi

# Replace OPENAI_API_KEY in server/.env
if grep -q "^OPENAI_API_KEY=" "$ENV_SERVER"; then
  sed -i '' "s|^OPENAI_API_KEY=.*|OPENAI_API_KEY=${NEW_KEY}|" "$ENV_SERVER"
  echo "✓ Updated OPENAI_API_KEY in server/.env"
else
  echo "OPENAI_API_KEY=${NEW_KEY}" >> "$ENV_SERVER"
  echo "✓ Added OPENAI_API_KEY to server/.env"
fi

# Clear the variable from memory immediately
unset NEW_KEY

echo ""
echo "Done. Both files updated. Key cleared from memory."
