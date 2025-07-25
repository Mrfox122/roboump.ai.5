// netlify/functions/send-email.js
const { Resend } = require('resend');
const fetch = require('node-fetch'); // You'll need to install this

exports.handler = async function(event) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const { name, email, message, token } = JSON.parse(event.body);

    // 1. Verify the reCAPTCHA token
    const recaptchaResponse = await fetch(`https://www.google.com/recaptcha/api/siteverify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `secret=${process.env.RECAPTCHA_SECRET_KEY}&response=${token}`
    });
    
    const recaptchaData = await recaptchaResponse.json();

    // 2. Check the verification score
    if (!recaptchaData.success || recaptchaData.score < 0.5) {
        console.log("reCAPTCHA verification failed:", recaptchaData['error-codes']);
        return { statusCode: 400, body: JSON.stringify({ error: 'reCAPTCHA verification failed. Please try again.' }) };
    }

    // 3. If verification passes, send the email
    const resend = new Resend(process.env.RESEND_API_KEY);
    const recipientEmail = process.env.CONTACT_EMAIL;

    try {
        await resend.emails.send({
            from: 'contact@roboump.app',
            to: recipientEmail,
            subject: `New Sponsorship Inquiry from ${name}`,
            html: `<p><strong>Name:</strong> ${name}</p><p><strong>Email:</strong> ${email}</p><p><strong>Message:</strong></p><p>${message}</p>`
        });

        return { statusCode: 200, body: 'Email sent' };
    } catch (error) {
        console.error(error);
        return { statusCode: 500, body: JSON.stringify({ error: 'Error sending email' }) };
    }
};