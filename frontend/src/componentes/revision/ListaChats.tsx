import { Button, Stack, Text } from "@chakra-ui/react"
import { type JSX } from "react"
import { IconoChat } from "./iconos"

export type ChatCitado = { threadId: string; titulo: string; cuando: string }

function mensajeDe(chats: ChatCitado[], cargando: boolean, falla: boolean): string | null {
  if (falla) return "No se pudieron cargar los chats."
  if (cargando && chats.length === 0) return "Buscando chats…"
  if (!cargando && chats.length === 0) return "Ningún chat menciona este comprobante."
  return null
}

export function ListaChats({
  chats,
  cargando,
  falla,
  onAbrir,
  onNuevo,
}: {
  chats: ChatCitado[]
  cargando: boolean
  falla: boolean
  onAbrir: (threadId: string) => void
  onNuevo: () => void
}): JSX.Element {
  const mensaje = mensajeDe(chats, cargando, falla)

  return (
    <Stack gap={3} align="stretch">
      {mensaje ? (
        <Text fontSize="sm" color="fg.muted">
          {mensaje}
        </Text>
      ) : null}
      {chats.length > 0 ? (
        <Stack gap={1} align="stretch">
          {chats.map((chat, indice) => {
            const titulo = chat.titulo.trim() || "Conversación"
            return (
              <Button
                key={`${chat.threadId}-${indice}`}
                type="button"
                variant="ghost"
                w="100%"
                h="auto"
                minH="2.75rem"
                justifyContent="flex-start"
                borderRadius="16px"
                py={2}
                px={3}
                gap={3}
                whiteSpace="normal"
                textAlign="left"
                onClick={() => onAbrir(chat.threadId)}
                css={{
                  color: "fg",
                  bg: "transparent",
                  _hover: { bg: "bg.hover", color: "fg" },
                }}
              >
                <IconoChat />
                <Stack as="span" gap={0} align="stretch" minW={0} flex="1">
                  <Text
                    as="span"
                    fontSize="sm"
                    fontWeight="medium"
                    lineHeight="1.35"
                    textAlign="left"
                    overflowWrap="anywhere"
                  >
                    {titulo}
                  </Text>
                  {chat.cuando.trim() ? (
                    <Text
                      as="span"
                      fontSize="xs"
                      fontWeight="normal"
                      lineHeight="1.35"
                      color="fg.muted"
                      textAlign="left"
                    >
                      {chat.cuando}
                    </Text>
                  ) : null}
                </Stack>
              </Button>
            )
          })}
        </Stack>
      ) : null}
      <Button
        type="button"
        size="sm"
        variant="outline"
        alignSelf="flex-start"
        borderRadius="full"
        onClick={onNuevo}
        css={{
          color: "fg",
          borderColor: "rgba(58, 57, 52, 0.35)",
          bg: "bg.panel",
          _hover: { bg: "bg.hover", color: "fg", borderColor: "rgba(58, 57, 52, 0.35)" },
          _dark: {
            borderColor: "rgba(243, 239, 228, 0.45)",
            _hover: { borderColor: "rgba(243, 239, 228, 0.45)" },
          },
        }}
      >
        Chat nuevo
      </Button>
    </Stack>
  )
}
