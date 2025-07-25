document.getElementById('askButton').addEventListener('click', askQuestion);
document.getElementById('questionInput').addEventListener('keyup', function(event) {
    if (event.key === 'Enter') {
        askQuestion();
    }
});

async function askQuestion() {
    const questionInput = document.getElementById('questionInput');
    const ruleSetSelect = document.getElementById('ruleSetSelect');
    const question = questionInput.value;
    const ruleSet = ruleSetSelect.value;
    const answerEl = document.getElementById('answer');
    const button = document.getElementById('askButton');

    if (!question) {
        alert("Please enter a question.");
        return;
    }


// Disable button and show loading state
    answerEl.textContent = 'Consulting the expert...';
    button.disabled = true;


 // Execute reCAPTCHA
    try {
        // Wait for the reCAPTCHA script to be ready
        await grecaptcha.ready();
        // Wait for the token to be generated
        const token = await grecaptcha.execute('YOUR_SITE_KEY', { action: 'submit' });

        // Wait for the response from your Netlify Function
        const response = await fetch('/.netlify/functions/submit-form', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                ruleSet: ruleSetSelect.value,
                question: question,
                'recaptcha-token': token
            })
        });

        if (!response.ok) {
            // Throw an error if the server response is not successful
            throw new Error(`Server error: ${response.statusText}`);
        }

        const data = await response.json();
        answerEl.innerHTML = marked.parse(data.answer);

    } catch (error) {
        console.error('Error:', error);
        answerEl.textContent = 'Sorry, an error occurred. Please try again.';
    } finally {
        // This block will run whether the try succeeds or fails
        button.disabled = false;
    }
}