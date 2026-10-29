import { Box, Flex, Stack, Text } from "@chakra-ui/react"
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import type { TooltipPayloadEntry } from "recharts"
import { ETIQUETA_CATEGORIA, type Categoria, type TotalCategoria, type TotalMes } from "../api/tipos"
import { formatMonto } from "../formato"

const SOL = "#f5cb5c"
const CARBON = "#1c1c1a"
const DORADO = "#c4a15a"
const TICK = { fontSize: 11, fill: "#5c584f" }
const ESTILO_TOOLTIP = {
  contentStyle: {
    backgroundColor: "#fffdf8",
    border: "1px solid rgba(28, 28, 26, 0.12)",
    borderRadius: 12,
    color: CARBON,
  },
  labelStyle: { color: CARBON },
  itemStyle: { color: CARBON },
}

const COLOR_CATEGORIA: Record<Categoria, string> = {
  servicios: SOL,
  expensas: CARBON,
  alquiler: DORADO,
}

type Punto = {
  clave: string
  nombre: string
  total: string
  valor: number
  color: string
}

function escala(total: string): number | null {
  if (!/^\d+\.\d{2}$/.test(total)) return null
  const valor = Number(total)
  return Number.isFinite(valor) ? valor : null
}

function formatoTotal(
  value: number | string | ReadonlyArray<number | string> | undefined,
  name: string | number | undefined,
  item: TooltipPayloadEntry,
): [string, string] {
  const carga = item.payload as { total?: string } | undefined
  const crudo = carga?.total ?? (value == null || Array.isArray(value) ? undefined : String(value))
  return [formatMonto(crudo), name == null ? "Total" : String(name)]
}

function ListaTotales({ puntos }: { puntos: Punto[] }) {
  return (
    <Stack gap={1} mt={3}>
      {puntos.map((punto) => (
        <Flex key={punto.clave} justify="space-between" gap={4}>
          <Text>{punto.nombre}</Text>
          <Text fontWeight="medium" fontVariantNumeric="tabular-nums">
            {formatMonto(punto.total)}
          </Text>
        </Flex>
      ))}
    </Stack>
  )
}

export function GraficoMeses({ porMes }: { porMes: TotalMes[] }) {
  const meses = [...porMes].sort((a, b) => a.periodo.localeCompare(b.periodo))
  const puntos = meses.map((item, indice) => {
    const valor = escala(item.total)
    return {
      clave: `${item.periodo}-${indice}`,
      nombre: item.periodo,
      total: item.total,
      valor: valor ?? 0,
      color: SOL,
      dibuja: valor !== null,
    }
  })
  const dibujo = puntos.filter((punto) => punto.dibuja)

  if (puntos.length === 0) {
    return <Text color="fg.muted">Sin totales por mes en este período.</Text>
  }

  return (
    <Stack>
      {dibujo.length > 0 ? (
        <Box h={{ base: "16rem", md: "18rem" }} w="100%">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dibujo} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
              <XAxis
                dataKey="nombre"
                interval={0}
                angle={-40}
                textAnchor="end"
                height={56}
                tick={TICK}
                stroke="#5c584f"
              />
              <YAxis width={72} tick={TICK} stroke="#5c584f" />
              <Tooltip formatter={formatoTotal} {...ESTILO_TOOLTIP} />
              <Bar dataKey="valor" name="Total" fill={SOL} barSize={14} radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Box>
      ) : (
        <Text color="fg.muted">No hay montos para graficar en este período.</Text>
      )}
      <ListaTotales puntos={puntos} />
    </Stack>
  )
}

export function GraficoCategorias({ porCategoria }: { porCategoria: TotalCategoria[] }) {
  const puntos = porCategoria.map((item, indice) => {
    const valor = escala(item.total)
    return {
      clave: `${item.categoria}-${indice}`,
      nombre: ETIQUETA_CATEGORIA[item.categoria],
      total: item.total,
      valor: valor ?? 0,
      color: COLOR_CATEGORIA[item.categoria],
      dibuja: valor !== null,
    }
  })
  const dibujo = puntos.filter((punto) => punto.dibuja)

  if (puntos.length === 0) {
    return <Text color="fg.muted">Sin totales por categoría en este período.</Text>
  }

  return (
    <Stack>
      {dibujo.length > 0 ? (
        <Box h={{ base: "16rem", md: "18rem" }} w="100%">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={dibujo}
                dataKey="valor"
                nameKey="nombre"
                innerRadius="46.5%"
                outerRadius="75%"
                // 46.5 / 75 = 0.62: Recharts mide los dos radios sobre el máximo del gráfico.
                paddingAngle={2}
                cornerRadius={8}
                stroke="none"
                isAnimationActive={false}
              >
                {dibujo.map((punto) => (
                  <Cell key={punto.clave} fill={punto.color} />
                ))}
              </Pie>
              <Tooltip formatter={formatoTotal} {...ESTILO_TOOLTIP} />
            </PieChart>
          </ResponsiveContainer>
        </Box>
      ) : (
        <Text color="fg.muted">No hay montos para graficar en este período.</Text>
      )}
      <ListaTotales puntos={puntos} />
    </Stack>
  )
}
