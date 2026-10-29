// Sends ONE sample alert email using the same settings the website uses, so you can check
// email alerts work without making a booking.
//   netlify dev:exec node scripts/send-test-email.mjs
import { createEmailNotifier } from '../lib/notify.js';

const send = createEmailNotifier();
if (!send) {
  console.log('\nEmail alerts are NOT set up yet: RESEND_API_KEY and/or ALERT_EMAIL_TO is missing.');
  console.log('Set them with: netlify env:set RESEND_API_KEY "..."   and   netlify env:set ALERT_EMAIL_TO "you@example.com"\n');
  process.exit(1);
}
const result = await send({
  subject: 'TEST: New booking: Essential Full Detail (Medium) - Sat 7 Nov 09:00 - from £135 - CV8',
  text: [
    'This is a TEST of your AutoShine booking alerts. No real booking was made.',
    '',
    'If you can read this, instant email alerts are working.',
    'Real alerts include the customer name, phone, address, car, price and notes.',
  ].join('\n'),
});
if (result.ok) {
  console.log('\nSENT. Check your inbox now (and your spam / junk folder, just in case).\n');
} else {
  console.log(`\nNOT SENT. Reason: ${result.detail || 'could not reach Resend'} (code ${result.status})\n`);
  process.exit(1);
}
