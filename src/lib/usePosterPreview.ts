import { useState, useRef, useEffect, useCallback } from "react"
import { usePSelector } from "@/lib/context"
import { useToast } from "@/components/Toast"

export function usePosterPreview() {
  // B2: selettore slice — prima useP() ri-renderizzava il hook (e chi lo usa)
  // a OGNI aggiornamento del context Pictorium, non solo al cambio previewUrl.
  const previewUrl = usePSelector((v) => v.previewUrl)
  const toast = useToast()
  const toastRef = useRef(toast)
  toastRef.current = toast

  const [imageError, setImageError] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [loadProgress, setLoadProgress] = useState(0)
  const [imgSrc, setImgSrc] = useState("")
  // Bump per far ripartire la fetch: il Retry del preview non può dipendere
  // solo da previewUrl (invariato dopo un errore), serve un nonce.
  const [retryNonce, setRetryNonce] = useState(0)
  
  const xhrRef = useRef<XMLHttpRequest | null>(null)
  const loadDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevObjUrlRef = useRef("")
  // D6: throttle del progress — gli eventi onprogress di XHR arrivano a decine
  // al secondo; setLoadProgress a ogni evento ri-renderizza la preview senza
  // beneficio visivo. Aggiorna solo a step ≥5% (il 100% arriva in onload).
  const lastProgressRef = useRef(-1)

  useEffect(() => {
    setImageError(false)
    setLoadProgress(0)
    lastProgressRef.current = 0
    if (!previewUrl) {
      if (prevObjUrlRef.current) {
        URL.revokeObjectURL(prevObjUrlRef.current)
        prevObjUrlRef.current = ""
      }
      setImgSrc("")
      setPreviewLoading(false)
      return
    }

    // Show loading bar only if request takes >200ms
    loadDelayRef.current = setTimeout(() => setPreviewLoading(true), 200)
    
    // Keep old img visible while new one loads — no flicker
    const url = previewUrl
    const xhr = new XMLHttpRequest()
    xhrRef.current = xhr
    xhr.open("GET", url, true)
    xhr.responseType = "blob"
    
    xhr.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100)
        if (lastProgressRef.current < 0 || pct - lastProgressRef.current >= 5 || pct >= 100) {
          lastProgressRef.current = pct
          setLoadProgress(pct)
        }
      }
    }
    
    xhr.onload = () => {
      if (loadDelayRef.current) {
        clearTimeout(loadDelayRef.current)
        loadDelayRef.current = null
      }
      if (xhr.status === 200) {
        const blob = xhr.response
        const objUrl = URL.createObjectURL(blob)
        if (prevObjUrlRef.current) URL.revokeObjectURL(prevObjUrlRef.current)
        prevObjUrlRef.current = objUrl
        setImgSrc(objUrl)
        setLoadProgress(100)
        setPreviewLoading(false)
      } else {
        setImageError(true)
        setPreviewLoading(false)
      }
    }
    
    xhr.onerror = () => {
      if (loadDelayRef.current) {
        clearTimeout(loadDelayRef.current)
        loadDelayRef.current = null
      }
      setImageError(true)
      setPreviewLoading(false)
      toastRef.current.error("Failed to load poster preview")
    }
    
    xhr.send()
    
    return () => {
      xhr.abort()
      xhrRef.current = null
      if (loadDelayRef.current) {
        clearTimeout(loadDelayRef.current)
        loadDelayRef.current = null
      }
    }
  }, [previewUrl, retryNonce])

  // Rifà la fetch della preview corrente (usato dal pulsante Retry dopo un errore).
  const retry = useCallback(() => {
    setRetryNonce((n) => n + 1)
  }, [])

  // Revoca l'object URL residuo SOLO allo smontaggio. La cleanup dell'effetto
  // sopra non può revocare: durante il caricamento della nuova preview l'immagine
  // vecchia deve restare valida (no-flicker).
  useEffect(() => {
    return () => {
      if (prevObjUrlRef.current) {
        URL.revokeObjectURL(prevObjUrlRef.current)
        prevObjUrlRef.current = ""
      }
    }
  }, [])

  return {
    imageError,
    setImageError,
    previewLoading,
    loadProgress,
    imgSrc,
    retry,
  }
}
