import axios from 'axios';

export async function handler(event) {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Parse the form data from the request body
  const params = new URLSearchParams(event.body);
  const token = params.get('recaptcha-token');
  const secretKey = process.env.RECAPTCHA_SECRET_KEY;

  const verificationURL = `https://www.google.com/recaptcha/api/siteverify?secret=${secretKey}&response=${token}`;

  try {
    const response = await axios.post(verificationURL);
    const { success, score } = response.data;

    if (success && score >= 0.5) {
      // reCAPTCHA verification successful.
      // TODO: Process the rest of the form data (e.g., save to a database).
      console.log('Form data:', params.toString());
      
      // Redirect to a success page
      return {
        statusCode: 302,
        headers: {
          Location: '/thank-you.html', // URL of your success page
        },
      };

    } else {
      // Verification failed.
      return { statusCode: 400, body: 'reCAPTCHA verification failed.' };
    }
  } catch (error) {
    return { statusCode: 500, body: 'Error verifying reCAPTCHA.' };
  }
}