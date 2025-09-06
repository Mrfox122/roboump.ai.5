const { Resend } = require('resend');
const fetch = require('node-fetch');

exports.handler = async function(event) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { name, email, message, token } = JSON.parse(event.body);

        // 1. Verify the reCAPTCHA token with Google
        const recaptchaResponse = await fetch(`https://www.google.com/recaptcha/api/siteverify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `secret=${process.env.RECAPTCHA_SECRET_KEY}&response=${token}`
        });
        const recaptchaData = await recaptchaResponse.json();

        // 2. Check if verification was successful and the score is high enough
        if (!recaptchaData.success || recaptchaData.score < 0.5) {
            console.log("reCAPTCHA verification failed:", recaptchaData['error-codes']);
            return { statusCode: 400, body: JSON.stringify({ message: 'reCAPTCHA verification failed. Please try again.' }) };
        }

        // 3. If verification passes, send the email
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
            from: 'RoboUmp AI Contact <contact@roboump.app>',
            to: process.env.CONTACT_EMAIL,
            subject: `New Message from ${name} via RoboUmp AI`,
            reply_to: email,
            html: `<p><strong>Name:</strong> ${name}</p><p><strong>Email:</strong> ${email}</p><hr><p>${message.replace(/\n/g, '<br>')}</p>`,
        });

        return { statusCode: 200, body: JSON.stringify({ message: "Your message has been sent successfully!" }) };

    } catch (error) {
        console.error("Error:", error);
        return { statusCode: 500, body: JSON.stringify({ message: "Sorry, there was an error." }) };
    }
};