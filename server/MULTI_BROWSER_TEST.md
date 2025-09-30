# Multi-Browser Testing Guide

## Setup

You'll need **TWO different browsers** (or one browser + one incognito/private window):
- Browser 1: Chrome (or your main browser)
- Browser 2: Firefox, Safari, or Chrome Incognito

---

## Test Scenario

### Browser 1 - Organizer (mohammedsorguli@gmail.com)
### Browser 2 - Invitee (mustafasurguli89@gmail.com)

---

## Step-by-Step Test

### 1. **Browser 1 - Log in as Organizer**

1. Open Browser 1 (Chrome)
2. Go to `http://localhost:5173` (or your frontend URL)
3. Log in as: **mohammedsorguli@gmail.com**
4. Verify you see the dashboard

---

### 2. **Browser 1 - Create Event with Invitee**

1. Click on **Calendar** in sidebar
2. Click **"New Event"** button
3. Fill in:
   - **Title**: "Team Sync Meeting"
   - **Start Time**: Tomorrow 2:00 PM
   - **End Time**: Tomorrow 3:00 PM
   - **Location**: "Meeting Room B"
4. **Add Attendee**:
   - Enter email: `mustafasurguli89@gmail.com`
   - Press Enter or click Add
5. Click **"Create Event"**
6. ✅ **Check**: Bell icon shows (1) notification
7. Click bell icon
8. ✅ **Check**: See "Event Created Successfully - You created Team Sync Meeting with 1 invitee"

---

### 3. **Browser 2 - Log in as Invitee**

1. Open Browser 2 (Firefox/Safari/Incognito)
2. Go to `http://localhost:5173`
3. Log in as: **mustafasurguli89@gmail.com**
4. ✅ **Check**: Bell icon shows (1) notification badge

---

### 4. **Browser 2 - Check Invitation Notification**

1. Click the **bell icon** 🔔
2. ✅ **Check**: See notification "New Meeting Invitation - You've been invited to Team Sync Meeting"
3. Keep notification panel open for now

---

### 5. **Browser 2 - View Event in Calendar**

1. Click on **Calendar** in sidebar
2. ✅ **Check**: Event "Team Sync Meeting" appears in calendar
3. ✅ **Check**: Sidebar shows "Calendar (1)" count
4. Click on the event in calendar

---

### 6. **Browser 2 - View Event Details**

Event modal should open. Check the following:

