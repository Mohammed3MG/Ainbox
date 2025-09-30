import { Check, X, Clock, User } from 'lucide-react'
import { cn } from '../../lib/utils'

const RESPONSE_CONFIG = {
  accepted: {
    icon: Check,
    label: 'Accepted',
    color: 'text-green-600',
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200'
  },
  declined: {
    icon: X,
    label: 'Declined',
    color: 'text-red-600',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200'
  },
  tentative: {
    icon: Clock,
    label: 'Maybe',
    color: 'text-yellow-600',
    bgColor: 'bg-yellow-50',
    borderColor: 'border-yellow-200'
  },
  pending: {
    icon: Clock,
    label: 'Pending',
    color: 'text-gray-500',
    bgColor: 'bg-gray-50',
    borderColor: 'border-gray-200'
  }
}

export default function AttendeeList({ attendees, organizerName, organizerEmail }) {
  const getResponseConfig = (response) => {
    return RESPONSE_CONFIG[response] || RESPONSE_CONFIG.pending
  }

  // Only add organizer if we have their info
  const attendeesWithOrganizer = organizerEmail ? [
    {
      email: organizerEmail,
      name: organizerName || organizerEmail.split('@')[0],
      role: 'organizer',
      response: 'accepted' // Organizer is always accepted
    },
    ...(attendees || [])
  ] : (attendees || [])

  const responseCounts = attendees?.reduce((acc, att) => {
    acc[att.response] = (acc[att.response] || 0) + 1
    return acc
  }, {}) || {}

  // Don't render if no attendees
  if (!attendeesWithOrganizer || attendeesWithOrganizer.length === 0) {
    return (
      <div className="p-4 bg-gray-50 rounded-lg text-center text-gray-500 text-sm">
        No attendees
      </div>
    )
  }

  return (
    <div>
      {/* Attendee List - Clean minimal style */}
      <div className="space-y-2">
        {attendeesWithOrganizer.map((attendee, index) => {
          const config = getResponseConfig(attendee.response)
          const isOrganizer = attendee.role === 'organizer'

          return (
            <div
              key={`${attendee.email}-${index}`}
              className="flex items-center justify-between py-2"
            >
              <div className="flex items-center gap-2.5 flex-1 min-w-0">
                <div className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0",
                  isOrganizer ? "bg-blue-100" : "bg-gray-100"
                )}>
                  <User className={cn(
                    "w-4 h-4",
                    isOrganizer ? "text-blue-600" : "text-gray-600"
                  )} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {attendee.name || (attendee.email ? attendee.email.split('@')[0] : 'Unknown')}
                    </p>
                    {isOrganizer && (
                      <span className="text-[10px] text-gray-500">
                        Organizer
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 truncate">
                    {attendee.email || 'No email'}
                  </p>
                </div>
              </div>

              <div className="text-xs flex-shrink-0 flex items-center gap-1">
                {isOrganizer ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-green-600" />
                    <span className="text-green-600 font-medium">Yes</span>
                  </>
                ) : (
                  <>
                    {attendee.response === 'accepted' && (
                      <>
                        <Check className="w-3.5 h-3.5 text-green-600" />
                        <span className="text-green-600 font-medium">Accepted</span>
                      </>
                    )}
                    {attendee.response === 'declined' && (
                      <>
                        <X className="w-3.5 h-3.5 text-red-600" />
                        <span className="text-red-600 font-medium">Declined</span>
                      </>
                    )}
                    {attendee.response === 'tentative' && (
                      <>
                        <Clock className="w-3.5 h-3.5 text-yellow-600" />
                        <span className="text-yellow-600 font-medium">Maybe</span>
                      </>
                    )}
                    {attendee.response === 'pending' && (
                      <>
                        <Clock className="w-3.5 h-3.5 text-gray-400" />
                        <span className="text-gray-500 font-medium">Pending</span>
                      </>
                    )}
                    {!attendee.response && (
                      <>
                        <Clock className="w-3.5 h-3.5 text-gray-400" />
                        <span className="text-gray-500 font-medium">Pending</span>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}