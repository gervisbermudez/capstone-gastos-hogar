import { Flex, Stack, Text } from "@chakra-ui/react"

const MEDIDA = {
  sm: { caja: 36, titulo: "xl", subtitulo: "xs" },
  md: { caja: 44, titulo: "2xl", subtitulo: "sm" },
} as const

export function Logotipo({ tamano = "sm" }: { tamano?: "sm" | "md" }) {
  const medida = MEDIDA[tamano]

  return (
    <Flex direction="row" align="center" gap={3}>
      <svg
        aria-hidden="true"
        width={medida.caja}
        height={medida.caja}
        viewBox="0 0 44 44"
        fill="none"
        style={{ display: "block", flexShrink: 0 }}
      >
        <circle cx="22" cy="22" r="22" fill="var(--chakra-colors-marca-carbon, #1c1c1a)" />
        <path
          fill="var(--chakra-colors-marca-sol, #f5cb5c)"
          d="M22 12.4 31.4 20.6h-2.5v11H15.1v-11h-2.5L22 12.4Z"
        />
        <path fill="var(--chakra-colors-marca-carbon, #1c1c1a)" d="M19.7 31.6V25.2h4.6v6.4h-4.6Z" />
      </svg>
      <Stack gap={0}>
        <Text
          fontFamily="'Fraunces', Georgia, serif"
          fontWeight={600}
          color="marca.carbon"
          lineHeight="1"
          fontSize={medida.titulo}
        >
          Capstone
        </Text>
        <Text fontFamily="body" fontSize={medida.subtitulo} color="fg.muted" lineHeight="1.1">
          Gastos del hogar
        </Text>
      </Stack>
    </Flex>
  )
}
