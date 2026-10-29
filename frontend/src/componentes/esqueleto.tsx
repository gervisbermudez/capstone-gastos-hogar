import { Box, Flex, Grid, Skeleton, Stack, Text, type BoxProps, type SkeletonProps } from "@chakra-ui/react"
import { type ReactNode } from "react"
import { Logotipo } from "./Logotipo"

const SOMBRA = "0 12px 40px rgba(28, 27, 23, 0.06)"
const SOMBRA_MARCO = "0 24px 60px rgba(28, 27, 23, 0.12)"

const BRILLO = {
  "--duration": "1.4s",
  "--start-color": "#e4dcc6",
  "--end-color": "#f6f1e4",
  flexShrink: 1,
  _dark: {
    "--start-color": "#4a4944",
    "--end-color": "#65635c",
  },
} as const

const ALTOS_BARRA = ["4.2rem", "7.2rem", "5.4rem", "9.2rem", "3.6rem", "8rem", "6.1rem"]
const ETIQUETAS_CIFRA = ["Total gastado", "Comprobantes", "Borradores", "Categorías"]

function rango(cantidad: number): number[] {
  return Array.from({ length: cantidad }, (_, indice) => indice)
}

export function Hueso({
  alto,
  ancho,
  radio = "12px",
  ...resto
}: {
  alto: SkeletonProps["height"]
  ancho?: SkeletonProps["width"]
  radio?: SkeletonProps["borderRadius"]
} & Omit<SkeletonProps, "height" | "width" | "borderRadius">) {
  return (
    <Skeleton
      aria-hidden="true"
      height={alto}
      width={ancho}
      maxW="100%"
      borderRadius={radio}
      variant="shine"
      css={BRILLO}
      {...resto}
    />
  )
}

function RegionCarga({
  etiqueta,
  silencio = false,
  children,
}: {
  etiqueta: string
  silencio?: boolean
  children: ReactNode
}) {
  if (silencio) return children
  return (
    <Box role="status" aria-busy="true" aria-label={etiqueta}>
      <Text as="span" srOnly>
        {etiqueta}
      </Text>
      {children}
    </Box>
  )
}

function Lamina({ children, ...resto }: BoxProps) {
  return (
    <Box
      bg="bg.panel"
      borderRadius="20px"
      boxShadow={SOMBRA}
      _dark={{ borderWidth: "1px", borderColor: "borde" }}
      {...resto}
    >
      {children}
    </Box>
  )
}

function Titulo({ ancho = "14rem", detalle = "18rem" }: { ancho?: string; detalle?: string }) {
  return (
    <Stack gap={2}>
      <Hueso alto={{ base: "2rem", md: "2.5rem" }} ancho={ancho} />
      <Hueso alto="0.9rem" ancho={detalle} />
    </Stack>
  )
}

export function EsqueletoCifras({ silencio = false }: { silencio?: boolean }) {
  return (
    <RegionCarga etiqueta="Cargando el resumen" silencio={silencio}>
      <Stack gap={4}>
        <Grid templateColumns={{ base: "1fr 1fr", md: "repeat(4, 1fr)" }} gap={3}>
          {ETIQUETAS_CIFRA.map((etiqueta) => (
            <Lamina key={etiqueta} px={4} py={3}>
              <Stack gap={2}>
                <Text fontSize="xs" color="fg.muted">
                  {etiqueta}
                </Text>
                <Hueso alto="1.5rem" ancho="4.75rem" />
              </Stack>
            </Lamina>
          ))}
        </Grid>
        <Flex align="center" gap={3} wrap="wrap">
          <Hueso alto="6px" ancho="15rem" radio="full" />
          <Hueso alto="0.7rem" ancho="7.5rem" radio="8px" />
          <Hueso alto="0.7rem" ancho="6.5rem" radio="8px" />
        </Flex>
      </Stack>
    </RegionCarga>
  )
}

export function EsqueletoGrafico({ variante }: { variante: "barras" | "torta" }) {
  if (variante === "torta") {
    return (
      <Flex align="center" justify="center" h="14rem" aria-hidden="true">
        <Hueso alto="10rem" ancho="10rem" radio="full" />
      </Flex>
    )
  }
  return (
    <Flex align="flex-end" gap={2} h="14rem" aria-hidden="true">
      {ALTOS_BARRA.map((alto, indice) => (
        <Hueso key={indice} alto={alto} flex="1" radio="8px" />
      ))}
    </Flex>
  )
}

