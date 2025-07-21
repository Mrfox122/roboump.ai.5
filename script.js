document.getElementById('askButton').addEventListener('click', askQuestion);
document.getElementById('questionInput').addEventListener('keyup', function(event) {
    if (event.key === 'Enter') {
        askQuestion();
    }
});

async function askQuestion() {
    const questionInput = document.getElementById('questionInput');
    const question = questionInput.value;
    const answerEl = document.getElementById('answer');
    const button = document.getElementById('askButton');

    if (!question) {
        alert("Please enter a question.");
        return;
    }

    answerEl.textContent = 'Searching the rulebook...';
    button.disabled = true;

    try {
        const response = await fetch('/api/ask-gemini', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question: question }) // No longer sends ruleSet
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        answerEl.textContent = data.answer;

    } catch (error) {
        console.error("Error asking question:", error);
        answerEl.textContent = 'An error occurred. Please check the function logs on Netlify.';
    } finally {
        button.disabled = false;
    }
}