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

    answerEl.textContent = 'Consulting the expert...';
    button.disabled = true;

    try {
        const response = await fetch('/api/ask-gemini', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question: question, ruleSet: ruleSet }) 
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        
        // Convert the markdown answer to HTML and display it
        answerEl.innerHTML = marked.parse(data.answer);

    } catch (error) {
        console.error("Error asking question:", error);
        answerEl.textContent = 'An error occurred. Please check the function logs on Netlify.';
    } finally {
        button.disabled = false;
    }
}