// This is the frontend code that runs in the user's browser.

const askButton = document.getElementById('ask-button');
const questionInput = document.getElementById('question-input');
const answerText = document.getElementById('answer-text');
const loadingIndicator = document.getElementById('loading-indicator');
const rulebookSelector = document.getElementById('rulebook-selector');

let selectedRulebook = 'MLB'; // Default rulebook

// Handle rulebook selection
rulebookSelector.addEventListener('click', (event) => {
    if (event.target.tagName === 'BUTTON') {
        selectedRulebook = event.target.dataset.rulebook;
        // Optional: Add styling to show which button is active
        console.log(`Rulebook changed to: ${selectedRulebook}`);
    }
});

// Handle the "Ask" button click
askButton.addEventListener('click', async () => {
    const question = questionInput.value;
    if (!question) {
        alert('Please enter a question!');
        return;
    }

    // Show loading and hide old answer
    loadingIndicator.classList.remove('hidden');
    answerText.textContent = '';

    try {
        // This is the key part: it calls our backend function
        const response = await fetch('/.netlify/functions/ask-gemini', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                question: question,
                ruleSet: selectedRulebook,
            }),
        });

        const data = await response.json();

        if (response.ok) {
            answerText.textContent = data.answer;
        } else {
            throw new Error(data.error);
        }

    } catch (error) {
        answerText.textContent = `Error: ${error.message}`;
    } finally {
        // Hide loading indicator
        loadingIndicator.classList.add('hidden');
    }
});