export function EsqueletoTabla({
  etiqueta,
  filas = 6,
  columnas = 6,
  conAvatar = false,
  silencio = false,
}: {
  etiqueta: string
  filas?: number
  columnas?: number
  conAvatar?: boolean
  silencio?: boolean
}) {
  const tarjetas = Math.min(filas, 4)
  return (
    <RegionCarga etiqueta={etiqueta} silencio={silencio}>
      <Stack gap={3} display={{ base: "flex", md: "none" }}>
        {rango(tarjetas).map((indice) => (
          <Lamina key={indice} px={4} py={4}>
            <Stack gap={3}>
              <Flex justify="space-between" align="center" gap={3}>
                <Flex align="center" gap={2} flex="1" minW={0}>
                  {conAvatar ? <Hueso alto="2rem" ancho="2rem" radio="full" /> : null}
                  <Hueso alto="0.9rem" ancho="62%" />
                </Flex>
                <Hueso alto="1.25rem" ancho="4.5rem" radio="full" />
              </Flex>
              <Hueso alto="0.75rem" ancho="74%" />
              <Hueso alto="0.9rem" ancho="38%" />
            </Stack>
          </Lamina>
        ))}
      </Stack>
      <Lamina display={{ base: "none", md: "block" }} px={0} py={0} overflow="hidden">
        <Flex gap={4} px={4} py={3} borderBottomWidth="1px" borderColor="borde">
          {rango(columnas).map((indice) => (
            <Hueso key={indice} alto="0.7rem" flex="1" />
          ))}
        </Flex>
        <Stack gap={0}>
          {rango(filas).map((fila) => (
            <Flex
              key={fila}
              gap={4}
              align="center"
              px={4}
              py={3}
              borderBottomWidth={fila === filas - 1 ? "0" : "1px"}
              borderColor="borde"
            >
              {rango(columnas).map((columna) => (
                <Flex key={columna} flex="1" align="center" gap={2} minW={0}>
                  {conAvatar && columna === 0 ? <Hueso alto="2rem" ancho="2rem" radio="full" /> : null}
                  <Hueso
                    alto={columna === columnas - 2 ? "1.25rem" : "0.8rem"}
                    ancho={columna === columnas - 1 ? "2.25rem" : "78%"}
                    radio={columna === columnas - 2 ? "full" : "8px"}
                  />
                </Flex>
              ))}
            </Flex>
          ))}
        </Stack>
      </Lamina>
    </RegionCarga>
  )
}

export function EsqueletoBorradores({ silencio = false }: { silencio?: boolean }) {
  return (
    <RegionCarga etiqueta="Cargando borradores" silencio={silencio}>
      <Stack gap={3}>
        {rango(3).map((indice) => (
          <Flex
            key={indice}
            direction={{ base: "column", sm: "row" }}
            justify="space-between"
            align={{ base: "flex-start", sm: "center" }}
            gap={3}
          >
            <Stack gap={2} flex="1" minW={0} w="100%">
              <Hueso alto="0.9rem" ancho="42%" />
              <Hueso alto="0.7rem" ancho="68%" />
            </Stack>
            <Flex gap={2}>
              <Hueso alto="2rem" ancho="5rem" radio="full" />
              <Hueso alto="2rem" ancho="5.5rem" radio="full" />
            </Flex>
          </Flex>
        ))}
      </Stack>
    </RegionCarga>
  )
}

export function EsqueletoFilas({
  etiqueta,
  filas = 4,
  silencio = false,
}: {
  etiqueta: string
  filas?: number
  silencio?: boolean
}) {
  return (
    <RegionCarga etiqueta={etiqueta} silencio={silencio}>
      <Stack gap={1}>
        {rango(filas).map((indice) => (
          <Flex key={indice} align="center" gap={3} minH="2.75rem" px={2} py={1.5}>
            <Stack gap={1.5} flex="1" minW={0}>
              <Hueso alto="0.8rem" ancho={indice % 2 === 0 ? "74%" : "52%"} />
              <Hueso alto="0.65rem" ancho="36%" />
            </Stack>
          </Flex>
        ))}
      </Stack>
    </RegionCarga>
  )
}

