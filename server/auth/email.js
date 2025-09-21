import { Resend } from 'resend';
import dotenv from 'dotenv';

dotenv.config();

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = 'TideInCal <noreply@tideincal.com>';

export async function sendWelcome({ to }) {
  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: [to],
      subject: 'Welcome to TideInCal!',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #007bff;">Welcome to TideInCal!</h2>
          <p>Thank you for signing up. You can now download personalized tide calendars for your favorite locations.</p>
          <p>Ready to get started? Visit our map and select a tide station to download your first calendar.</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${process.env.APP_URL}" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">Get Started</a>
          </div>
          <p style="color: #666; font-size: 14px;">Happy tide watching!</p>
          <p style="color: #666; font-size: 14px;">The TideInCal Team</p>
        </div>
      `,
      text: `Welcome to TideInCal!

Thank you for signing up. You can now download personalized tide calendars for your favorite locations.

Ready to get started? Visit our map and select a tide station to download your first calendar.

Visit: ${process.env.APP_URL}

Happy tide watching!
The TideInCal Team`
    });

    if (error) {
      console.error('Error sending welcome email:', error);
      throw error;
    }

    console.log('Welcome email sent:', data?.id);
    return data;
  } catch (error) {
    console.error('Failed to send welcome email:', error);
    throw error;
  }
}

export async function sendDownloadReady({ to, stationTitle, link }) {
  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: [to],
      subject: 'Your tide calendar is ready!',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #007bff;">Your tide calendar is ready!</h2>
          <p>Thank you for your purchase. Your personalized tide calendar for <strong>${stationTitle}</strong> has been generated and is ready for download.</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${link}" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">Download Calendar File</a>
          </div>
          <p style="color: #666; font-size: 14px;">This file will be available for download for 365 days.</p>
          <p style="color: #666; font-size: 14px;">Need help? Reply to this email or visit our support page.</p>
          <p style="color: #666; font-size: 14px;">Happy tide watching!</p>
          <p style="color: #666; font-size: 14px;">The TideInCal Team</p>
        </div>
      `,
      text: `Your tide calendar is ready!

Thank you for your purchase. Your personalized tide calendar for ${stationTitle} has been generated and is ready for download.

Download your calendar: ${link}

This file will be available for download for 365 days.

Need help? Reply to this email or visit our support page.

Happy tide watching!
The TideInCal Team`
    });

    if (error) {
      console.error('Error sending download ready email:', error);
      throw error;
    }

    console.log('Download ready email sent:', data?.id);
    return data;
  } catch (error) {
    console.error('Failed to send download ready email:', error);
    throw error;
  }
}
