# ShipStatus

ShipStatus is a shared shipment workspace for bookings, ten sequential workflow steps, and Gmail reminder history.

## Run the demo

Use Node.js 22 and run:

```sh
npm ci
npm run dev
```

Open the printed local URL and choose **Enter demo workspace**. The four sample shipments are pending at Steps 2, 4, and 7 or already delivered. Demo bookings and workflow changes persist in the current browser. **Reset demo data** restores the four samples. **Add Staff** previews the invitation form. Email delivery is disabled in demo mode.

## Set up Supabase

1. Create a dedicated Supabase project and run [`20261126000000_shipments.sql`](supabase/migrations/20261126000000_shipments.sql) in its SQL editor. For a project already managed with the Supabase CLI, apply the migration with `supabase db push`.
2. In Authentication, enable email and password sign-in. Turn off public sign-ups and anonymous sign-ins, then create the first admin account in **Authentication → Users**. Every authenticated staff member can read shipments and complete the current step. The database records the account responsible for each completion.
3. Copy the project URL and publishable key. For local development, copy [`.env.example`](.env.example) to `.env.local` and populate the two `VITE_` variables. Netlify Dev is needed to run the Netlify functions locally.

## Prepare Netlify

Connect the repository to Netlify. [`netlify.toml`](netlify.toml) sets the build, publishes `dist`, routes browser refreshes to the React app and registers `shipment-reminders` as a scheduled function. The `invite-staff` function verifies admin access and requests invitation delivery from Supabase Auth. Add the variables in the Netlify project environment before deploying.

| Variable | Scope | Value |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Builds | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Builds | Supabase publishable key, or the legacy `anon` key |
| `SUPABASE_URL` | Functions | Same project URL |
| `SUPABASE_SECRET_KEY` | Functions | Supabase secret key, or the legacy `service_role` key |
| `BUSINESS_TIMEZONE` | Functions | IANA timezone, default `Asia/Kolkata` |
| `GMAIL_SMTP_USER` | Functions | Full Gmail or Google Workspace mailbox address |
| `GMAIL_APP_PASSWORD` | Functions | App password for the sending mailbox |
| `REMINDER_RECIPIENTS` | Functions | Comma-separated recipient addresses |
| `SITE_URL` | Functions | Optional HTTPS site origin for reminder and invite links. Defaults to Netlify’s `URL`. |

Store the Supabase secret and Gmail app password in Netlify’s environment. The browser build receives only the project URL and publishable key. Gmail app passwords require 2-Step Verification and may be restricted by the account administrator. [Netlify function variables](https://docs.netlify.com/build/functions/environment-variables/) · [Google app passwords](https://support.google.com/mail/answer/185833)

The scheduler checks every minute and sends at 12:00 PM and 4:00 PM in the business timezone. A slot remains eligible for five minutes to tolerate timing delays. Eligibility requires the step to have been active by the slot and to still be pending when the database authorizes delivery. Each shipment, step, local date, and slot can be claimed once. Gmail acceptance, failures and missing credentials are recorded. An interrupted delivery is recorded as unconfirmed and the same slot is never resent. Step 10 completion permanently removes the shipment from reminder eligibility. Netlify invokes the schedule on published deploys with the browser closed. [Netlify scheduled functions](https://docs.netlify.com/build/functions/scheduled-functions/)

## Enable Add Staff

1. Confirm the first admin’s email in Supabase Authentication. Run this once in the Supabase SQL Editor after replacing the example address with the admin’s exact email. Sign out and back in to see **Add Staff** on the dashboard.

   ```sql
   update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"shipstatus_admin":true}'::jsonb
   where email = 'admin@your-company.com' and email_confirmed_at is not null;
   ```

2. Set the Supabase Auth **Site URL** to the live ShipStatus origin and add `https://your-site.example/staff/accept` as an allowed redirect URL, using your actual domain. For Netlify Dev with a test Supabase project, set `SITE_URL` to `http://localhost:8888` and allow `http://localhost:8888/staff/accept`. [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
3. Configure custom SMTP in Supabase Auth so invitations can reach staff outside the Supabase project team. In **Authentication → Email Templates → Invite user**, set the subject to `You're invited to ShipStatus` and paste [`supabase/templates/invite.html`](supabase/templates/invite.html) as the body. Disable click tracking for these links if enabled by your SMTP provider. [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp) · [Supabase email templates](https://supabase.com/docs/guides/auth/auth-email-templates)
4. Open **Add Staff** in ShipStatus and send an invitation to each staff member. They open the email link, choose their own password, and sign in to the shared workspace. New staff accounts have shipment access. Only manually designated admins can invite people.

## Verify

```sh
npm test
npm run build
```

The tests run the real migration in embedded PostgreSQL and simulate Gmail acceptance and failure at both business-time slots. They cover booking persistence and replay, locked and duplicate completions, late bookings, reminder deduplication, missing configuration, interrupted jobs, and delivery at Step 10. Invitation tests verify that only confirmed admins can send invites and that the link uses the configured workspace URL. For a deployed smoke test, invite a test staff mailbox and verify password setup and sign-in. Create a test booking before a reminder slot and check the Gmail inbox and **Reminders / History** after the slot.

## Artwork

[`public/container-port.jpg`](public/container-port.jpg) was made with the built-in image generator and is used on the sign-in screen and dashboard.

> Produce a single wide landscape photorealistic editorial photograph for the background of a professional shipping logistics application. High oblique aerial drone view of a large container cargo vessel docked alongside a modern container port, vessel stern and rows of muted blue, white and rust red shipping containers, container cranes visible far to the right and indigo harbor water. Rich navy blue and atmospheric slate palette with warm machinery accent, soft late afternoon overcast light, premium restrained corporate editorial photography, tangible details, no heavy filters. Frame the most recognizable ship and port infrastructure on the right half, leave calm dark navy harbor water at left suitable for overlaying UI copy. No text, logos, watermarks, borders, or graphical overlays.
