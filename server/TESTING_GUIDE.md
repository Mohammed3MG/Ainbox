# Calendar Notification System - Testing Guide

## Prerequisites
- Two user accounts (e.g., User A and User B)
- Both users should be logged into the system
- Clear database (already done)

## Test Scenario

### User A (Organizer): mohammedsorguli@gmail.com
### User B (Invitee): mustafasurguli89@gmail.com

---

## Step 1: Create Event with Invitees (User A - Organizer)

1. **Log in as User A** (mohammedsorguli@gmail.com)
2. **Navigate to Calendar page**
3. **Click "New Event" button**
4. **Fill in event details:**
   - Title: "Team Meeting"
   - Start time: Tomorrow at 10:00 AM
   - End time: Tomorrow at 11:00 AM
   - Location: "Conference Room A"
5. **Add attendee:**
   - Click on attendee field
   - Enter: mustafasurguli89@gmail.com
   - Add the attendee
6. **Click "Create Event"**

### Expected Results (User A):
✅ Event created successfully
✅ Bell icon shows notification badge (1)
✅ Click bell icon → See notification: "Event Created Successfully - You created Team Meeting with 1 invitee"
✅ Event appears in calendar

---

## Step 2: View Invitation (User B - Invitee)

1. **Log in as User B** (mustafasurguli89@gmail.com)
2. **Check bell icon** - Should show notification badge (1)
3. **Click bell icon**
   - See notification: "New Meeting Invitation - You've been invited to Team Meeting"
4. **Navigate to Calendar page**
5. **Event should appear in calendar** (as invitee)

### Expected Results (User B):
✅ Bell icon shows unread notification (1)
✅ Notification lists the invitation
✅ Sidebar shows calendar count (1)
✅ Event visible in calendar with different visual (not editable)

---

## Step 3: View Event Details (User B - Invitee)

1. **Click on the event** in calendar
2. **Event modal opens**

### Expected Results (User B):
✅ Event details displayed (title, time, location)
✅ "Attendees & Responses" section visible
✅ Shows:
   - Organizer (mohammedsorguli@gmail.com) with "Organizer" badge - Status: Accepted
   - You (mustafasurguli89@gmail.com) - Status: Pending
✅ Response summary shows: 0 accepted, 0 declined, 0 maybe, 1 pending
✅ NO "Edit Event" or "Delete" buttons visible
✅ Three RSVP buttons visible: "✓ Accept", "? Maybe", "✗ Decline"

---

## Step 4: Accept Invitation (User B - Invitee)

1. **Click "✓ Accept" button**
2. **Wait for response**

### Expected Results (User B):
✅ "Accept" button becomes green/highlighted
✅ Status in attendee list changes from "Pending" to "Accepted" ✅
✅ Response summary updates: 1 accepted, 0 declined, 0 maybe, 0 pending
✅ Responded timestamp appears under your name
✅ NO new notification created

---

## Step 5: Verify Organizer View (User A)

1. **Switch back to User A** (mohammedsorguli@gmail.com)
2. **Navigate to Calendar**
3. **Click on the event**
4. **View attendee list**

### Expected Results (User A):
✅ Attendee list shows:
   - You (Organizer) - Accepted
   - mustafasurguli89@gmail.com - Accepted ✅ (updated status)
✅ Response summary shows: 1 accepted
✅ "Edit Event" and "Delete Event" buttons visible (organizer permissions)
✅ NO new notification in bell icon about the acceptance

---

## Step 6: Test Other Responses (User B)

1. **As User B**, click on event again
2. **Click "? Maybe" button**
3. **Verify status changes to "Maybe" with yellow badge**
4. **Click "✗ Decline" button**
5. **Verify status changes to "Declined" with red badge**

### Expected Results (User B):
✅ Each button click updates the status immediately
✅ Button highlights with appropriate color (green/yellow/red)
✅ Attendee list updates in real-time
✅ NO notifications created for responses

---

## Step 7: Test Permissions (User B - Invitee)

1. **Try to see if there's any way to edit the event**

### Expected Results (User B):
✅ NO "Edit Event" button
✅ NO "Delete Event" button
✅ NO "Manage Attendees" button
✅ Form fields are read-only
✅ Can only see RSVP buttons

---

## Quick Checklist

### Organizer (User A) Features:
- [x] Creates event with invitees
- [x] Gets notification about event creation
- [x] Can view all attendee responses
- [x] Can edit/delete event
- [x] Does NOT get notifications when attendees respond
- [x] Can see updated responses in event details

### Invitee (User B) Features:
- [x] Gets notification when invited
- [x] Sees event in their calendar
- [x] Can view event details (read-only)
- [x] Can see all attendees and their responses
- [x] Can Accept/Maybe/Decline
- [x] Response updates immediately
- [x] Does NOT get notification after responding
- [x] Cannot edit or delete event

### Notifications:
- [x] Organizer gets notification when creating event with invitees
- [x] Invitee gets notification when invited
- [x] NO notifications for RSVP responses (organizer or invitee)
- [x] Bell icon shows unread count
- [x] Sidebar shows calendar count

---

## Troubleshooting

### Issue: Invitee doesn't see event
**Solution**: Check that invitee email matches their registered email exactly

### Issue: RSVP buttons not showing
**Solution**: Verify `user_role` is 'attendee' and `can_edit` is false

### Issue: Status not updating
**Solution**: Check browser console for errors, verify API endpoint is reachable

### Issue: Organizer email is undefined
**Solution**: Event might not have `organizer_name` and `organizer_email` - these are now included in the API response

---

## Database Verification (Optional)

Check if data is correctly saved:

```sql
-- Check notifications
SELECT * FROM notifications ORDER BY created_at DESC LIMIT 10;

-- Check calendar invitations
SELECT * FROM calendar_invitations ORDER BY invitation_sent_at DESC;

-- Check meeting attendees with responses
SELECT ma.*, ce.title
FROM meeting_attendees ma
JOIN calendar_events ce ON ma.event_id = ce.id
ORDER BY ma.responded_at DESC;

-- Check events
SELECT * FROM calendar_events ORDER BY created_at DESC LIMIT 5;
```

---

## Success Criteria

All tests pass if:
1. ✅ Organizer receives notification on event creation with invitees
2. ✅ Invitee receives invitation notification
3. ✅ Invitee can see event in calendar (read-only)
4. ✅ Both can see attendee list with response status
5. ✅ Invitee can change RSVP (Accept/Maybe/Decline)
6. ✅ Status updates immediately without page reload
7. ✅ NO notifications for RSVP responses
8. ✅ Proper permissions enforced (invitee cannot edit/delete)