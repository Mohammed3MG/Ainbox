import React from "react"

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "outline" | "ghost"
  size?: "default" | "icon" | "sm" | "lg"
}

const variantClasses = (variant: ButtonProps["variant"]) => {
  switch (variant) {
    case "outline":
      return "border border-input bg-transparent hover:bg-accent hover:text-accent-foreground"
    case "ghost":
      return "bg-transparent hover:bg-accent hover:text-accent-foreground"
    case "default":
    default:
      return "bg-black text-white hover:bg-black/90 dark:bg-white dark:text-black dark:hover:bg-white/90"
  }
}

const sizeClasses = (size: ButtonProps["size"]) => {
  switch (size) {
    case "icon":
      return "h-9 w-9 p-0"
    case "sm":
      return "h-8 px-3"
    case "lg":
      return "h-11 px-8"
    case "default":
    default:
      return "h-10 px-4 py-2"
  }
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = "", variant = "default", size = "default", ...props }, ref) => {
    const base = "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50"
    const composed = `${base} ${variantClasses(variant)} ${sizeClasses(size)} ${className}`
    return <button ref={ref} className={composed} {...props} />
  },
)

Button.displayName = "Button"

export default Button

