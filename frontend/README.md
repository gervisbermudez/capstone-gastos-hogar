# Frontend

SPA de gastos del hogar. Vite, React y TypeScript. La interfaz usa Chakra UI. Los gráficos usan Recharts y parten de `GET /resumen`. El libro de los montos es SQL.

El navegador solo llama a la API HTTP. La URL sale de `VITE_API_URL`.

El arranque de la entrega, API y esta SPA juntas, es `./run.sh` en la raíz del repositorio.

## Levantar solo el frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Queda en <http://localhost:5173>. En la API, `FRONTEND_ORIGIN` tiene que ser exactamente `http://localhost:5173` (sin barra final). CORS lee esa variable y no acepta otro origen.

La API sola, como dice `api/README.md`:

```bash
cd api
docker compose up -d
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

No hay claves ni token en este paquete. El access token queda en `sessionStorage` de la pestaña (`gastos.access_token`), nunca en la URL.