✅ **Event Details Section:**
- Title: "Team Sync Meeting"
- Time: Tomorrow 2:00 PM - 3:00 PM
- Location: "Meeting Room B"
- All fields are read-only (you can't edit them)

✅ **Attendees & Responses Section:**
- Shows 2 people total
- Shows organizer: "mohammed sorguli" with "Organizer" blue badge - Status: Accepted
- Shows you: "Mustafa Surguli" - Status: Pending (gray/clock icon)
- Response summary: 0 accepted, 0 declined, 0 maybe, 1 pending

✅ **Footer Buttons:**
- NO "Edit Event" button
- NO "Delete Event" button
- Three RSVP buttons visible:
  - **✓ Accept** (outline button)
  - **? Maybe** (outline button)
  - **✗ Decline** (outline button)

---

### 7. **Browser 2 - Accept Invitation**

1. Click the **"✓ Accept"** button
2. Wait 1-2 seconds

✅ **Check Immediate Changes:**
- "Accept" button turns **green** and stays highlighted
- Your status in attendee list changes from "Pending" → "Accepted ✅" (green badge)
- Response summary updates to: **1 accepted**, 0 declined, 0 maybe, 0 pending
- "Responded at" timestamp appears under your name
- NO new notification appears in bell icon

---

### 8. **Browser 1 - Verify Organizer View**

Switch back to Browser 1 (Organizer)

1. Go to Calendar (if not already there)
2. Click on the same event "Team Sync Meeting"
3. Look at the Attendees & Responses section

✅ **Check:**
- You (Organizer) - Accepted
- mustafasurguli89@gmail.com - **Accepted ✅** (updated from Pending!)
- Response summary shows: **1 accepted**
- Bell icon has NO new notifications (no notification about acceptance)

---

### 9. **Browser 2 - Test Other Responses**

Stay in Browser 2 (Invitee)

1. Click on the event again (if closed)
2. Click **"? Maybe"** button

✅ **Check:**
- Button turns **yellow** and highlighted
- Status changes to "Maybe" with yellow badge
- NO new notification

3. Click **"✗ Decline"** button

✅ **Check:**
- Button turns **red** and highlighted
- Status changes to "Declined" with red badge
- NO new notification

---

### 10. **Browser 2 - Test Permission Restrictions**

While viewing the event modal as invitee:

✅ **Verify you CANNOT:**
- See "Edit Event" button
- See "Delete Event" button
- See "Manage Attendees" button
- Edit any form fields (title, time, location)
- All fields should be disabled/read-only

✅ **Verify you CAN:**
- View all event details
- See attendee list with responses
- Change your RSVP (Accept/Maybe/Decline)
- Close the modal

---

## Troubleshooting

### Problem: Invitee doesn't see notification
**Solution**:
- Check that invitee email matches exactly: `mustafasurguli89@gmail.com`
- Refresh the page
- Check browser console for errors

### Problem: Event doesn't appear in invitee's calendar
**Solution**:
- Check that the event GET endpoint includes invitees (we fixed this)
- Verify the date range includes the event
- Try refreshing the calendar

### Problem: RSVP buttons don't appear
**Solution**:
- Verify you're logged in as the invitee (not organizer)
- Check that event.user_role === 'attendee'
- Check browser console for errors

### Problem: Status doesn't update after clicking RSVP
**Solution**:
- Check browser console for API errors
- Verify server is running
- Check that `/api/calendar/events/${eventId}/respond` endpoint is accessible

### Problem: Can't log in as invitee in second browser
**Solution**:
- Make sure you're using a completely different browser or incognito mode
- Cookies are stored per browser, not shared
- Clear cookies if needed

---

## Success Checklist

Use this checklist to verify everything works:

- [ ] Browser 1: Organizer can create event
- [ ] Browser 1: Organizer sees "Event Created" notification
- [ ] Browser 2: Invitee sees invitation notification in bell icon
- [ ] Browser 2: Invitee sees event in their calendar
- [ ] Browser 2: Invitee can click and view event details
- [ ] Browser 2: Invitee sees attendee list with organizer + self
- [ ] Browser 2: Invitee sees RSVP buttons (Accept/Maybe/Decline)
- [ ] Browser 2: Invitee CANNOT see Edit/Delete buttons
- [ ] Browser 2: Clicking Accept updates status immediately
- [ ] Browser 2: Status shows as "Accepted ✅" in attendee list
- [ ] Browser 2: NO new notification after accepting
- [ ] Browser 1: Organizer sees updated "Accepted" status
- [ ] Browser 1: Organizer has NO notification about acceptance
- [ ] Both sessions work independently without interfering

---

## Expected Final State

**Database:**
- 1 event created
- 1 meeting attendee with response="accepted"
- 1 calendar invitation with status="accepted"
- 2 notifications total (1 for organizer, 1 for invitee)
- 0 RSVP response notifications

**Browser 1 (Organizer):**
- 1 notification: "Event Created Successfully"
- Event visible in calendar with edit permissions

**Browser 2 (Invitee):**
- 1 notification: "New Meeting Invitation"
- Event visible in calendar (read-only)
- Can change RSVP status

---

## Notes

- Each browser maintains its own session/cookies
- Logging in as different users in different browsers simulates real multi-user scenarios
- The system correctly handles simultaneous sessions
- RSVP updates are immediate (no page refresh needed)
- Permissions are enforced server-side (invitees cannot edit even if they try via API)

---

Ready to test! 🚀