import { Box, Flex, Stack, Text } from "@chakra-ui/react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import type { TooltipPayloadEntry } from "recharts"
import { etiquetaCategoria, esCategoriaFija, type Categoria, type TotalCategoria, type TotalMes } from "../api/tipos"
import { formatMonto } from "../formato"
import { useTema } from "../temaModo"

function coloresGrafico(oscuro: boolean) {
  const tinta = oscuro ? "#fffdf8" : "#1c1c1a"
  const bordeTooltip = oscuro ? "rgba(255,253,248,0.16)" : "rgba(28,28,26,0.12)"
  return {
    tinta,
    ejes: oscuro ? "#f3efe4" : "#5c584f",
    grilla: oscuro ? "rgba(255,253,248,0.16)" : "rgba(28,28,26,0.08)",
    tooltip: {
      contentStyle: {
        backgroundColor: oscuro ? "#3a3934" : "#fffdf8",
        border: `1px solid ${bordeTooltip}`,
        borderRadius: 12,
        color: tinta,
      },
      labelStyle: { color: tinta },
      itemStyle: { color: tinta },
    },
    categoria: {
      servicios: "#e0b43a",
      expensas: oscuro ? "#d9f0df" : "#2c4a3e",
      alquiler: oscuro ? "#fffdf8" : "#1c1c1a",
    } satisfies Record<Categoria, string>,
  }
}

const MES_CORTO = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]
const MES_LARGO = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
]

type Punto = {
  clave: string
  nombre: string
  total: string
  valor: number
  color: string
  dibuja: boolean
}

const PALETA_EXTRA = ["#c4a15a", "#7d9a86", "#8d8474", "#b08968", "#6b705c"]

function colorCategoria(categoria: string, indice: number, fijos: Record<Categoria, string>): string {
  const clave = categoria.trim().toLowerCase()
  if (esCategoriaFija(clave)) return fijos[clave]
  return PALETA_EXTRA[indice % PALETA_EXTRA.length]
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

function partesPeriodo(periodo: string): { anio: number; mes: number } | null {
  const coincidencia = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(periodo)
  if (!coincidencia) return null
  return { anio: Number(coincidencia[1]), mes: Number(coincidencia[2]) }
}

function tickPeriodo(periodo: string, conAnio: boolean): string {
  const partes = partesPeriodo(periodo)
  if (!partes) return periodo
  const corto = MES_CORTO[partes.mes - 1]
  if (!conAnio) return corto
  return `${corto} ${String(partes.anio).slice(-2)}`
}

function etiquetaPeriodo(periodo: string): string {
  const partes = partesPeriodo(periodo)
  if (!partes) return periodo
  return `${MES_LARGO[partes.mes - 1]} ${partes.anio}`
}

function cifraEsAr(valor: number): string {
  const decimas = Math.round(valor * 10)
  const entero = decimas % 10 === 0
  return new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: entero ? 0 : 1,
    maximumFractionDigits: 1,
  }).format(decimas / 10)
}

function montoEje(valor: number): string {
  if (!Number.isFinite(valor)) return ""
  const signo = valor < 0 ? "-" : ""
  const abs = Math.abs(valor)
  if (abs < 1000) {
    const pesos = Math.round(abs)
    if (pesos >= 1000) return `${signo}$ ${cifraEsAr(pesos / 1000)} mil`
    const texto = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(pesos)
    return `${signo}$ ${texto}`
  }
  if (abs < 1_000_000) {
    const miles = abs / 1000
    if (Math.round(miles * 10) >= 10_000) return `${signo}$ ${cifraEsAr(abs / 1_000_000)} mill.`
    return `${signo}$ ${cifraEsAr(miles)} mil`
  }
  return `${signo}$ ${cifraEsAr(abs / 1_000_000)} mill.`
}

function centavosDe(total: string): bigint | null {
  if (!/^\d+\.\d{2}$/.test(total)) return null
  const [enteros, decimales] = total.split(".")
  return BigInt(enteros) * 100n + BigInt(decimales)
}

function textoCentavos(centavos: bigint): string {
  const enteros = centavos / 100n
  const decimales = (centavos % 100n).toString().padStart(2, "0")
  return `${enteros}.${decimales}`
}

function textoPorcentaje(total: string, suma: bigint): string {
  const parte = centavosDe(total)
  if (parte === null) return "—"
  if (suma <= 0n) return "0%"
  return `${Math.round((Number(parte) / Number(suma)) * 100)}%`
}

