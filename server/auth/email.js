import { Resend } from 'resend';
import dotenv from 'dotenv';

dotenv.config();

// Initialize Resend lazily to avoid errors if API key is missing during evaluation
let resend;
const getResend = () => {
  if (resend) return resend;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[email] RESEND_API_KEY is missing. Email sending will be skipped.');
    return null;
  }
  resend = new Resend(apiKey);
  return resend;
};

const FROM_EMAIL = 'TideInCal <noreply@tideincal.com>';

export async function sendEmailVerification({ to, token }) {
  const client = getResend();
  if (!client) return null;

  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  const verifyUrl = `${appUrl}/verify-email?token=${encodeURIComponent(token)}`;

  try {
    const { data, error } = await client.emails.send({
      from: FROM_EMAIL,
      to: [to],
      subject: 'Verify your email for TideInCal',
      template: {
        id: '74af04fe-8e30-417d-ba78-3f237f017e65',
        variables: {
          VERIFY_URL: verifyUrl
        }
      }
    });

    if (error) {
      console.error('[email] Error sending verification email:', error.message);
      return null;
    }

    console.log('[email] Verification email sent successfully:', data?.id);
    return data;
  } catch (error) {
    console.error('[email] Unexpected error sending verification email:', error.message);
    return null;
  }
}

export async function sendPasswordReset({ to, token }) {
  const client = getResend();
  if (!client) return null;

  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  const resetUrl = `${appUrl}/reset-password?token=${encodeURIComponent(token)}`;

  try {
    const { data, error } = await client.emails.send({
      from: FROM_EMAIL,
      to: [to],
      subject: 'Reset your TideInCal password',
      template: {
        id: '058d37b8-314e-49c7-872e-983a43df96d9',
        variables: {
          RESET_PASSWORD: resetUrl
        }
      }
    });

    if (error) {
      console.error('[email] Error sending password reset email:', error.message);
      return null;
    }

    console.log('[email] Password reset email sent successfully:', data?.id);
    return data;
  } catch (error) {
    console.error('[email] Unexpected error sending password reset email:', error.message);
    return null;
  }
}

export async function sendPasswordChangeConfirmation({ to }) {
  const client = getResend();
  if (!client) return null;

  try {
    const { data, error } = await client.emails.send({
      from: FROM_EMAIL,
      to: [to],
      subject: 'Your TideInCal password was updated',
      template: {
        id: 'cc0a3043-651a-44e2-85b8-cc3051ec46db'
      }
    });

    if (error) {
      console.error('[email] Error sending password confirmation email:', error.message);
      return null;
    }

    console.log('[email] Password confirmation email sent successfully:', data?.id);
    return data;
  } catch (error) {
    console.error('[email] Unexpected error sending password confirmation email:', error.message);
    return null;
  }
}

export async function sendWelcome({ to }) {
  const client = getResend();
  if (!client) return null;

  try {
    const { data, error } = await client.emails.send({
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
      console.error('[email] Error sending welcome email:', error.message);
      return null;
    }

    console.log('[email] Welcome email sent successfully:', data?.id);
    return data;
  } catch (error) {
    console.error('[email] Unexpected error sending welcome email:', error.message);
    return null;
  }
}

export async function sendDownloadReady({ to, stationTitle, link }) {
  const client = getResend();
  if (!client) {
    console.warn('[email] Skipping download ready email: Resend client not initialized');
    return null;
  }

  try {
    const { data, error } = await client.emails.send({
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
      console.error('[email] Error sending download ready email:', error.message);
      return null;
    }

    console.log('[email] Download ready email sent successfully:', data?.id);
    return data;
  } catch (error) {
    console.error('[email] Unexpected error sending download ready email:', error.message);
    return null;
  }
}
