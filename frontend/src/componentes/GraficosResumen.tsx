import { Box, Flex, Stack, Text, useToken } from "@chakra-ui/react"
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import type { TooltipPayloadEntry } from "recharts"
import { ETIQUETA_CATEGORIA, type Categoria, type TotalCategoria, type TotalMes } from "../api/tipos"
import { formatMonto } from "../formato"

const COLORES = ["blue.500", "teal.500", "orange.500", "purple.500"]

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
          <Text fontWeight="medium">{formatMonto(punto.total)}</Text>
        </Flex>
      ))}
    </Stack>
  )
}

export function GraficoMeses({ porMes }: { porMes: TotalMes[] }) {
  const [azul] = useToken("colors", COLORES)
  const meses = [...porMes].sort((a, b) => a.periodo.localeCompare(b.periodo))
  const puntos = meses.map((item, indice) => {
    const valor = escala(item.total)
    return {
      clave: `${item.periodo}-${indice}`,
      nombre: item.periodo,
      total: item.total,
      valor: valor ?? 0,
      color: azul || "currentColor",
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
                tick={{ fontSize: 11 }}
              />
              <YAxis width={72} tick={{ fontSize: 11 }} />
              <Tooltip formatter={formatoTotal} />
              <Bar dataKey="valor" name="Total" fill={azul} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Box>
      ) : (
        <Text color="fg.muted">El resumen no trajo totales dibujables.</Text>
      )}
      <ListaTotales puntos={puntos} />
    </Stack>
  )
}

export function GraficoCategorias({ porCategoria }: { porCategoria: TotalCategoria[] }) {
  const colores = useToken("colors", COLORES)
  const paleta: Record<Categoria, string> = {
    servicios: colores[1] || colores[0] || "currentColor",
    expensas: colores[2] || colores[0] || "currentColor",
    alquiler: colores[3] || colores[0] || "currentColor",
  }
  const puntos = porCategoria.map((item, indice) => {
    const valor = escala(item.total)
    return {
      clave: `${item.categoria}-${indice}`,
      nombre: ETIQUETA_CATEGORIA[item.categoria],
      total: item.total,
      valor: valor ?? 0,
      color: paleta[item.categoria],
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
              <Pie data={dibujo} dataKey="valor" nameKey="nombre" outerRadius="75%" isAnimationActive={false}>
                {dibujo.map((punto) => (
                  <Cell key={punto.clave} fill={punto.color} />
                ))}
              </Pie>
              <Tooltip formatter={formatoTotal} />
            </PieChart>
          </ResponsiveContainer>
        </Box>
      ) : (
        <Text color="fg.muted">El resumen no trajo totales dibujables.</Text>
      )}
      <ListaTotales puntos={puntos} />
    </Stack>
  )
}