export function EsqueletoHilo({ silencio = false }: { silencio?: boolean }) {
  const burbujas: { lado: "inicio" | "fin"; anchos: string[] }[] = [
    { lado: "inicio", anchos: ["16rem", "12rem", "7.5rem"] },
    { lado: "fin", anchos: ["11rem", "6.5rem"] },
    { lado: "inicio", anchos: ["14rem", "9rem"] },
  ]
  return (
    <RegionCarga etiqueta="Abriendo la conversación" silencio={silencio}>
      <Stack gap={3} w="100%">
        {burbujas.map((burbuja, indice) => (
          <Flex key={indice} justify={burbuja.lado === "fin" ? "flex-end" : "flex-start"}>
            <Lamina maxW={{ base: "88%", md: "75%" }} px={4} py={3} borderRadius="20px">
              <Stack gap={2}>
                {burbuja.anchos.map((ancho) => (
                  <Hueso key={ancho} alto="0.8rem" ancho={ancho} />
                ))}
              </Stack>
            </Lamina>
          </Flex>
        ))}
      </Stack>
    </RegionCarga>
  )
}

export function EsqueletoVista() {
  return (
    <RegionCarga etiqueta="Abriendo el archivo">
      <Hueso alto={{ base: "16rem", md: "24rem" }} radio="16px" />
    </RegionCarga>
  )
}

export function EsqueletoLineas({ etiqueta, anchos }: { etiqueta: string; anchos: string[] }) {
  return (
    <RegionCarga etiqueta={etiqueta}>
      <Stack gap={2}>
        {anchos.map((ancho, indice) => (
          <Hueso key={indice} alto="0.9rem" ancho={ancho} />
        ))}
      </Stack>
    </RegionCarga>
  )
}

export function EsqueletoCampo({ etiqueta }: { etiqueta: string }) {
  return (
    <RegionCarga etiqueta={etiqueta}>
      <Hueso alto="2.5rem" radio="16px" />
    </RegionCarga>
  )
}

export function EsqueletoRevision({ silencio = false }: { silencio?: boolean }) {
  return (
    <RegionCarga etiqueta="Abriendo el comprobante" silencio={silencio}>
      <Stack gap={{ base: 5, md: 6 }}>
        <Flex align="center" gap={3}>
          <Hueso alto={{ base: "2.75rem", md: "3.25rem" }} ancho={{ base: "2.75rem", md: "3.25rem" }} radio="full" />
          <Hueso alto={{ base: "2.15rem", md: "2.85rem" }} ancho="min(16rem, 70%)" />
        </Flex>
        <Grid
          templateColumns={{ base: "1fr", lg: "minmax(0, 1.45fr) minmax(18rem, 0.9fr)" }}
          gap={{ base: 4, md: 6 }}
          alignItems="start"
        >
          <Stack gap={4}>
            <Lamina px={5} py={5}>
              <Stack gap={4}>
                <Hueso alto={{ base: "2.4rem", md: "3.15rem" }} ancho="10rem" />
                <Hueso alto="0.85rem" ancho="8rem" />
                <Flex gap={2}>
                  <Hueso alto="1.5rem" ancho="5.5rem" radio="full" />
                  <Hueso alto="1.5rem" ancho="6rem" radio="full" />
                  <Hueso alto="1.5rem" ancho="3.5rem" radio="full" />
                </Flex>
              </Stack>
            </Lamina>
            <Lamina px={5} py={5}>
              <Stack gap={4}>
                <Hueso alto="1.1rem" ancho="7rem" />
                <Hueso alto={{ base: "16rem", md: "24rem" }} radio="16px" />
              </Stack>
            </Lamina>
          </Stack>
          <Stack gap={4}>
            <Lamina px={5} py={5}>
              <Stack gap={4}>
                <Hueso alto="1.1rem" ancho="9rem" />
                {rango(7).map((indice) => (
                  <Flex key={indice} align="center" gap={3}>
                    <Hueso alto="1.25rem" ancho="1.25rem" radio="8px" />
                    <Stack gap={1.5} flex="1">
                      <Hueso alto="0.65rem" ancho="5rem" />
                      <Hueso alto="0.85rem" ancho={indice % 2 === 0 ? "70%" : "48%"} />
                    </Stack>
                  </Flex>
                ))}
              </Stack>
            </Lamina>
            <Lamina px={5} py={5}>
              <Stack gap={3}>
                <Hueso alto="1.1rem" ancho="4rem" />
                <EsqueletoFilas etiqueta="Buscando chats" filas={2} silencio />
                <Hueso alto="2rem" ancho="6.5rem" radio="full" />
              </Stack>
            </Lamina>
          </Stack>
        </Grid>
      </Stack>
    </RegionCarga>
  )
}

