import { Box, Button, Flex, Stack, Text } from "@chakra-ui/react"
import { useEffect, useRef, useState } from "react"
import { Link } from "react-router"
import type { Notificacion } from "../api/tipos"
import { publicarPanel } from "../canalBus"
import { useCanal } from "../canal"
import { panel, pop } from "../movimiento"

function IconoCampana() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 16 16" fill="none">
      <path
        d="M8 1.6a3.4 3.4 0 0 0-3.4 3.4c0 1.7-.6 2.6-1.2 3.3-.4.4-.7.8-.7 1.3h10.6c0-.5-.3-.9-.7-1.3-.6-.7-1.2-1.6-1.2-3.3A3.4 3.4 0 0 0 8 1.6Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M6.4 12.2a1.6 1.6 0 0 0 3.2 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function hora(iso: string): string {
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return ""
  return new Intl.DateTimeFormat("es-AR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(fecha)
}

function tono(item: Notificacion): "ok" | "aviso" | "falla" | "neutro" {
  const etiqueta = item.accion?.etiqueta
  if (item.tipo === "chat.estado") {
    if (etiqueta === "Reintentar") return "falla"
    if (etiqueta === "Revisar") return "aviso"
    return "ok"
  }
  if (item.tipo === "carga.estado") return etiqueta === "Volver a cargar" ? "falla" : "ok"
  return "neutro"
}

const COLOR = {
  ok: "estado.ok",
  aviso: "estado.aviso",
  falla: "estado.falla",
  neutro: "fg.muted",
} as const

export function Campana() {
  const { notificaciones, noLeidas, marcarLeida, marcarTodas, limpiarLeidas } = useCanal()
  const hayLeidas = notificaciones.some((item) => item.leida)
  const [abierto, setAbierto] = useState(false)
  const caja = useRef<HTMLDivElement>(null)

  useEffect(() => {
    publicarPanel(abierto)
    return () => publicarPanel(false)
  }, [abierto])

  useEffect(() => {
    if (!abierto) return
    function alClick(evento: MouseEvent) {
      if (!caja.current?.contains(evento.target as Node)) setAbierto(false)
    }
    function alEscape(evento: KeyboardEvent) {
      if (evento.key === "Escape") setAbierto(false)
    }
    document.addEventListener("mousedown", alClick)
    document.addEventListener("keydown", alEscape)
    return () => {
      document.removeEventListener("mousedown", alClick)
      document.removeEventListener("keydown", alEscape)
    }
  }, [abierto])

  const etiqueta =
    noLeidas > 0 ? `Notificaciones, ${noLeidas} sin leer` : "Notificaciones"

  return (
    <Box ref={caja} position="relative">
      <Button
        type="button"
        variant="ghost"
        borderRadius="full"
        color="fg"
        aria-label={etiqueta}
        aria-expanded={abierto}
        aria-haspopup="dialog"
        position="relative"
        px={3}
        _hover={{ bg: "bg.hover", color: "fg" }}
        onClick={() => setAbierto((valor) => !valor)}
      >
        <IconoCampana />
        {noLeidas > 0 ? (
          <Flex
            key={noLeidas}
            aria-hidden="true"
            position="absolute"
            top="1"
            right="1"
            minW="16px"
            h="16px"
            px="1"
            align="center"
            justify="center"
            borderRadius="full"
            bg="marca.sol"
            color="marca.carbon"
            fontSize="10px"
            fontWeight="medium"
            lineHeight="1"
            css={pop}
          >
            {noLeidas > 9 ? "9+" : noLeidas}
          </Flex>
        ) : null}
      </Button>
      {abierto ? (
        <Box
          role="dialog"
          aria-label="Notificaciones"
          position="absolute"
          top="calc(100% + 8px)"
          right="0"
          zIndex={20}
          w={{ base: "min(22rem, calc(100vw - 2rem))", md: "22rem" }}
          maxH="24rem"
          overflowY="auto"
          bg="bg.panel"
          color="fg"
          borderWidth="1px"
          borderColor="borde"
          borderRadius="16px"
          boxShadow="0 16px 40px rgba(28, 27, 23, 0.16)"
          p={3}
          css={panel}
        >
          <Flex align="center" justify="space-between" gap={2} mb={2} px={1} wrap="wrap">
            <Text fontWeight="medium">Notificaciones</Text>
            {hayLeidas || noLeidas > 0 ? (
              <Flex gap={1} wrap="wrap" justify="flex-end">
                {hayLeidas ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    borderRadius="full"
                    color="fg.muted"
                    _hover={{ bg: "bg.hover", color: "fg" }}
                    onClick={() => void limpiarLeidas()}
                  >
                    Limpiar leídas
                  </Button>
                ) : null}
                {noLeidas > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    borderRadius="full"
                    color="fg.muted"
                    _hover={{ bg: "bg.hover", color: "fg" }}
                    onClick={() => void marcarTodas()}
                  >
                    Marcar todas
                  </Button>
                ) : null}
              </Flex>
            ) : null}
          </Flex>
          {notificaciones.length === 0 ? (
            <Text color="fg.muted" fontSize="sm" px={1} py={4}>
              Cuando haya algo nuevo, va a aparecer acá.
            </Text>
          ) : (
            <Stack gap={2}>
              {notificaciones.map((item) => (
                <Box
                  key={item.id}
                  borderRadius="12px"
                  bg={item.leida ? "transparent" : "bg.subtle"}
                  px={3}
                  py={3}
                >
                  <Flex align="flex-start" gap={2}>
                    <Box
                      aria-hidden="true"
                      mt="6px"
                      w="8px"
                      h="8px"
                      flexShrink={0}
                      borderRadius="full"
                      bg={COLOR[tono(item)]}
                      opacity={item.leida ? 0.35 : 1}
                    />
                    <Stack gap={1} flex="1" minW={0}>
                      <Flex justify="space-between" gap={3} align="baseline">
                        <Text fontWeight="medium" fontSize="sm">
                          {item.titulo}
                        </Text>
                        <Text color="fg.muted" fontSize="xs" flexShrink={0}>
                          {hora(item.creada_en)}
                        </Text>
                      </Flex>
                      {item.cuerpo ? (
                        <Text color="fg.muted" fontSize="sm" lineHeight="1.4">
                          {item.cuerpo}
                        </Text>
                      ) : null}
                      <Flex gap={2} mt={1} wrap="wrap">
                        {item.accion ? (
                          <Button asChild size="sm" borderRadius="full" bg="marca.sol" color="marca.carbon" _hover={{ bg: "#e8bc45" }}>
                            <Link
                              to={item.accion.ruta}
                              onClick={() => {
                                void marcarLeida(item.id)
                                setAbierto(false)
                              }}
                            >
                              {item.accion.etiqueta}
                            </Link>
                          </Button>
                        ) : null}
                        {!item.leida ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            borderRadius="full"
                            color="fg.muted"
                            _hover={{ bg: "bg.hover", color: "fg" }}
                            onClick={() => void marcarLeida(item.id)}
                          >
                            Marcar leída
                          </Button>
                        ) : null}
                      </Flex>
                    </Stack>
                  </Flex>
                </Box>
              ))}
            </Stack>
          )}
        </Box>
      ) : null}
    </Box>
  )
}
