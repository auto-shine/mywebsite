# AutoShine: website + online booking (ready to deploy)

## What's in this folder
- `public/`            → YOUR WEBSITE (all your pages, css, js, images). Unchanged except two things:
                         a new "Book Online" link in the menu of every page, and the new page `public/book.html` (shows at /book).
                         `public/sitemap.xml` also lists /book.
- `netlify/functions/` → the booking brain (price, availability, book)
- `lib/`               → the logic. **`lib/config.js` holds every price, zone, job length and opening hour.**
- `netlify.toml`       → Netlify settings. Your headers and redirects are kept exactly as they were.
- `package.json`       → needs one library (tsdav) to talk to iCloud
- `test/`              → automated tests (`npm test`)

## A. One-off setup on Apple (5 minutes)
1. appleid.apple.com → Sign-In and Security → App-Specific Passwords → "+" → name it `AutoShine booking`. Copy the password.
2. In Apple Calendar create an iCloud calendar named exactly `Work`.
   Bookings are written there, and anything in it blocks those times (add "Day off" all-day events to block days).

## B. Add your calendar details to Netlify
Netlify → your site → Site configuration → Environment variables → Add a variable:
| Key                    | Value                                  |
|------------------------|----------------------------------------|
| ICLOUD_USERNAME        | your Apple ID email                    |
| ICLOUD_APP_PASSWORD    | the app-specific password from step A1 |
| ICLOUD_CALENDAR_NAME   | Work                                   |
| ICLOUD_BUSY_CALENDARS  | (optional) Work,Home  ← calendars that should block availability |
| RESEND_API_KEY         | your Resend key for instant booking emails, see "Alerts you get" below |
| ALERT_EMAIL_TO         | the email address that should receive booking alerts |
| NTFY_TOPIC             | (optional, not needed if you use email) phone-push topic name |
Never put these in any file.

## C. Deploy (on your computer)
1. Install Node.js (the LTS version) from nodejs.org.
2. Open Terminal (Mac) or Command Prompt (Windows) **inside this folder**, then run these one at a time:
       npm install
       npm install -g netlify-cli
       netlify login
       netlify link          (choose your existing AutoShine site)
3. Preview first (does not touch your live site):
       netlify deploy
   Open the "Website draft URL" it prints. Check your site looks normal and /book loads.
4. Go live:
       netlify deploy --prod

## D. Test with a real booking
1. On your phone open www.auto-shine.co.uk/book
2. Kenilworth postcode → check the price. Try one ~15 miles away and one ~25 miles away → price should rise.
3. Make a test booking → it should appear in your Work calendar within seconds.
4. Reload /book → that time should now be gone.
5. Delete the test booking from your calendar.
If a booking fails: Netlify → Logs → Functions → `book` shows the reason. Send it to Claude.

## Alerts you get
- **In your calendar:** every booking has two alerts: 6pm the evening before, and 1 hour before the start. (Apple Calendar
  never pings you when something is added to your own calendar. People it is shared with are notified; you aren't.)

- **Instant EMAIL for every new booking (recommended):** the email has the customer's name, phone, address, car, price,
  date/time and notes, and you can hit Reply to answer the customer directly.
  1. Go to **resend.com** and sign up (free) with the email address where you want the alerts. Choose an inbox you
     check on your phone. Confirm the verification email they send you.
  2. In Resend: **API Keys -> Create API Key**. Name it `AutoShine`, permission "Sending access", then Create.
     Copy the key (starts with `re_`). Resend only shows it once.
  3. In the command window, inside this folder, run these two (use your own key and email, keep the quote marks):
         netlify env:set RESEND_API_KEY "re_xxxxxxxx"
         netlify env:set ALERT_EMAIL_TO "you@example.com"
     IMPORTANT: ALERT_EMAIL_TO must be the SAME address you signed up to Resend with. Resend's free test sender can only
     deliver to that one address. (To send to other addresses later you verify your own domain in Resend.)
  4. Test it without making a booking:  `netlify dev:exec node scripts/send-test-email.mjs`
     It prints SENT or tells you why not. Check your inbox AND junk folder. If it lands in junk, mark it "Not junk".
  5. `netlify deploy`, make a test booking on the draft link, check the email arrives, then `netlify deploy --prod`.
  The email is also logged in Netlify (Logs -> Functions -> `book`) if anything goes wrong: look for "Booking email not sent".

- **Phone push via ntfy (optional, not needed if you use email):** set `NTFY_TOPIC` to a long random topic name and
  subscribe to it in the ntfy app. Topics on ntfy.sh are public to anyone who knows the name, so these messages never include
  the customer's name, phone or street address. To switch it off: `netlify env:unset NTFY_TOPIC`.

## Things to know
- Your site was originally produced by a builder that ran `node build.mjs`. That script wasn't in the files supplied,
  so `netlify.toml` now just publishes the ready-made `public/` folder. **From now on THIS folder is your master copy.**
  If you ever publish again from the old builder it will overwrite the booking page, so don't.
- To change prices, zones, job lengths, opening hours or notice: edit `lib/config.js`, run `npm test`, then `netlify deploy --prod`.
- Customers don't get an automatic confirmation message (the booking appears in your calendar and on screen), and
  can't cancel online. Both can be added later.
- Change the evening-before alert time in `lib/ics.js` (`eveningBeforeHour`, default 18).
