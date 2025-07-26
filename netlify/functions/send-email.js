//send-email.js

exports.handler = async function(event) {
    console.log("Received event:", event.body);

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    let parsed;
    try {
        parsed = JSON.parse(event.body);
    } catch (err) {
        console.error("Invalid JSON:", err);
        return { statusCode: 400, body: 'Invalid JSON' };
    }

    const { name, email, message, token } = parsed;

    // Log fields to verify input
    console.log("Parsed fields:", { name, email, message, token });

    // 1. Verify reCAPTCHA
    const recaptchaResponse = await fetch(`https://www.google.com/recaptcha/api/siteverify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `secret=${process.env.RECAPTCHA_SECRET_KEY}&response=${token}`
    });

    const recaptchaData = await recaptchaResponse.json();
    console.log("reCAPTCHA result:", recaptchaData);

    if (!recaptchaData.success || recaptchaData.score < 0.5) {
        return { statusCode: 400, body: JSON.stringify({ error: 'reCAPTCHA verification failed' }) };
    }

    // 2. Send the email
    const resend = new Resend(process.env.RESEND_API_KEY);
    const recipientEmail = process.env.CONTACT_EMAIL;

    console.log("Attempting to send email to:", recipientEmail);

    try {
        const result = await resend.emails.send({
            from: 'contact@roboump.app',
            to: recipientEmail,
            subject: `New Sponsorship Inquiry from ${name}`,
            html: `<p><strong>Name:</strong> ${name}</p><p><strong>Email:</strong> ${email}</p><p><strong>Message:</strong></p><p>${message}</p>`
        });

        console.log("Email sent result:", result);
        return { statusCode: 200, body: 'Email sent' };
    } catch (error) {
        console.error("Error sending email:", error);
        return { statusCode: 500, body: JSON.stringify({ error: 'Error sending email' }) };
    }
};
