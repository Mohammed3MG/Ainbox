import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, Clock, MapPin, Users, Check, X, HelpCircle, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import useNotifications from '../../hooks/useNotifications';

export default function NotificationItem({ notification, onMarkAsRead, formatTimeAgo }) {
  const navigate = useNavigate();
  const [isExpanded, setIsExpanded] = useState(false);
  const [rsvpLoading, setRsvpLoading] = useState(false);
  const [rsvpResponse, setRsvpResponse] = useState(null);
  const { handleRSVP } = useNotifications();

  const isUnread = !notification.is_read;
  const notificationData = notification.data || {};

  const handleRSVPResponse = async (response) => {
    if (!notificationData.responseToken) return;

    setRsvpLoading(true);
    try {
      await handleRSVP(notificationData.responseToken, response);
      setRsvpResponse(response);

      // Mark notification as read
      if (isUnread) {
        await onMarkAsRead(notification.id);
      }
    } catch (error) {
      console.error('Error handling RSVP:', error);
    } finally {
      setRsvpLoading(false);
    }
  };

  const handleMarkAsRead = async (e) => {
    e.stopPropagation();
    await onMarkAsRead(notification.id);
  };

  const handleViewEvent = (e) => {
    e.stopPropagation();
    const eventId = notificationData.eventId;
    if (eventId) {
      // Mark as read when viewing
      if (isUnread) {
        onMarkAsRead(notification.id);
      }
      // Navigate to calendar with event ID in state
      navigate('/calendar', { state: { openEventId: eventId } });
    }
  };

  const formatEventTime = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).format(date);
  };

  const getNotificationIcon = () => {
    switch (notification.type) {
      case 'meeting_invitation':
        return <Calendar className="w-5 h-5 text-blue-500" />;
      case 'rsvp_response':
        return <Users className="w-5 h-5 text-green-500" />;
      case 'calendar_integration':
        return <Calendar className="w-5 h-5 text-green-500" />;
      case 'calendar_error':
        return <Calendar className="w-5 h-5 text-red-500" />;
      case 'conflict':
        return <Clock className="w-5 h-5 text-orange-500" />;
      case 'reminder':
        return <Clock className="w-5 h-5 text-purple-500" />;
      default:
        return <Calendar className="w-5 h-5 text-gray-500" />;
    }
  };

  const getRSVPButtonStyle = (responseType) => {
    const base = "flex-1 text-xs py-2 px-3 rounded-lg transition-all duration-200";

    if (rsvpResponse === responseType) {
      switch (responseType) {
        case 'accepted':
          return `${base} bg-green-500 text-white shadow-md`;
        case 'maybe':
          return `${base} bg-yellow-500 text-white shadow-md`;
        case 'declined':
          return `${base} bg-red-500 text-white shadow-md`;
      }
    }

    switch (responseType) {
      case 'accepted':
        return `${base} bg-green-50 text-green-700 hover:bg-green-100 border border-green-200`;
      case 'maybe':
        return `${base} bg-yellow-50 text-yellow-700 hover:bg-yellow-100 border border-yellow-200`;
      case 'declined':
        return `${base} bg-red-50 text-red-700 hover:bg-red-100 border border-red-200`;
      default:
        return `${base} bg-gray-50 text-gray-700 hover:bg-gray-100 border border-gray-200`;
    }
  };

  const handleNotificationClick = (e) => {
    // If clicking on the whole notification and there's an event, view it
    if (notificationData.eventId && !e.target.closest('button')) {
      handleViewEvent(e);
    } else {
      setIsExpanded(!isExpanded);
    }
  };

  return (
    <div
      className={cn(
        "p-4 transition-all duration-200 cursor-pointer hover:bg-gray-50",
        isUnread && "bg-blue-50 border-l-4 border-blue-500"
      )}
      onClick={handleNotificationClick}
    >
      <div className="flex items-start gap-3">
        {/* Notification Icon */}
        <div className="flex-shrink-0 mt-0.5">
          {getNotificationIcon()}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <h4 className="text-sm font-medium text-gray-900 truncate pr-2">
              {notification.title}
            </h4>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-xs text-gray-500">
                {formatTimeAgo(notification.created_at)}
              </span>
              {isUnread && (
                <button
                  onClick={handleMarkAsRead}
                  className="p-1 hover:bg-gray-200 rounded-full transition-colors"
                  title="Mark as read"
                >
                  <Check className="w-3 h-3 text-gray-500" />
                </button>
              )}
            </div>
          </div>

          <p className="text-sm text-gray-600 mb-2">
            {notification.message}
          </p>

          {/* Show "View Details" hint for event notifications */}
          {notificationData.eventId && !isExpanded && (
            <div className="flex items-center gap-1 text-xs text-blue-600 mt-1">
              <ExternalLink className="w-3 h-3" />
              <span>Click to view full details</span>
            </div>
          )}

          {/* Conflict Details (if expanded) */}
          {isExpanded && notificationData.conflicts && (
            <div className="mt-3 p-3 bg-red-50 rounded-lg border border-red-200">
              <h5 className="font-medium text-red-900 mb-2 flex items-center gap-2">
                <Clock className="w-4 h-4" />
                Scheduling Conflicts ({notificationData.conflictCount})
              </h5>

              <div className="space-y-2">
                {notificationData.conflicts.map((conflict, index) => (
                  <div key={index} className="bg-white p-2 rounded border border-red-100">
                    <div className="font-medium text-sm text-gray-900">{conflict.title}</div>
                    <div className="text-xs text-gray-600 flex items-center gap-4 mt-1">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatEventTime(conflict.start_time)} - {formatEventTime(conflict.end_time)}
                      </span>
                      {conflict.location && (
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {conflict.location}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {notificationData.newEvent && (
                <div className="mt-3 pt-3 border-t border-red-200">
                  <div className="text-sm text-red-800">
                    <strong>New Event:</strong> {notificationData.newEvent.title}
                  </div>
                  <div className="text-xs text-red-600 flex items-center gap-1 mt-1">
                    <Clock className="w-3 h-3" />
                    {formatEventTime(notificationData.newEvent.start_time)} - {formatEventTime(notificationData.newEvent.end_time)}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Event Details (if expanded) */}
          {isExpanded && notificationData.event && (
            <div className="mt-3 p-3 bg-white rounded-lg border border-gray-200">
              <h5 className="font-medium text-gray-900 mb-2">
                {notificationData.event.title}
              </h5>

              {notificationData.event.description && (
                <p className="text-sm text-gray-600 mb-3">
                  {notificationData.event.description}
                </p>
              )}

              <div className="space-y-2 text-xs text-gray-600 mb-3">
                {notificationData.event.start_time && (
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    <span>{formatEventTime(notificationData.event.start_time)}</span>
                  </div>
                )}

                {notificationData.event.location && (
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4" />
                    <span>{notificationData.event.location}</span>
                  </div>
                )}
              </div>

              {/* View Event Button */}
              {notificationData.eventId && (
                <Button
                  onClick={handleViewEvent}
                  className="w-full text-xs py-2 bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center gap-2"
                >
                  <ExternalLink className="w-3 h-3" />
                  View Event Details
                </Button>
              )}
            </div>
          )}

          {/* RSVP Buttons (for meeting invitations) */}
          {notification.type === 'meeting_invitation' && notificationData.responseToken && (
            <div className="mt-3 space-y-2">
              {!rsvpResponse && (
                <div className="flex gap-2">
                  <Button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRSVPResponse('accepted');
                    }}
                    disabled={rsvpLoading}
                    className={getRSVPButtonStyle('accepted')}
                  >
                    <Check className="w-3 h-3 mr-1" />
                    Accept
                  </Button>

                  <Button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRSVPResponse('maybe');
                    }}
                    disabled={rsvpLoading}
                    className={getRSVPButtonStyle('maybe')}
                  >
                    <HelpCircle className="w-3 h-3 mr-1" />
                    Maybe
                  </Button>

                  <Button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRSVPResponse('declined');
                    }}
                    disabled={rsvpLoading}
                    className={getRSVPButtonStyle('declined')}
                  >
                    <X className="w-3 h-3 mr-1" />
                    Decline
                  </Button>
                </div>
              )}

              {rsvpResponse && (
                <div className="text-sm text-center py-2 px-3 rounded-lg bg-gray-100 text-gray-700">
                  You {rsvpResponse} this invitation
                </div>
              )}

              {rsvpLoading && (
                <div className="text-center py-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mx-auto"></div>
                </div>
              )}
            </div>
          )}

          {/* Expand/Collapse indicator */}
          {notificationData.event && (
            <div className="mt-2 flex justify-center">
              {isExpanded ? (
                <ChevronUp className="w-4 h-4 text-gray-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-gray-400" />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}