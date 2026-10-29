import { Alert, Box, Button, Input, Menu, Portal, Stack, Text } from "@chakra-ui/react"
import { useState, type JSX } from "react"
import type { Hilo } from "../../api/tipos"
import { agruparHilos } from "../../chat/historial"
import { EsqueletoFilas } from "../esqueleto"

export type VistaConversaciones = "activas" | "archivadas"

const itemMenu = {
  px: 3,
  py: 2,
  mx: 1,
  borderRadius: "12px",
  cursor: "pointer",
  color: "fg",
  _highlighted: { bg: "bg.subtle" },
} as const

const itemPeligro = {
  ...itemMenu,
  color: "estadoTexto.falla",
  _highlighted: { bg: "estado.fallaFondo", color: "estado.falla" },
} as const

function IconoPuntos(): JSX.Element {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <circle cx="8" cy="3.25" r="1.15" />
      <circle cx="8" cy="8" r="1.15" />
      <circle cx="8" cy="12.75" r="1.15" />
    </svg>
  )
}

export function MenuConversacion({
  titulo,
  archivada,
  bloqueado,
  sobreSolido = false,
  onArchivar,
  onRestaurar,
  onEliminar,
}: {
  titulo: string
  archivada: boolean
  bloqueado: boolean
  sobreSolido?: boolean
  onArchivar: () => void
  onRestaurar: () => void
  onEliminar: () => void
}): JSX.Element {
  return (
    <Menu.Root positioning={{ placement: "bottom-end" }}>
      <Menu.Trigger asChild>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label={`Acciones de ${titulo}`}
          color={sobreSolido ? "inherit" : "fg"}
          borderRadius="full"
          flexShrink={0}
          minW={8}
          h={8}
          px={2}
          disabled={bloqueado}
          _hover={
            sobreSolido
              ? { bg: "solido.hover", color: "fg.sobreSolido" }
              : { bg: "bg.hover", color: "fg" }
          }
          _disabled={{ opacity: 1, cursor: "not-allowed", color: "inherit" }}
        >
          <IconoPuntos />
        </Button>
      </Menu.Trigger>
      <Portal>
        <Menu.Positioner zIndex={2000}>
          <Menu.Content
            bg="bg.panel"
            borderWidth="1px"
            borderColor="borde"
            borderRadius="16px"
            boxShadow="0 12px 40px rgba(28, 27, 23, 0.06)"
            minW="11rem"
            py={1}
          >
            {archivada ? (
              <Menu.Item value="restaurar" onClick={onRestaurar} css={itemMenu}>
                Restaurar
              </Menu.Item>
            ) : (
              <Menu.Item value="archivar" onClick={onArchivar} css={itemMenu}>
                Archivar
              </Menu.Item>
            )}
            <Menu.Item value="eliminar" onClick={onEliminar} css={itemPeligro}>
              Eliminar
            </Menu.Item>
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  )
}

