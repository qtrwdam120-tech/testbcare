import { createContext, useContext, useEffect, useState, ReactNode } from "react"
import { startHeartbeat, stopHeartbeat } from "@/lib/socket"
import { getOrCreateVisitorID } from "@/lib/visitor-tracking"

interface VisitorContextType {
  visitorId: string
}

const VisitorContext = createContext<VisitorContextType | null>(null)

export function VisitorProvider({ children }: { children: ReactNode }) {
  const [visitorId] = useState(() => getOrCreateVisitorID())

  useEffect(() => {
    // Start heartbeat when app loads
    startHeartbeat(visitorId)
    
    // Stop heartbeat when user closes the tab/window
    const handleBeforeUnload = () => {
      stopHeartbeat()
    }
    
    window.addEventListener("beforeunload", handleBeforeUnload)
    
    return () => {
      stopHeartbeat()
      window.removeEventListener("beforeunload", handleBeforeUnload)
    }
  }, [visitorId])

  return (
    <VisitorContext.Provider value={{ visitorId }}>
      {children}
    </VisitorContext.Provider>
  )
}

export function useVisitor() {
  const context = useContext(VisitorContext)
  if (!context) {
    throw new Error("useVisitor must be used within a VisitorProvider")
  }
  return context
}
