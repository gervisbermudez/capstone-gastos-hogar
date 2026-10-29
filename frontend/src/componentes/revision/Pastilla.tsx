import { Box } from "@chakra-ui/react"
import { type JSX, type ReactNode } from "react"

export type TonoPastilla = "sol" | "carbon" | "gris" | "ok" | "aviso" | "falla"

const TONOS: Record<TonoPastilla, { bg: string; color: string }> = {
  sol: { bg: "marca.sol", color: "marca.carbon" },
  carbon: { bg: "fg", color: "fg.sobreSolido" },
  gris: { bg: "bg.subtle", color: "fg" },
  ok: { bg: "estado.okFondo", color: "estado.ok" },
  aviso: { bg: "estado.avisoFondo", color: "estado.aviso" },
  falla: { bg: "estado.fallaFondo", color: "estado.falla" },
}

export function Pastilla({ children, tono }: { children: ReactNode; tono: TonoPastilla }): JSX.Element {
  const estilo = TONOS[tono]
  return (
    <Box
      as="span"
      display="inline-flex"
      alignItems="center"
      flexShrink={0}
      bg={estilo.bg}
      color={estilo.color}
      borderWidth={tono === "gris" ? "1px" : "0"}
      borderColor="borde"
      borderRadius="full"
      px={3}
      py={1}
      fontSize="sm"
      fontWeight="medium"
      lineHeight="1.4"
      whiteSpace="nowrap"
    >
      {children}
    </Box>
  )
}
