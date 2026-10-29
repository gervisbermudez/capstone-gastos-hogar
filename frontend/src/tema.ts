import {
  createSystem,
  defaultConfig,
  defineConfig,
  defineRecipe,
  defineSemanticTokens,
  defineSlotRecipe,
  defineTokens,
} from "@chakra-ui/react"

import "@fontsource/fraunces/400.css"
import "@fontsource/fraunces/600.css"
import "@fontsource/outfit/400.css"
import "@fontsource/outfit/500.css"
import "@fontsource/outfit/600.css"

const tokens = defineTokens({
  colors: {
    marca: {
      lino: { value: "#f7f4ea" },
      alabastro: { value: "#f3efe4" },
      papel: { value: "#fffdf8" },
      sol: { value: "#f5cb5c" },
      carbon: { value: "#1c1c1a" },
      grafito: { value: "#3a3934" },
    },
    estado: {
      ok: { value: "#1b5c3b" },
      okFondo: { value: "#d9f0df" },
      aviso: { value: "#6e4e0a" },
      avisoFondo: { value: "#f3dc8a" },
      falla: { value: "#8d332d" },
      fallaFondo: { value: "#f8d5cf" },
    },
  },
  fonts: {
    heading: { value: "'Outfit', system-ui, sans-serif" },
    body: { value: "'Outfit', system-ui, sans-serif" },
  },
})

const lienzo = {
  color: "marca.carbon",
  margin: 0,
  fontFamily: "body",
  minHeight: "100%",
  backgroundColor: "#f7f4ea",
  backgroundImage: "linear-gradient(145deg, #f7f4ea 0%, #fbf6e4 42%, #f3e4a8 100%)",
  backgroundAttachment: "fixed",
  backgroundRepeat: "no-repeat",
} as const

export const sistema = createSystem(
  defaultConfig,
  defineConfig({
    globalCss: {
      html: lienzo,
      body: lienzo,
      "[data-scope=toast][data-part=group]": {
        width: "min(24rem, calc(100vw - 2rem))",
      },
    },
    theme: {
      tokens,
      semanticTokens: defineSemanticTokens({
        colors: {
          bg: {
            DEFAULT: { value: "{colors.marca.lino}" },
            panel: { value: "{colors.marca.papel}" },
          },
          fg: {
            DEFAULT: { value: "{colors.marca.carbon}" },
            muted: { value: "#5c584f" },
          },
        },
        radii: {
          l1: { value: "16px" },
          l2: { value: "20px" },
          l3: { value: "28px" },
        },
      }),
      recipes: {
        button: defineRecipe({
          base: {
            borderRadius: "full",
            fontWeight: "medium",
          },
        }),
        input: defineRecipe({
          base: {
            bg: "marca.papel",
            color: "marca.carbon",
            borderRadius: "16px",
            borderWidth: "1px",
            borderColor: "rgba(28, 28, 26, 0.12)",
            focusVisibleRing: "outside",
            focusRingColor: "marca.sol",
          },
          variants: {
            variant: {
              outline: {
                bg: "marca.papel",
                color: "marca.carbon",
                borderColor: "rgba(28, 28, 26, 0.12)",
                focusVisibleRing: "outside",
                focusRingColor: "marca.sol",
              },
            },
          },
        }),
      },
      slotRecipes: {
        toast: defineSlotRecipe({
          slots: ["root", "title", "description", "indicator", "closeTrigger", "actionTrigger"],
          base: {
            root: {
              alignItems: "center",
              bg: "marca.papel",
              color: "marca.carbon",
              boxShadow: "0 16px 40px rgba(28, 27, 23, 0.22)",
              borderWidth: "1px",
              borderStyle: "solid",
              borderColor: "rgba(36, 36, 35, 0.1)",
              borderInlineStartWidth: "4px",
              borderInlineStartColor: "var(--toast-accent)",
              pe: "8",
              "--toast-accent": "{colors.marca.grafito}",
              "--toast-trigger-bg": "{colors.marca.alabastro}",
              "&[data-type=success]": {
                bg: "estado.okFondo",
                color: "marca.carbon",
                "--toast-accent": "{colors.estado.ok}",
                "--toast-trigger-bg": "{black/6}",
                "--toast-border-color": "{colors.estado.ok}",
              },
              "&[data-type=warning]": {
                bg: "estado.avisoFondo",
                color: "marca.carbon",
                "--toast-accent": "{colors.estado.aviso}",
                "--toast-trigger-bg": "{black/6}",
                "--toast-border-color": "{colors.estado.aviso}",
              },
              "&[data-type=error]": {
                bg: "estado.fallaFondo",
                color: "marca.carbon",
                "--toast-accent": "{colors.estado.falla}",
                "--toast-trigger-bg": "{black/6}",
                "--toast-border-color": "{colors.estado.falla}",
              },
            },
            title: {
              color: "marca.carbon",
              lineHeight: "1.35",
            },
            description: {
              color: "marca.grafito",
              opacity: "1",
              lineHeight: "1.4",
            },
            indicator: {
              color: "var(--toast-accent)",
            },
            closeTrigger: {
              color: "marca.grafito",
              _hover: { bg: "{black/6}" },
            },
          },
        }),
      },
    },
  }),
)
