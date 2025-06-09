# Smart Shop Backend - Email & SMS Services Setup

## Email Service (Nodemailer)

The email service is now implemented using Nodemailer with support for multiple email providers.

### Development Setup
For development, the service uses Ethereal Email (test service) by default. No additional setup required.

### Production Setup

#### Option 1: Gmail (Recommended for small projects)
1. Enable 2-factor authentication on your Google account
2. Generate an App Password: https://support.google.com/accounts/answer/185833
3. Update your `.env` file:
```
EMAIL_USER=your-gmail@gmail.com
EMAIL_PASSWORD=your-app-password
```

#### Option 2: SendGrid, AWS SES, or other providers
Modify the `createTransporter()` function in `utils/emailService.js` to use your preferred provider.

## SMS Service (Twilio)

The SMS service is now implemented using Twilio.

### Setup Instructions
1. Sign up for a Twilio account: https://www.twilio.com/try-twilio
2. Get your Account SID and Auth Token from the Twilio Console
3. Purchase a phone number from Twilio
4. Update your `.env` file:
```
TWILIO_ACCOUNT_SID=your-account-sid
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_PHONE_NUMBER=+1234567890
```

### Development Mode
- If Twilio credentials are not configured in development mode, OTPs will be logged to console
- This allows development without SMS service setup

## Environment Variables

Copy `.env.example` to `.env` and configure the following variables:

### Required for Email Service
- `EMAIL_FROM`: The "from" address for emails
- `EMAIL_USER`: Email service username (production)
- `EMAIL_PASSWORD`: Email service password (production)

### Required for SMS Service
- `TWILIO_ACCOUNT_SID`: Your Twilio Account SID
- `TWILIO_AUTH_TOKEN`: Your Twilio Auth Token  
- `TWILIO_PHONE_NUMBER`: Your Twilio phone number

### Development Only
- `ETHEREAL_EMAIL`: Test email username (for development)
- `ETHEREAL_PASSWORD`: Test email password (for development)

## Testing

### Email Testing
In development mode, check the console for a preview URL to view sent emails in the browser.

### SMS Testing
In development mode without Twilio setup, OTPs will be logged to console for testing.

## Security Notes

1. **Never commit `.env` files** to version control
2. Use **App Passwords** for Gmail, not your regular password
3. **Rotate credentials** regularly in production
4. Consider using **environment-specific configurations** for different deployment stages

## Error Handling

Both services include comprehensive error handling:
- Development mode gracefully degrades when services aren't configured
- Production mode throws errors for missing configurations
- All errors are logged for debugging

## Cost Considerations

- **Email**: Nodemailer with Gmail is free for low volumes
- **SMS**: Twilio charges per message (check current rates)
- Consider implementing **rate limiting** to prevent abuse
