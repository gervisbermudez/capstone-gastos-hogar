#!/usr/bin/env bash
# Levanta API, Redis, Phoenix y frontend desde capstone/.
# No crea api/.env y no copia secretos. Si el archivo no está, lo dice y sigue:
# Redis, Phoenix, el frontend y la API arrancan igual. El registro y las trazas no.
set -euo pipefail

cd "$(dirname "$0")"

# En el host, 6379 y 6006 pueden estar tomados por otra pre-entrega.
# Adentro de la red no cambia: la API usa redis:6379 y phoenix:6006.
puerto_libre() {
  local preferido="$1"
  local candidato="$preferido"
  local tope=$((preferido + 20))
  while ss -ltn | awk '{print $4}' | grep -Eq "(^|:)${candidato}$"; do
    candidato=$((candidato + 1))
    if (( candidato > tope )); then
      echo "No hay puerto libre entre ${preferido} y ${tope}." >&2
      exit 1
    fi
  done
  printf '%s\n' "$candidato"
}

export CAPSTONE_REDIS_PORT="$(puerto_libre 6379)"
export CAPSTONE_PHOENIX_PORT="$(puerto_libre 6006)"

if [[ ! -f api/.env ]]; then
  cat <<'EOF'
Falta api/.env.
Crearlo a partir del ejemplo, sin copiar un .env de otra entrega ni ninguna clave:

  cp api/.env.example api/.env

Completar en ese archivo, con valores propios y no en el repositorio:
  JWT_SECRET
  LLM_PROVIDER (openai o gemini)
  OPENAI_API_KEY y OPENAI_MODEL, o GOOGLE_API_KEY y GEMINI_MODEL

PINECONE_API_KEY e INDEX_NAME son opcionales: si Pinecone no responde, la búsqueda queda en BM25.
Sin JWT_SECRET no hay registro. Sin la clave y el modelo no hay extracción ni las cinco trazas en Phoenix.
Redis, Phoenix, el frontend y la API se levantan igual.

EOF
fi

docker compose up -d --build

echo "Redis en el host: localhost:${CAPSTONE_REDIS_PORT}  Phoenix: http://localhost:${CAPSTONE_PHOENIX_PORT}"
echo "Esperando a Phoenix y a GET /health..."
phoenix_ok=0
api_ok=0
for _ in $(seq 1 90); do
  if curl -sf -o /dev/null --max-time 2 "http://localhost:${CAPSTONE_PHOENIX_PORT}"; then
    phoenix_ok=1
  fi
  if curl -sf -o /dev/null --max-time 2 http://localhost:8000/health; then
    api_ok=1
  fi
  if [[ "$phoenix_ok" -eq 1 && "$api_ok" -eq 1 ]]; then
    break
  fi
  sleep 2
done

if [[ "$phoenix_ok" -eq 1 ]]; then
  # El lifespan registra el collector al arrancar. Si Phoenix llegó después, se reinicia una vez.
  docker compose restart api
  api_ok=0
  for _ in $(seq 1 30); do
    if curl -sf -o /dev/null --max-time 2 http://localhost:8000/health; then
      api_ok=1
      break
    fi
    sleep 2
  done
fi

echo
docker compose ps
echo
if [[ "$api_ok" -eq 1 ]]; then
  echo "API en http://localhost:8000/docs  (GET /health ok)"
else
  echo "La API no respondió /health. Revisá: docker compose logs api"
fi
if [[ "$phoenix_ok" -eq 1 ]]; then
  echo "Phoenix en http://localhost:${CAPSTONE_PHOENIX_PORT}  (proyecto gastos-hogar)"
else
  echo "Phoenix no respondió en el puerto ${CAPSTONE_PHOENIX_PORT}. Revisá: docker compose logs phoenix"
fi
echo "Frontend en http://localhost:5173"
echo
echo "Cuando api/.env tenga JWT_SECRET, la clave y el modelo:"
echo "  api/.venv/bin/python api/scripts/carga.py"
