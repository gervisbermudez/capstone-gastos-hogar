import { Box, Flex, Text, type SystemStyleObject } from "@chakra-ui/react"
import { useEffect, useState } from "react"

export const DURACION = {
  rapida: "140ms",
  entrada: "220ms",
  enfasis: "320ms",
  grafico: "400ms",
} as const

export const EASING = "cubic-bezier(0.22, 1, 0.36, 1)"

const CONSULTA_REDUCIDO = "(prefers-reduced-motion: reduce)"

export function useMovimientoReducido(): boolean {
  const [reducido, setReducido] = useState(() => {
    if (typeof window === "undefined") return false
    return window.matchMedia(CONSULTA_REDUCIDO).matches
  })

  useEffect(() => {
    const media = window.matchMedia(CONSULTA_REDUCIDO)
    const alCambiar = () => setReducido(media.matches)
    alCambiar()
    media.addEventListener("change", alCambiar)
    return () => media.removeEventListener("change", alCambiar)
  }, [])

  return reducido
}

export const entrada: SystemStyleObject = {
  animationName: "surgir",
  animationDuration: DURACION.entrada,
  animationTimingFunction: EASING,
  animationFillMode: "both",
}

export const panel: SystemStyleObject = {
  animationName: "panel",
  animationDuration: DURACION.entrada,
  animationTimingFunction: EASING,
  animationFillMode: "both",
}

export const pop: SystemStyleObject = {
  animationName: "pop",
  animationDuration: DURACION.entrada,
  animationTimingFunction: EASING,
  animationFillMode: "both",
}

export const transicionRapida: SystemStyleObject = {
  transitionProperty: "background-color, background, color, border-color, box-shadow, transform, translate",
  transitionDuration: DURACION.rapida,
  transitionTimingFunction: EASING,
}

export function entradaEscalon(indice: number): SystemStyleObject {
  return {
    ...entrada,
    animationDelay: `${indice * 40}ms`,
  }
}

export function PuntosEspera({ texto }: { texto: string }) {
  return (
    <Flex align="center" gap={2} minH="1.25rem">
      <Flex aria-hidden="true" align="center" gap="4px">
        {[0, 1, 2].map((indice) => (
          <Box
            key={indice}
            boxSize="6px"
            borderRadius="full"
            bg="fg"
            css={{
              animationName: "puntos",
              animationDuration: "1s",
              animationTimingFunction: "ease-in-out",
              animationIterationCount: "infinite",
              animationDelay: `${indice * 160}ms`,
            }}
          />
        ))}
      </Flex>
      <Text as="span" srOnly>
        {texto}
      </Text>
    </Flex>
  )
}

export function BarraIndeterminada() {
  return (
    <Box aria-hidden="true" h="3px" w="9rem" borderRadius="full" bg="bg.subtle" overflow="hidden">
      <Box
        h="100%"
        w="35%"
        borderRadius="full"
        bg="marca.sol"
        css={{
          animationName: "indeterminada",
          animationDuration: "1.1s",
          animationTimingFunction: "ease-in-out",
          animationIterationCount: "infinite",
        }}
      />
    </Box>
  )
}
