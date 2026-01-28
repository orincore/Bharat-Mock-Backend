const nodemailer = require('nodemailer');

const smtpSecure = (process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';
const smtpPort = parseInt(process.env.SMTP_PORT, 10) || (smtpSecure ? 465 : 587);

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: smtpPort,
  secure: smtpSecure,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  },
  pool: true,
  maxConnections: 5,
  connectionTimeout: 10000,
  greetingTimeout: 5000,
  socketTimeout: 10000,
  tls: {
    rejectUnauthorized: false
  }
});

const sendWelcomeEmail = async (userEmail, userName) => {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn('SMTP environment variables missing, skipping welcome email send');
    return;
  }

  const mailOptions = {
    from: process.env.EMAIL_FROM,
    to: userEmail,
    subject: 'Welcome to Bharat Mock - Your Learning Journey Begins!',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body {
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background-color: #f5f5f5;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            background-color: #ffffff;
          }
          .header {
            background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
            padding: 40px 20px;
            text-align: center;
          }
          .logo {
            color: #ffffff;
            font-size: 32px;
            font-weight: bold;
            margin: 0;
          }
          .content {
            padding: 40px 30px;
          }
          .greeting {
            font-size: 24px;
            font-weight: 600;
            color: #1f2937;
            margin-bottom: 20px;
          }
          .message {
            font-size: 16px;
            line-height: 1.6;
            color: #4b5563;
            margin-bottom: 30px;
          }
          .cta-button {
            display: inline-block;
            background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
            color: #ffffff;
            text-decoration: none;
            padding: 14px 32px;
            border-radius: 8px;
            font-weight: 600;
            font-size: 16px;
            margin: 20px 0;
          }
          .features {
            margin: 30px 0;
          }
          .feature-item {
            display: flex;
            align-items: flex-start;
            margin-bottom: 20px;
          }
          .feature-icon {
            width: 40px;
            height: 40px;
            background: #ede9fe;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-right: 15px;
            flex-shrink: 0;
          }
          .feature-text {
            flex: 1;
          }
          .feature-title {
            font-weight: 600;
            color: #1f2937;
            margin-bottom: 5px;
          }
          .feature-desc {
            color: #6b7280;
            font-size: 14px;
          }
          .footer {
            background-color: #f9fafb;
            padding: 30px;
            text-align: center;
            border-top: 1px solid #e5e7eb;
          }
          .footer-text {
            color: #6b7280;
            font-size: 14px;
            margin: 5px 0;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 class="logo">Bharat Mock</h1>
          </div>
          
          <div class="content">
            <h2 class="greeting">Welcome, ${userName}! 🎉</h2>
            
            <p class="message">
              We're thrilled to have you join the Bharat Mock community! Your personalized dashboard is now ready.
            </p>
            
            <p class="message">
              Jump back into mock tests curated for your interests, review analytics, and keep honing your exam strategy.
            </p>
            
            <div style="text-align: center;">
              <a href="${process.env.FRONTEND_URL}" class="cta-button">Go to Dashboard</a>
            </div>
            
            <div class="features">
              <div class="feature-item">
                <div class="feature-icon">📚</div>
                <div class="feature-text">
                  <div class="feature-title">Comprehensive Mock Tests</div>
                  <div class="feature-desc">Access a wide range of mock exams tailored to your preparation needs</div>
                </div>
              </div>
              
              <div class="feature-item">
                <div class="feature-icon">📊</div>
                <div class="feature-text">
                  <div class="feature-title">Detailed Analytics</div>
                  <div class="feature-desc">Track your performance with in-depth reports and insights</div>
                </div>
              </div>
              
              <div class="feature-item">
                <div class="feature-icon">🎯</div>
                <div class="feature-text">
                  <div class="feature-title">Personalized Learning</div>
                  <div class="feature-desc">Get exam recommendations based on your interests and goals</div>
                </div>
              </div>
            </div>
            
            <p class="message">
              If you have any questions or need assistance, our support team is always here to help.
            </p>
          </div>
          
          <div class="footer">
            <p class="footer-text">© ${new Date().getFullYear()} Bharat Mock. All rights reserved.</p>
            <p class="footer-text">You're receiving this email because you signed up for Bharat Mock.</p>
          </div>
        </div>
      </body>
      </html>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Welcome email sent to ${userEmail}`);
  } catch (error) {
    console.error('Error sending welcome email:', error);
    throw error;
  }
};

const sendPasswordOtpEmail = async (userEmail, userName, otpCode) => {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn('SMTP environment variables missing, skipping password OTP email send');
    return;
  }

  const mailOptions = {
    from: process.env.EMAIL_FROM,
    to: userEmail,
    subject: 'Your Bharat Mock password reset code',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 24px; }
          .card { max-width: 520px; margin: 0 auto; background: #fff; border-radius: 16px; border: 1px solid #e5e7eb; box-shadow: 0 20px 35px rgba(15,23,42,0.08); overflow: hidden; }
          .header { background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); padding: 32px; color: #fff; text-align: center; }
          .content { padding: 32px; color: #1f2937; }
          .otp { font-size: 32px; letter-spacing: 8px; font-weight: 700; color: #111827; text-align: center; margin: 24px 0; }
          .info { font-size: 14px; color: #6b7280; line-height: 1.6; text-align: center; }
          .footer { padding: 24px 32px 32px; text-align: center; font-size: 13px; color: #9ca3af; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="header">
            <h1 style="margin: 0; font-size: 26px;">Password reset code</h1>
          </div>
          <div class="content">
            <p>Hi ${userName || 'there'},</p>
            <p>Use the following one-time code to reset your Bharat Mock password. This code stays valid for the next 15 minutes.</p>
            <div class="otp">${otpCode}</div>
            <div class="info">
              Didn't request this? You can safely ignore this email.
            </div>
          </div>
          <div class="footer">
            © ${new Date().getFullYear()} Bharat Mock. All rights reserved.
          </div>
        </div>
      </body>
      </html>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Password OTP email sent to ${userEmail}`);
  } catch (error) {
    console.error('Error sending password OTP email:', error);
    throw error;
  }
};

module.exports = {
  sendWelcomeEmail,
  sendPasswordOtpEmail
};
