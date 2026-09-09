import { describe, expect, it } from "vitest"
import { render, screen, act } from "@testing-library/react"
import { useState, useMemo } from "react"
import { TranslationProvider, useT } from "@/lib/contexts/TranslationContext"
import type { PictoriumCtx } from "@/lib/context"
import { MOCK_CTX } from "@/__tests__/test-utils"

describe("reactive translation switching without refresh", () => {
  it("immediately updates memoized values and displayed text when lang changes", () => {
    function TestConsumer() {
      const { t } = useT()
      const memoizedLabel = useMemo(() => t("ui.all"), [t])
      return <div data-testid="label">{memoizedLabel}</div>
    }

    function TestApp() {
      const [lang, setLang] = useState("it")
      const t = useMemo(() => {
        return (key: string) => {
          if (key === "ui.all") return lang === "it" ? "Tutti" : lang === "en" ? "All" : "Todos"
          return key
        }
      }, [lang])

      const ctxValue: PictoriumCtx = {
        ...MOCK_CTX,
        lang,
        pickLang: setLang,
        t,
      }

      return (
        <TranslationProvider value={ctxValue}>
          <TestConsumer />
          <button type="button" onClick={() => setLang("en")}>
            Switch to EN
          </button>
          <button type="button" onClick={() => setLang("es")}>
            Switch to ES
          </button>
        </TranslationProvider>
      )
    }

    render(<TestApp />)
    expect(screen.getByTestId("label").textContent).toBe("Tutti")

    act(() => {
      screen.getByText("Switch to EN").click()
    })
    expect(screen.getByTestId("label").textContent).toBe("All")

    act(() => {
      screen.getByText("Switch to ES").click()
    })
    expect(screen.getByTestId("label").textContent).toBe("Todos")
  })
})
