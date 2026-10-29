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

export const sistema = createSystem(
  defaultConfig,
  defineConfig({
    globalCss: {
      html: {
        margin: 0,
        minHeight: "100%",
      },
      body: {
        color: "fg",
        margin: 0,
        fontFamily: "body",
        minHeight: "100%",
        backgroundColor: "bg",
        backgroundImage: "linear-gradient(145deg, #f7f4ea 0%, #fbf6e4 42%, #f3e4a8 100%)",
        backgroundAttachment: "fixed",
        backgroundRepeat: "no-repeat",
        colorScheme: "light",
        _dark: {
          backgroundColor: "#1c1c1a",
          backgroundImage: "linear-gradient(145deg, #1c1c1a 0%, #3a3934 100%)",
          colorScheme: "dark",
        },
      },
      "[data-scope=toast][data-part=group]": {
        width: "min(24rem, calc(100vw - 2rem))",
      },
    },
    theme: {
      tokens,
      semanticTokens: defineSemanticTokens({
        colors: {
          bg: {
            DEFAULT: {
              value: { _light: "{colors.marca.lino}", _dark: "{colors.marca.carbon}" },
            },
            panel: {
              value: { _light: "{colors.marca.papel}", _dark: "{colors.marca.grafito}" },
            },
            subtle: {
              value: { _light: "{colors.marca.alabastro}", _dark: "{colors.marca.grafito}" },
            },
            hover: {
              value: { _light: "{colors.marca.papel}", _dark: "{colors.marca.carbon}" },
            },
          },
          fg: {
            DEFAULT: {
              value: { _light: "{colors.marca.carbon}", _dark: "{colors.marca.papel}" },
            },
            muted: {
              value: { _light: "#5c584f", _dark: "{colors.marca.alabastro}" },
            },
            sobreSolido: {
              value: { _light: "{colors.marca.papel}", _dark: "{colors.marca.carbon}" },
            },
          },
          solido: {
            hover: {
              value: { _light: "{colors.marca.grafito}", _dark: "{colors.marca.alabastro}" },
            },
          },
          borde: {
            value: {
              _light: "rgba(28, 28, 26, 0.12)",
              _dark: "rgba(255, 253, 248, 0.16)",
            },
          },
          estadoTexto: {
            ok: {
              value: { _light: "{colors.estado.ok}", _dark: "{colors.estado.okFondo}" },
            },
            aviso: {
              value: { _light: "{colors.estado.aviso}", _dark: "{colors.estado.avisoFondo}" },
            },
            falla: {
              value: { _light: "{colors.estado.falla}", _dark: "{colors.estado.fallaFondo}" },
            },
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
            bg: "bg.panel",
            color: "fg",
            borderRadius: "16px",
            borderWidth: "1px",
            borderColor: "borde",
            focusVisibleRing: "outside",
            focusRingColor: "marca.sol",
            "&[aria-invalid=true]": {
              borderColor: "estado.falla",
              focusRingColor: "estado.falla",
            },
          },
          variants: {
            variant: {
              outline: {
                bg: "bg.panel",
                color: "fg",
                borderColor: "borde",
                focusVisibleRing: "outside",
                focusRingColor: "marca.sol",
                "&[aria-invalid=true]": {
                  borderColor: "estado.falla",
                  focusRingColor: "estado.falla",
                },
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
              bg: "bg.panel",
              color: "fg",
              translate: "var(--x) var(--y)",
              scale: "var(--scale)",
              zIndex: "var(--z-index)",
              height: "var(--height)",
              opacity: "var(--opacity)",
              willChange: "translate, opacity, scale",
              transitionProperty: "translate, scale, opacity, height, box-shadow",
              transitionDuration: "520ms, 520ms, 400ms, 420ms, 200ms",
              transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
              _closed: {
                transitionProperty: "translate, scale, opacity, height",
                transitionDuration: "360ms, 360ms, 240ms, 320ms",
                transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
              },
              boxShadow: "0 16px 40px rgba(28, 27, 23, 0.22)",
              borderWidth: "1px",
              borderStyle: "solid",
              borderColor: "borde",
              borderInlineStartWidth: "4px",
              borderInlineStartColor: "var(--toast-accent)",
              pe: "8",
              "--toast-accent": "{colors.fg}",
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
              color: "inherit",
              lineHeight: "1.35",
            },
            description: {
              color: "inherit",
              opacity: "1",
              lineHeight: "1.4",
            },
            indicator: {
              color: "var(--toast-accent)",
            },
            closeTrigger: {
              color: "inherit",
              _hover: { bg: "{black/6}" },
            },
          },
        }),
      },
    },
  }),
)