function EsqueletoInicio() {
  return (
    <Stack gap={{ base: 6, md: 8 }}>
      <Titulo ancho="12rem" detalle="8rem" />
      <EsqueletoCifras silencio />
      <Grid templateColumns={{ base: "1fr", lg: "repeat(2, minmax(0, 1fr))" }} gap={{ base: 4, lg: 5 }}>
        <Lamina px={5} py={5}>
          <Stack gap={4}>
            <Text fontWeight="medium" color="fg" letterSpacing="-0.03em">
              Total por mes
            </Text>
            <EsqueletoGrafico variante="barras" />
          </Stack>
        </Lamina>
        <Lamina px={5} py={5}>
          <Stack gap={4}>
            <Text fontWeight="medium" color="fg" letterSpacing="-0.03em">
              Total por categoría
            </Text>
            <EsqueletoGrafico variante="torta" />
          </Stack>
        </Lamina>
      </Grid>
      <Stack gap={3}>
        <Hueso alto="1.5rem" ancho="16rem" />
        <EsqueletoTabla etiqueta="Cargando comprobantes" filas={4} columnas={5} silencio />
      </Stack>
      <Lamina px={5} py={5} borderLeftWidth="3px" borderLeftColor="marca.sol">
        <Stack gap={4}>
          <Hueso alto="1.1rem" ancho="12rem" />
          <EsqueletoBorradores silencio />
        </Stack>
      </Lamina>
    </Stack>
  )
}

function EsqueletoListado({ columnas, conAvatar = false }: { columnas: number; conAvatar?: boolean }) {
  return (
    <Stack gap={{ base: 6, md: 8 }}>
      <Titulo />
      <Lamina px={4} py={3}>
        <Flex direction={{ base: "column", md: "row" }} gap={3}>
          <Hueso alto="2.5rem" radio="16px" flex="1" />
          <Hueso alto="2.5rem" radio="16px" flex="1" />
          <Hueso alto="2.5rem" radio="16px" flex="2" />
        </Flex>
      </Lamina>
      <EsqueletoTabla etiqueta="Cargando el listado" filas={6} columnas={columnas} conAvatar={conAvatar} silencio />
    </Stack>
  )
}

function EsqueletoCargar() {
  return (
    <Stack gap={{ base: 6, md: 8 }}>
      <Titulo ancho="18rem" detalle="22rem" />
      <Lamina px={{ base: 5, md: 10 }} py={{ base: 6, md: 10 }}>
        <Stack gap={4} align="center">
          <Hueso alto={{ base: "12rem", md: "16rem" }} radio="20px" />
          <Hueso alto="2.75rem" ancho="10rem" radio="full" />
        </Stack>
      </Lamina>
    </Stack>
  )
}

function EsqueletoChatPantalla() {
  return (
    <Flex flex="1" minH={0} h="100%">
      <Stack
        display={{ base: "none", lg: "flex" }}
        w="280px"
        flexShrink={0}
        gap={3}
        px={3}
        py={4}
        bg="bg.subtle"
        borderRightWidth="1px"
        borderColor="borde"
      >
        <Hueso alto="1.15rem" ancho="8rem" />
        <Hueso alto="2rem" radio="full" />
        <EsqueletoFilas etiqueta="Cargando conversaciones" filas={6} silencio />
      </Stack>
      <Flex direction="column" flex="1" minW={0} minH={0}>
        <Flex align="center" h="52px" px={{ base: 4, md: 6 }} borderBottomWidth="1px" borderColor="borde">
          <Hueso alto="1rem" ancho="10rem" />
        </Flex>
        <Box flex="1" minH={0} overflow="hidden" px={{ base: 4, md: 6 }} py={4}>
          <EsqueletoHilo silencio />
        </Box>
        <Box px={{ base: 4, md: 6 }} py={4} borderTopWidth="1px" borderColor="borde">
          <Hueso alto="4.5rem" radio="24px" />
        </Box>
      </Flex>
    </Flex>
  )
}

