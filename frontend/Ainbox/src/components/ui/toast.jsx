import { useState, useEffect } from 'react'
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react'
import { cn } from '../../lib/utils'

const TOAST_TYPES = {
  success: {
    icon: CheckCircle,
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200',
    textColor: 'text-green-800',
    iconColor: 'text-green-600'
  },
  error: {
    icon: AlertCircle,
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
    textColor: 'text-red-800',
    iconColor: 'text-red-600'
  },
  info: {
    icon: Info,
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    textColor: 'text-blue-800',
    iconColor: 'text-blue-600'
  }
}

export function Toast({ message, type = 'success', onClose, duration = 3000 }) {
  const [isVisible, setIsVisible] = useState(false)
  const [isLeaving, setIsLeaving] = useState(false)

  const config = TOAST_TYPES[type] || TOAST_TYPES.success
  const Icon = config.icon

  useEffect(() => {
    // Trigger enter animation
    setTimeout(() => setIsVisible(true), 10)

    // Auto close after duration
    const timer = setTimeout(() => {
      handleClose()
    }, duration)

    return () => clearTimeout(timer)
  }, [duration])

  const handleClose = () => {
    setIsLeaving(true)
    setTimeout(() => {
      setIsVisible(false)
      onClose?.()
    }, 300)
  }

  return (
    <div
      className={cn(
        "fixed top-4 left-1/2 -translate-x-1/2 z-[9999] transition-all duration-300 ease-out",
        isVisible && !isLeaving ? "translate-y-0 opacity-100" : "-translate-y-4 opacity-0"
      )}
    >
      <div
        className={cn(
          "flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border backdrop-blur-sm min-w-[300px] max-w-md",
          config.bgColor,
          config.borderColor
        )}
      >
        <Icon className={cn("w-5 h-5 flex-shrink-0", config.iconColor)} />
        <p className={cn("text-sm font-medium flex-1", config.textColor)}>
          {message}
        </p>
        <button
          onClick={handleClose}
          className={cn(
            "p-1 rounded-full hover:bg-black/5 transition-colors",
            config.textColor
          )}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

export function useToast() {
  const [toasts, setToasts] = useState([])

  const showToast = (message, type = 'success', duration = 3000) => {
    const id = Date.now()
    setToasts(prev => [...prev, { id, message, type, duration }])
  }

  const removeToast = (id) => {
    setToasts(prev => prev.filter(toast => toast.id !== id))
  }

  const ToastContainer = () => (
    <>
      {toasts.map(toast => (
        <Toast
          key={toast.id}
          message={toast.message}
          type={toast.type}
          duration={toast.duration}
          onClose={() => removeToast(toast.id)}
        />
      ))}
    </>
  )

  return {
    showToast,
    ToastContainer
  }
}
