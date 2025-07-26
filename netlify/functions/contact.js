document.getElementById('contactForm').addEventListener('submit', async function (e) {
    e.preventDefault();

    const statusDiv = document.getElementById('formStatus');
    statusDiv.innerText = 'Verifying...';

    const name = document.getElementById('name').value.trim();
    const email = document.getElementById('email').value.trim();
    const message = document.getElementById('message').value.trim();

    try {
        const token = await grecaptcha.execute('6LchII8rAAAAABrbtifib5ALdna7P8h-PItnTsrE', { action: 'submit' });

        const response = await fetch('/.netlify/functions/send-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, message, token })
        });

        const result = await response.text();

        if (response.ok) {
            statusDiv.innerText = 'Your message has been sent!';
            document.getElementById('contactForm').reset();
        } else {
            const { error } = JSON.parse(result);
            statusDiv.innerText = 'Error: ' + error;
        }
    } catch (err) {
        console.error('Unexpected error:', err);
        statusDiv.innerText = 'Something went wrong. Please try again later.';
    }
});