function EsqueletoOpciones() {
  return (
    <Stack gap={{ base: 6, md: 8 }} maxW="40rem">
      <Titulo ancho="10rem" detalle="24rem" />
      {rango(4).map((indice) => (
        <Lamina key={indice} px={5} py={5}>
          <Stack gap={4}>
            <Hueso alto="1.1rem" ancho="7rem" />
            <Hueso alto="2.75rem" radio="16px" />
            <Hueso alto="2.75rem" radio="16px" />
            <Hueso alto="2.5rem" ancho="8rem" radio="full" />
          </Stack>
        </Lamina>
      ))}
    </Stack>
  )
}

function contenidoDe(pathname: string): ReactNode {
  if (pathname === "/") return <EsqueletoInicio />
  if (pathname === "/registros") return <EsqueletoListado columnas={6} conAvatar />
  if (pathname.startsWith("/documentos")) return <EsqueletoRevision silencio />
  if (pathname === "/categorias") return <EsqueletoListado columnas={3} />
  if (pathname === "/cargar" || pathname.startsWith("/cargar")) return <EsqueletoCargar />
  if (pathname === "/chat" || pathname.startsWith("/chat")) return <EsqueletoChatPantalla />
  if (pathname === "/opciones") return <EsqueletoOpciones />
  return <EsqueletoInicio />
}

export function EsqueletoMarco({ pathname }: { pathname: string }) {
  const chat = pathname === "/chat" || pathname.startsWith("/chat")
  return (
    <Flex minH="100vh" h="100vh" direction="column" overflow="hidden" bg="transparent" p={{ base: 2, md: 3 }}>
      <Flex
        role="status"
        aria-busy="true"
        aria-label="Cargando la sesión"
        flex="1"
        minH={0}
        minW={0}
        direction={{ base: "column", md: "row" }}
        bg="bg"
        borderRadius="l3"
        overflow="hidden"
        boxShadow={SOMBRA_MARCO}
        _dark={{ borderWidth: "1px", borderColor: "borde" }}
      >
        <Text as="span" srOnly>
          Cargando la sesión
        </Text>
        <Flex
          display={{ base: "none", md: "flex" }}
          direction="column"
          w="240px"
          flexShrink={0}
          minH={0}
          bg="bg.subtle"
          px={4}
          py={6}
          gap={8}
        >
          <Logotipo tamano="sm" />
          <Stack gap={2}>
            {rango(5).map((indice) => (
              <Hueso key={indice} alto="2.5rem" radio="full" />
            ))}
          </Stack>
          <Stack gap={3} mt="auto">
            <Hueso alto="0.85rem" ancho="70%" />
            <Hueso alto="2.5rem" radio="full" />
          </Stack>
        </Flex>
        <Flex direction="column" flex="1" minW={0} minH={0}>
          <Flex
            align="center"
            justify="space-between"
            gap={3}
            px={{ base: 3, md: 4 }}
            h="56px"
            flexShrink={0}
            borderBottomWidth="1px"
            borderColor="borde"
          >
            <Hueso alto="2.5rem" ancho="4.5rem" radio="full" display={{ base: "block", md: "none" }} />
            <Box display={{ base: "none", md: "block" }} />
            <Flex align="center" gap={2}>
              <Hueso alto="1.25rem" ancho="2.25rem" radio="full" />
              <Hueso alto="2rem" ancho="2rem" radio="full" />
            </Flex>
          </Flex>
          <Box
            as="main"
            flex="1"
            minH={0}
            minW={0}
            display="flex"
            flexDirection="column"
            overflow={chat ? "hidden" : "auto"}
            px={chat ? 0 : { base: 4, md: 6 }}
            py={chat ? 0 : { base: 4, md: 6 }}
          >
            {contenidoDe(pathname)}
          </Box>
        </Flex>
      </Flex>
    </Flex>
  )
}

export function EsqueletoDocumento() {
  return (
    <Lamina px={4} py={4} w="min(100%, 18rem)">
      <Stack gap={2}>
        <Hueso alto="0.9rem" ancho="68%" />
        <Hueso alto="0.7rem" ancho="100%" />
        <Hueso alto="0.7rem" ancho="92%" />
        <Hueso alto="0.7rem" ancho="60%" />
      </Stack>
    </Lamina>
  )
}
