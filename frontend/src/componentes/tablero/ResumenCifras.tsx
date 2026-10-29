import { Box, Flex, Grid, Heading, Stack, Text } from "@chakra-ui/react"
import { EsqueletoCifras } from "../esqueleto"
import { formatMonto } from "../../formato"

const SOMBRA = "0 12px 40px rgba(28, 27, 23, 0.06)"
const MONTO = /^\d+\.\d{2}$/
const columnas = { base: "1fr 1fr", md: "repeat(4, 1fr)" }

export function sumarMontos(totales: readonly string[]): string | null {
  let centavos = 0n
  let validos = 0
  for (const total of totales) {
    if (!MONTO.test(total)) continue
    const [enteros, decimales] = total.split(".")
    centavos += BigInt(enteros) * 100n + BigInt(decimales)
    validos += 1
  }
  if (validos === 0) return null
  const enteros = centavos / 100n
  const decimales = (centavos % 100n).toString().padStart(2, "0")
  return `${enteros}.${decimales}`
}

type Props = {
  saludo: string
  etiquetaPeriodo: string
  total: string | null
  confirmados: number | null
  borradores: number | null
  categorias: number | null
  cargando: boolean
}

function textoTotal(total: string | null): string {
  if (total === null) return "—"
  return formatMonto(total)
}

function textoConteo(valor: number | null): string {
  if (valor === null) return "—"
  return String(valor)
}

function TarjetaCifra({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <Stack
      gap={1}
      h="100%"
      bg="bg.panel"
      borderRadius="20px"
      boxShadow={SOMBRA}
      px={4}
      py={3}
      _dark={{ borderWidth: "1px", borderColor: "borde" }}
    >
      <Text fontSize="xs" color="fg.muted">
        {etiqueta}
      </Text>
      <Text
        color="fg"
        fontFamily="inherit"
        fontSize={{ base: "1.35rem", md: "1.5rem" }}
        fontWeight="medium"
        letterSpacing="-0.03em"
        lineHeight="1.1"
        fontVariantNumeric="tabular-nums"
      >
        {valor}
      </Text>
    </Stack>
  )
}

function Leyenda({ fondo, etiqueta, porcentaje }: { fondo: string; etiqueta: string; porcentaje: number }) {
  return (
    <Flex align="center" gap={2}>
      <Box w="8px" h="8px" borderRadius="full" bg={fondo} flexShrink={0} />
      <Text fontSize="xs" color="fg.muted" whiteSpace="nowrap">
        {etiqueta}{" "}
        <Text as="span" color="fg" fontWeight="medium" fontVariantNumeric="tabular-nums">
          {porcentaje}%
        </Text>
      </Text>
    </Flex>
  )
}

function BarraParticipacion({ confirmados, borradores }: { confirmados: number; borradores: number }) {
  const suma = confirmados + borradores
  const pctConfirmados = Math.round((confirmados / suma) * 100)
  const pctBorradores = 100 - pctConfirmados
  return (
    <Flex
      role="group"
      aria-label={`Confirmados ${pctConfirmados}%, borradores ${pctBorradores}%`}
      align="center"
      gap={3}
      wrap="wrap"
    >
      <Flex
        aria-hidden="true"
        h="6px"
        flexShrink={0}
        borderRadius="full"
        overflow="hidden"
        bg="bg.subtle"
        css={{ width: "min(15rem, 100%)" }}
      >
        {confirmados > 0 ? (
          <Box h="100%" flexShrink={0} w={`${(confirmados / suma) * 100}%`} bg="marca.sol" />
        ) : null}
        {borradores > 0 ? (
          <Box h="100%" flexShrink={0} w={`${(borradores / suma) * 100}%`} bg="fg" />
        ) : null}
      </Flex>
      <Flex align="center" gap={3} wrap="wrap">
        <Leyenda fondo="marca.sol" etiqueta="Confirmados" porcentaje={pctConfirmados} />
        <Leyenda fondo="fg" etiqueta="Borradores" porcentaje={pctBorradores} />
      </Flex>
    </Flex>
  )
}

function barraDe(confirmados: number | null, borradores: number | null) {
  if (confirmados === null || borradores === null) return null
  if (confirmados + borradores <= 0) return null
  return <BarraParticipacion confirmados={confirmados} borradores={borradores} />
}

export function ResumenCifras({
  saludo,
  etiquetaPeriodo,
  total,
  confirmados,
  borradores,
  categorias,
  cargando,
}: Props) {
  return (
    <Stack gap={5}>
      <Stack gap={2}>
        <Heading
          as="h1"
          color="fg"
          fontFamily="inherit"
          fontSize={{ base: "1.75rem", md: "2rem" }}
          fontWeight="medium"
          letterSpacing="-0.03em"
          lineHeight="1.1"
        >
          {saludo}
        </Heading>
        <Text color="fg.muted" fontSize="sm">
          {etiquetaPeriodo}
        </Text>
      </Stack>
      {cargando ? (
        <EsqueletoCifras />
      ) : (
        <Grid templateColumns={columnas} gap={3}>
          <TarjetaCifra etiqueta="Total gastado" valor={textoTotal(total)} />
          <TarjetaCifra etiqueta="Comprobantes" valor={textoConteo(confirmados)} />
          <TarjetaCifra etiqueta="Borradores" valor={textoConteo(borradores)} />
          <TarjetaCifra etiqueta="Categorías" valor={textoConteo(categorias)} />
        </Grid>
      )}
      {cargando ? null : barraDe(confirmados, borradores)}
    </Stack>
  )
}
