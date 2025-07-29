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
    grecaptcha.ready(function() {
        grecaptcha.execute('6LchII8rAAAAABrbtifib5ALdna7P8h-PItnTsrE', {action: 'submit'}).then(async function(token) {
            
            try {
                const response = await fetch('/api/ask-gemini', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    // Send the token along with the question and ruleSet
                    body: JSON.stringify({ 
                        question: question, 
                        ruleSet: ruleSet,
                        token: token 
                    }) 
                });

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const data = await response.json();
                answerEl.innerHTML = marked.parse(data.answer);

            } catch (error) {
                console.error("Error asking question:", error);
                answerEl.textContent = 'Sorry, an error occurred. Please try again.';
            } finally {
                button.disabled = false;
            }
        });
    });
}
// Your tracking function for the sponsorship banner
function trackSponsorClick() {
  if (typeof gtag === 'function') {
    gtag('event', 'click', {
      'event_category': 'sponsorship',
      'event_label': 'Contact Banner'
    });
  }
}