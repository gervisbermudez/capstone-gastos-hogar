import { Alert, Box, Button, Input, Skeleton, Stack, Text } from "@chakra-ui/react"
import { useState, type JSX } from "react"
import type { Hilo } from "../../api/tipos"
import { agruparHilos } from "../../chat/historial"

export function ListaConversaciones({
  hilos,
  error,
  activoId,
  bloqueado,
  onNueva,
  onAbrir,
  onReintentar,
  conCierre = false,
}: {
  hilos: Hilo[] | null
  error: string | null
  activoId: string | null
  bloqueado: boolean
  onNueva: () => void
  onAbrir: (threadId: string) => void
  onReintentar: () => void
  conCierre?: boolean
}): JSX.Element {
  const [consulta, setConsulta] = useState("")

  let cuerpo: JSX.Element
  if (error) {
    cuerpo = (
      <>
        <Alert.Root status="error">
          <Alert.Indicator />
          <Alert.Description>{error}</Alert.Description>
        </Alert.Root>
        <Button type="button" size="sm" variant="outline" mt={3} onClick={onReintentar}>
          Reintentar
        </Button>
      </>
    )
  } else if (hilos === null) {
    cuerpo = (
      <Stack gap={2}>
        <Skeleton height="2.75rem" borderRadius="16px" />
        <Skeleton height="2.75rem" borderRadius="16px" />
        <Skeleton height="2.75rem" borderRadius="16px" />
        <Skeleton height="2.75rem" borderRadius="16px" />
      </Stack>
    )
  } else if (hilos.length === 0) {
    cuerpo = (
      <Text fontSize="sm" color="fg.muted" px={2}>
        Todavía no hay conversaciones.
      </Text>
    )
  } else {
    const grupos = agruparHilos(hilos, consulta)
    cuerpo =
      grupos.length === 0 ? (
        <Text fontSize="sm" color="fg.muted" px={2}>
          Ninguna conversación coincide.
        </Text>
      ) : (
        <Stack as="nav" aria-label="Conversaciones anteriores" gap={4}>
          {grupos.map((grupo) => (
            <Stack key={grupo.etiqueta} gap={1}>
              <Text fontSize="xs" fontWeight="medium" color="fg.muted" px={2}>
                {grupo.etiqueta}
              </Text>
              {grupo.items.map((item) => {
                const activo = item.thread_id === activoId
                return (
                  <Button
                    key={item.thread_id}
                    type="button"
                    variant="ghost"
                    w="100%"
                    h="auto"
                    justifyContent="flex-start"
                    borderRadius="16px"
                    py={2}
                    px={3}
                    whiteSpace="normal"
                    textAlign="left"
                    disabled={bloqueado}
                    aria-current={activo ? "true" : undefined}
                    bg={activo ? "marca.carbon" : "transparent"}
                    color={activo ? "marca.papel" : "marca.carbon"}
                    _hover={
                      activo
                        ? { bg: "marca.carbon", color: "marca.papel" }
                        : { bg: "marca.papel", color: "marca.carbon" }
                    }
                    _disabled={{
                      opacity: activo ? 1 : 0.72,
                      cursor: "not-allowed",
                      bg: activo ? "marca.carbon" : "transparent",
                      color: activo ? "marca.papel" : "marca.carbon",
                    }}
                    onClick={() => onAbrir(item.thread_id)}
                  >
                    <Stack as="span" gap={0} minW={0} align="stretch" w="100%">
                      <Text
                        as="span"
                        fontSize="sm"
                        fontWeight={activo ? "medium" : "normal"}
                        lineClamp={2}
                        overflowWrap="anywhere"
                      >
                        {item.titulo.trim() || "Sin título"}
                      </Text>
                      {item.cuando ? (
                        <Text as="span" display="block" fontSize="xs" color={activo ? "marca.lino" : "fg.muted"}>
                          {item.cuando}
                        </Text>
                      ) : null}
                    </Stack>
                  </Button>
                )
              })}
            </Stack>
          ))}
        </Stack>
      )
  }

  return (
    <Box h="100%" minH={0} display="flex" flexDirection="column" overflow="hidden">
      <Box ps={3} pe={conCierre ? 12 : 3} pt={4} pb={2}>
        <Text fontFamily="heading" fontWeight="semibold" fontSize="lg" color="marca.carbon">
          Conversaciones
        </Text>
        <Button
          type="button"
          size="sm"
          variant="solid"
          bg="marca.carbon"
          color="marca.papel"
          borderRadius="full"
          w="100%"
          mt={3}
          _hover={{ bg: "marca.grafito", color: "marca.papel" }}
          _disabled={{ opacity: 0.72, bg: "marca.carbon", color: "marca.papel" }}
          disabled={bloqueado}
          onClick={onNueva}
        >
          Nueva
        </Button>
      </Box>
      <Box px={3} pb={2}>
        <Input
          size="sm"
          borderRadius="full"
          bg="marca.papel"
          color="marca.carbon"
          borderColor="rgba(28, 28, 26, 0.12)"
          _placeholder={{ color: "fg.muted" }}
          placeholder="Buscar"
          aria-label="Buscar conversaciones"
          value={consulta}
          onChange={(evento) => setConsulta(evento.target.value)}
        />
      </Box>
      <Box flex="1" minH={0} overflowY="auto" px={2} pb={4}>
        {cuerpo}
      </Box>
    </Box>
  )
}
