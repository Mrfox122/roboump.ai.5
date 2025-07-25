document.getElementById('contactForm').addEventListener('submit', async function (e) {
    e.preventDefault();

    const name = document.getElementById('name').value;
    const email = document.getElementById('email').value;
    const message = document.getElementById('message').value;
    const statusEl = document.getElementById('formStatus');

    statusEl.textContent = 'Verifying...';

    // Get the reCAPTCHA token
    grecaptcha.ready(function() {
        grecaptcha.execute('YOUR_SITE_KEY_HERE', {action: 'submit'}).then(async function(token) {
            
            statusEl.textContent = 'Sending...';
            try {
                const response = await fetch('/api/send-email', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, email, message, token: token }) // Send the token
                });

                if (!response.ok) {
                    throw new Error('Server error');
                }
                
                statusEl.textContent = 'Thank you! Your message has been sent.';
                document.getElementById('contactForm').reset();
            } catch (error) {
                statusEl.textContent = 'An error occurred. Please try again later.';
            }
        });
    });
});