export function ListaConversaciones({
  hilos,
  error,
  activoId,
  bloqueado,
  modo,
  onModo,
  onNueva,
  onAbrir,
  onArchivar,
  onRestaurar,
  onEliminar,
  onReintentar,
  conCierre = false,
}: {
  hilos: Hilo[] | null
  error: string | null
  activoId: string | null
  bloqueado: boolean
  modo: VistaConversaciones
  onModo: (modo: VistaConversaciones) => void
  onNueva: () => void
  onAbrir: (threadId: string) => void
  onArchivar: (threadId: string) => void
  onRestaurar: (threadId: string) => void
  onEliminar: (threadId: string) => void
  onReintentar: () => void
  conCierre?: boolean
}): JSX.Element {
  const [consulta, setConsulta] = useState("")
  const mensajeVacio =
    modo === "archivadas" ? "No hay conversaciones archivadas." : "Todavía no hay conversaciones."

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
    cuerpo = <EsqueletoFilas etiqueta="Cargando conversaciones" filas={4} />
  } else if (hilos.length === 0) {
    cuerpo = (
      <Text fontSize="sm" color="fg.muted" px={2}>
        {mensajeVacio}
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
                const titulo = item.titulo.trim() || "Sin título"
                return (
                  <Box
                    key={item.thread_id}
                    display="flex"
                    alignItems="center"
                    borderRadius="16px"
                    bg={activo ? "fg" : "transparent"}
                    color={activo ? "fg.sobreSolido" : "fg"}
                    opacity={bloqueado && !activo ? 0.72 : 1}
                    _hover={activo ? undefined : { bg: "bg.hover" }}
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      flex="1"
                      minW={0}
                      h="auto"
                      justifyContent="flex-start"
                      borderRadius="16px"
                      py={2}
                      px={3}
                      whiteSpace="normal"
                      textAlign="left"
                      disabled={bloqueado}
                      aria-current={activo ? "true" : undefined}
                      bg="transparent"
                      color="inherit"
                      _hover={{ bg: "transparent", color: "inherit" }}
                      _disabled={{
                        opacity: 1,
                        cursor: "not-allowed",
                        bg: "transparent",
                        color: "inherit",
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
                          {titulo}
                        </Text>
                        {item.cuando ? (
                          <Text as="span" display="block" fontSize="xs" color={activo ? "bg" : "fg.muted"}>
                            {item.cuando}
                          </Text>
                        ) : null}
                      </Stack>
                    </Button>
                    <Box me={1}>
                      <MenuConversacion
                        titulo={titulo}
                        archivada={modo === "archivadas"}
                        bloqueado={bloqueado}
                        sobreSolido={activo}
                        onArchivar={() => onArchivar(item.thread_id)}
                        onRestaurar={() => onRestaurar(item.thread_id)}
                        onEliminar={() => onEliminar(item.thread_id)}
                      />
                    </Box>
                  </Box>
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
        <Text fontFamily="heading" fontWeight="semibold" fontSize="lg" color="fg">
          Conversaciones
        </Text>
        <Button
          type="button"
          size="sm"
          variant="solid"
          bg="fg"
          color="fg.sobreSolido"
          borderRadius="full"
          w="100%"
          mt={3}
          _hover={{ bg: "solido.hover", color: "fg.sobreSolido" }}
          _disabled={{ opacity: 0.72, bg: "fg", color: "fg.sobreSolido" }}
          disabled={bloqueado}
          onClick={onNueva}
        >
          Nueva
        </Button>
      </Box>
      <Box px={3} pb={2} display="flex" gap={1} role="group" aria-label="Tipo de conversaciones">
        <Button
          type="button"
          size="xs"
          borderRadius="full"
          variant="ghost"
          aria-pressed={modo === "activas"}
          bg={modo === "activas" ? "fg" : "transparent"}
          color={modo === "activas" ? "fg.sobreSolido" : "fg.muted"}
          _hover={
            modo === "activas"
              ? { bg: "fg", color: "fg.sobreSolido" }
              : { bg: "bg.hover", color: "fg" }
          }
          onClick={() => onModo("activas")}
        >
          Activas
        </Button>
        <Button
          type="button"
          size="xs"
          borderRadius="full"
          variant="ghost"
          aria-pressed={modo === "archivadas"}
          bg={modo === "archivadas" ? "fg" : "transparent"}
          color={modo === "archivadas" ? "fg.sobreSolido" : "fg.muted"}
          _hover={
            modo === "archivadas"
              ? { bg: "fg", color: "fg.sobreSolido" }
              : { bg: "bg.hover", color: "fg" }
          }
          onClick={() => onModo("archivadas")}
        >
          Archivadas
        </Button>
      </Box>
      <Box px={3} pb={2}>
        <Input
          size="sm"
          borderRadius="full"
          bg="bg.panel"
          color="fg"
          borderColor="borde"
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
