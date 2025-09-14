import React, { createContext, useContext, useMemo, useRef, useState } from "react"

type DropdownCtx = {
  open: boolean
  setOpen: (v: boolean) => void
  triggerRef: React.RefObject<HTMLElement>
}

const Ctx = createContext<DropdownCtx | null>(null)

export function DropdownMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLElement>(null)
  const value = useMemo(() => ({ open, setOpen, triggerRef }), [open])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function DropdownMenuTrigger({
  asChild,
  children,
  ...props
}: React.HTMLAttributes<HTMLElement> & { asChild?: boolean }) {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("DropdownMenuTrigger must be used within DropdownMenu")

  const child = React.isValidElement(children)
    ? React.cloneElement(children as any, {
        onClick: (e: any) => {
          children.props?.onClick?.(e)
          ctx.setOpen(!ctx.open)
        },
        ref: (node: HTMLElement) => {
          // @ts-ignore
          if (typeof children.ref === "function") children.ref(node)
          // @ts-ignore
          else if (children.ref) children.ref.current = node
          // @ts-ignore
          ctx.triggerRef.current = node
        },
      })
    : null

  return asChild && child ? (child as any) : (
    <button {...props} onClick={() => ctx.setOpen(!ctx.open)} />
  )
}

export function DropdownMenuContent({
  align = "start",
  className = "",
  children,
}: {
  align?: "start" | "end"
  className?: string
  children: React.ReactNode
}) {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("DropdownMenuContent must be used within DropdownMenu")
  if (!ctx.open) return null

  return (
    <div
      className={`relative z-50 mt-2 min-w-[8rem] rounded-md border bg-white p-1 text-sm shadow-md dark:border-neutral-800 dark:bg-neutral-900 ${className}`}
      style={{
        // basic alignment relative to trigger; not a full popper
        alignSelf: align === "end" ? "flex-end" : undefined,
      }}
    >
      {children}
    </div>
  )
}

export function DropdownMenuItem({
  onClick,
  className = "",
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("DropdownMenuItem must be used within DropdownMenu")
  return (
    <button
      type="button"
      className={`flex w-full cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-left outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800 ${className}`}
      onClick={(e) => {
        onClick?.(e)
        ctx.setOpen(false)
      }}
      {...props}
    >
      {children}
    </button>
  )
}