export function GraficoMeses({ porMes }: { porMes: TotalMes[] }) {
  const { oscuro } = useTema()
  const colores = coloresGrafico(oscuro)
  const tick = { fontSize: 11, fill: colores.ejes }
  const meses = [...porMes].sort((a, b) => a.periodo.localeCompare(b.periodo))
  const puntos = meses.map((item) => {
    const valor = escala(item.total)
    return {
      periodo: item.periodo,
      etiqueta: etiquetaPeriodo(item.periodo),
      total: item.total,
      valor: valor ?? 0,
      dibuja: valor !== null,
    }
  })
  const dibujo = puntos.filter((punto) => punto.dibuja)
  const anios = new Set(
    dibujo.flatMap((punto) => {
      const partes = partesPeriodo(punto.periodo)
      return partes ? [partes.anio] : []
    }),
  )
  const conAnio = anios.size > 1

  if (puntos.length === 0) {
    return <Text color="fg.muted">Sin totales por mes en este período.</Text>
  }

  if (dibujo.length === 0) {
    return <Text color="fg.muted">No hay montos para graficar en este período.</Text>
  }

  return (
    <Box h="14rem" w="100%" minW={0}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={dibujo} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={colores.grilla} />
          <XAxis
            dataKey="periodo"
            interval={0}
            tick={tick}
            stroke={colores.ejes}
            tickFormatter={(periodo) => tickPeriodo(String(periodo), conAnio)}
          />
          <YAxis width={84} tick={tick} stroke={colores.ejes} tickFormatter={(valor) => montoEje(Number(valor))} />
          <Tooltip
            {...colores.tooltip}
            formatter={formatoTotal}
            labelFormatter={(_etiqueta, carga) => {
              const punto = carga[0]?.payload as { etiqueta?: string } | undefined
              return punto?.etiqueta ?? ""
            }}
          />
          <Bar
            dataKey="valor"
            name="Total"
            fill="#e0b43a"
            barSize={28}
            radius={[6, 6, 0, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </Box>
  )
}

export function GraficoCategorias({ porCategoria }: { porCategoria: TotalCategoria[] }) {
  const { oscuro } = useTema()
  const colores = coloresGrafico(oscuro)
  const puntos: Punto[] = porCategoria.map((item, indice) => {
    const valor = escala(item.total)
    return {
      clave: `${item.categoria}-${indice}`,
      nombre: etiquetaCategoria(item.categoria),
      total: item.total,
      valor: valor ?? 0,
      color: colorCategoria(item.categoria, indice, colores.categoria),
      dibuja: valor !== null,
    }
  })
  const dibujo = puntos.filter((punto) => punto.dibuja)

  if (puntos.length === 0) {
    return <Text color="fg.muted">Sin totales por categoría en este período.</Text>
  }

  if (dibujo.length === 0) {
    return <Text color="fg.muted">No hay montos para graficar en este período.</Text>
  }

  const suma = dibujo.reduce((acumulado, punto) => acumulado + (centavosDe(punto.total) ?? 0n), 0n)

  return (
    <Flex direction={{ base: "column", md: "row" }} wrap={{ md: "wrap" }} align="center" justify="center" gap={4}>
      <Box position="relative" boxSize="14rem" flexShrink={0}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={dibujo}
              dataKey="valor"
              nameKey="nombre"
              innerRadius="58%"
              outerRadius="78%"
              paddingAngle={2}
              cornerRadius={8}
              stroke="none"
              isAnimationActive={false}
            >
              {dibujo.map((punto) => (
                <Cell key={punto.clave} fill={punto.color} />
              ))}
            </Pie>
            <Tooltip {...colores.tooltip} formatter={formatoTotal} />
          </PieChart>
        </ResponsiveContainer>
        <Flex
          position="absolute"
          inset="0"
          align="center"
          justify="center"
          direction="column"
          pointerEvents="none"
        >
          <Text fontSize="xs" color="fg.muted">
            Total
          </Text>
          <Text
            maxW="7.25rem"
            fontSize="sm"
            fontWeight="medium"
            lineHeight="1.2"
            textAlign="center"
            fontVariantNumeric="tabular-nums"
          >
            {formatMonto(textoCentavos(suma))}
          </Text>
        </Flex>
      </Box>
      <Stack flex={{ md: "1 1 12rem" }} w={{ base: "100%", md: "auto" }} minW={{ md: "12rem" }} gap={2}>
        {puntos.map((punto) => (
          <Flex key={punto.clave} align="center" gap={2} minW={0}>
            <Box w="8px" h="8px" borderRadius="full" bg={punto.color} flexShrink={0} />
            <Text flex="1" minW={0} truncate>
              {punto.nombre}
            </Text>
            <Text fontVariantNumeric="tabular-nums" whiteSpace="nowrap">
              {formatMonto(punto.total)}
            </Text>
            <Text
              minW="3rem"
              textAlign="end"
              color="fg.muted"
              fontVariantNumeric="tabular-nums"
              whiteSpace="nowrap"
            >
              {textoPorcentaje(punto.total, suma)}
            </Text>
          </Flex>
        ))}
      </Stack>
    </Flex>
  )
}
