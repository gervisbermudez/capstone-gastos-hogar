# Frontend

SPA de gastos del hogar. Vite, React y TypeScript. La interfaz usa Chakra UI. Los gráficos usan Recharts y dibujan `GET /resumen` sin calcular totales.

El navegador solo llama a la API HTTP. La URL sale de `VITE_API_URL`.

## Levantar

```bash
cd capstone/frontend
npm install
cp .env.example .env
npm run dev
```

Queda en <http://localhost:5173>. En la API, `FRONTEND_ORIGIN` tiene que ser exactamente `http://localhost:5173` (sin barra final). CORS lee esa variable y no acepta otro origen.

La API, como dice `capstone/api/README.md`:

```bash
cd capstone/api
docker compose up -d
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

No hay claves ni token en este paquete. El access token queda en `sessionStorage` de la pestaña (`gastos.access_token`), nunca en la URL.
