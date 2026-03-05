/**
 * Email Service
 * 
 * Fixes:
 * - Issue #17: Password reset flow implementation
 * - Async email sending
 * - Template-based emails
 */

import nodemailer, { Transporter } from 'nodemailer';
import { getConfig } from '../config/environment';

const config = getConfig();

let transporter: Transporter | null = null;

/**
 * Initialize email transporter
 */
function getTransporter(): Transporter {
  if (transporter) {
    return transporter;
  }

  // If SMTP not configured, log to console (development)
  if (!config.SMTP_HOST) {
    console.warn('⚠️  SMTP not configured - emails will be logged to console');
    
    transporter = nodemailer.createTransport({
      streamTransport: true,
      newline: 'unix',
      buffer: true
    });
    
    return transporter;
  }

  // Production SMTP configuration
  transporter = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT || 587,
    secure: config.SMTP_PORT === 465,
    auth: {
      user: config.SMTP_USER,
      pass: config.SMTP_PASSWORD
    }
  });

  return transporter;
}

/**
 * Send verification email
 */
export async function sendVerificationEmail(email: string, token: string): Promise<void> {
  const verificationUrl = `${config.CORS_ORIGIN}/verify-email?token=${token}`;
  
  const mailOptions = {
    from: config.EMAIL_FROM || 'noreply@jobber.pro',
    to: email,
    subject: 'Verify Your Email - JOBBER Pro',
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .button { 
              display: inline-block; 
              padding: 12px 24px; 
              background: #007bff; 
              color: white; 
              text-decoration: none; 
              border-radius: 4px; 
            }
            .footer { margin-top: 30px; font-size: 12px; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <h2>Welcome to JOBBER Pro!</h2>
            <p>Thank you for registering. Please verify your email address to activate your account.</p>
            <p>
              <a href="${verificationUrl}" class="button">Verify Email</a>
            </p>
            <p>Or copy and paste this link in your browser:</p>
            <p>${verificationUrl}</p>
            <p>This link will expire in 24 hours.</p>
            <div class="footer">
              <p>If you didn't create this account, please ignore this email.</p>
              <p>© ${new Date().getFullYear()} JOBBER Pro. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `,
    text: `
      Welcome to JOBBER Pro!
      
      Please verify your email address by clicking this link:
      ${verificationUrl}
      
      This link will expire in 24 hours.
      
      If you didn't create this account, please ignore this email.
    `
  };

  try {
    const transport = getTransporter();
    const info = await transport.sendMail(mailOptions);
    
    if (config.NODE_ENV === 'development') {
      console.log('✅ Verification email sent:', info.messageId);
      console.log('Preview URL:', nodemailer.getTestMessageUrl(info));
    }
  } catch (error) {
    console.error('❌ Failed to send verification email:', error);
    throw error;
  }
}

/**
 * Send password reset email
 * Issue #17 fix
 */
export async function sendPasswordResetEmail(email: string, token: string): Promise<void> {
  const resetUrl = `${config.CORS_ORIGIN}/reset-password?token=${token}`;
  
  const mailOptions = {
    from: config.EMAIL_FROM || 'noreply@jobber.pro',
    to: email,
    subject: 'Password Reset Request - JOBBER Pro',
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .button { 
              display: inline-block; 
              padding: 12px 24px; 
              background: #dc3545; 
              color: white; 
              text-decoration: none; 
              border-radius: 4px; 
            }
            .warning { 
              background: #fff3cd; 
              border-left: 4px solid #ffc107; 
              padding: 12px; 
              margin: 20px 0; 
            }
            .footer { margin-top: 30px; font-size: 12px; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <h2>Password Reset Request</h2>
            <p>We received a request to reset your password. Click the button below to proceed:</p>
            <p>
              <a href="${resetUrl}" class="button">Reset Password</a>
            </p>
            <p>Or copy and paste this link in your browser:</p>
            <p>${resetUrl}</p>
            <div class="warning">
              <strong>Security Notice:</strong>
              <ul>
                <li>This link will expire in 1 hour</li>
                <li>You can only use it once</li>
                <li>Your account will remain secure until you complete the reset</li>
              </ul>
            </div>
            <div class="footer">
              <p>If you didn't request this password reset, please ignore this email. Your password will remain unchanged.</p>
              <p>For security reasons, we recommend changing your password if you suspect unauthorized access.</p>
              <p>© ${new Date().getFullYear()} JOBBER Pro. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `,
    text: `
      Password Reset Request
      
      We received a request to reset your password.
      
      Click this link to reset your password:
      ${resetUrl}
      
      This link will expire in 1 hour.
      
      If you didn't request this password reset, please ignore this email.
    `
  };

  try {
    const transport = getTransporter();
    const info = await transport.sendMail(mailOptions);
    
    if (config.NODE_ENV === 'development') {
      console.log('✅ Password reset email sent:', info.messageId);
      console.log('Preview URL:', nodemailer.getTestMessageUrl(info));
    }
  } catch (error) {
    console.error('❌ Failed to send password reset email:', error);
    throw error;
  }
}

/**
 * Send new device notification
 * Security feature - alert user of new device login
 */
export async function sendNewDeviceNotification(
  email: string,
  deviceInfo: {
    platform: string;
    osVersion: string;
    ipAddress?: string;
    location?: string;
  }
): Promise<void> {
  const mailOptions = {
    from: config.EMAIL_FROM || 'noreply@jobber.pro',
    to: email,
    subject: 'New Device Login - JOBBER Pro',
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .warning { 
              background: #f8d7da; 
              border-left: 4px solid #dc3545; 
              padding: 12px; 
              margin: 20px 0; 
            }
            .info { background: #f8f9fa; padding: 12px; margin: 20px 0; border-radius: 4px; }
            .footer { margin-top: 30px; font-size: 12px; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <h2>New Device Login Detected</h2>
            <p>We detected a login to your JOBBER Pro account from a new device.</p>
            <div class="info">
              <strong>Device Details:</strong>
              <ul>
                <li>Platform: ${deviceInfo.platform}</li>
                <li>OS Version: ${deviceInfo.osVersion}</li>
                ${deviceInfo.ipAddress ? `<li>IP Address: ${deviceInfo.ipAddress}</li>` : ''}
                ${deviceInfo.location ? `<li>Location: ${deviceInfo.location}</li>` : ''}
                <li>Time: ${new Date().toLocaleString()}</li>
              </ul>
            </div>
            <div class="warning">
              <strong>Was this you?</strong>
              <p>If you don't recognize this login, please:</p>
              <ol>
                <li>Change your password immediately</li>
                <li>Review your account activity</li>
                <li>Contact support if you notice anything suspicious</li>
              </ol>
            </div>
            <div class="footer">
              <p>This is an automated security notification.</p>
              <p>© ${new Date().getFullYear()} JOBBER Pro. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `
  };

  try {
    const transport = getTransporter();
    await transport.sendMail(mailOptions);
  } catch (error) {
    console.error('❌ Failed to send new device notification:', error);
    // Don't throw - this is a non-critical notification
  }
}

/**
 * Send trial expiry warning
 */
export async function sendTrialExpiryWarning(
  email: string,
  daysRemaining: number
): Promise<void> {
  const mailOptions = {
    from: config.EMAIL_FROM || 'noreply@jobber.pro',
    to: email,
    subject: `Your Trial Expires in ${daysRemaining} Days - JOBBER Pro`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .button { 
              display: inline-block; 
              padding: 12px 24px; 
              background: #28a745; 
              color: white; 
              text-decoration: none; 
              border-radius: 4px; 
            }
            .footer { margin-top: 30px; font-size: 12px; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <h2>Your Trial is Ending Soon</h2>
            <p>Your JOBBER Pro trial will expire in <strong>${daysRemaining} days</strong>.</p>
            <p>Upgrade now to continue enjoying all features:</p>
            <ul>
              <li>Unlimited market data access</li>
              <li>Advanced signal engines</li>
              <li>Multi-device support</li>
              <li>Priority support</li>
            </ul>
            <p>
              <a href="${config.CORS_ORIGIN}/upgrade" class="button">Upgrade Now</a>
            </p>
            <div class="footer">
              <p>© ${new Date().getFullYear()} JOBBER Pro. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `
  };

  try {
    const transport = getTransporter();
    await transport.sendMail(mailOptions);
  } catch (error) {
    console.error('❌ Failed to send trial expiry warning:', error);
  }
}
