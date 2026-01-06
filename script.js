// Global variable to track the current question for feedback
let currentQuestionText = "";

document.getElementById('askButton').addEventListener('click', askQuestion);

document.getElementById('questionInput').addEventListener('keyup', function(event) {
    if (event.key === 'Enter') {
        askQuestion();
    }
});


async function askQuestion() {

    const shareButton = document.getElementById('shareButton');
    shareButton.disabled = true;

    const questionInput = document.getElementById('questionInput');
    const question = questionInput.value;
    const ruleSet = document.getElementById('ruleSetSelect').value;
    const answerEl = document.getElementById('answer');
    const button = document.getElementById('askButton');
    const feedbackArea = document.getElementById('feedback-container');

    if (!question) {
        alert("Please enter a question.");
        return;
    }

    // UI Reset
    answerEl.textContent = 'Consulting the expert...';
    button.disabled = true;
    if (feedbackArea) feedbackArea.style.display = 'none';


    // Execute reCAPTCHA
    grecaptcha.ready(function() {
        grecaptcha.execute('6LchII8rAAAAABrbtifib5ALdna7P8h-PItnTsrE', {action: 'submit'}).then(async function(token) {

            try {
                currentQuestionText = question;

                // --- DEBUG LOG #1 ---
                console.log("Fetching answer from API...");

                const response = await fetch('/api/ask-gemini', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ question, ruleSet, token })
                });

                if (!response.ok) {
                    // Try to get more specific error text from the server
                    const errorText = await response.text();
                    throw new Error(`HTTP error! status: ${response.status} - ${errorText}`);
                }

                const data = await response.json();
                answerEl.innerHTML = marked.parse(data.answer);

                // --- DEBUG LOG #2 ---
                console.log("Answer received and displayed. Attempting to show feedback...");

                // Show and Reset Feedback Buttons
                if (feedbackArea) {
                    document.getElementById('initial-feedback').style.display = 'block';
                    document.getElementById('advanced-feedback').style.display = 'none';
                    document.getElementById('feedback-message').textContent = '';
                    document.querySelectorAll('.feedback-btn').forEach(btn => btn.disabled = false);
                    feedbackArea.style.display = 'block'; // This is the line we're testing
                } else {
                    console.error("Critical Error: feedback-container div not found!");
                }

                activateShareButton(question, ruleSet);

            } catch (error) {
                console.error("CRASH in askQuestion function:", error);
                answerEl.textContent = 'Sorry, an error occurred. Please check the developer console (F12) for details.';
            } finally {
                button.disabled = false;
            }
        });
    });
}

// --- FEEDBACK LOGIC ---
function submitSimpleFeedback(score) {
    if (score === 1) sendFeedbackAPI('GOOD');
}

function showAdvancedFeedback() {
    document.getElementById('initial-feedback').style.display = 'none';
    document.getElementById('advanced-feedback').style.display = 'block';
}

function submitAdvancedFeedback(feedbackType) {
    const comment = document.getElementById('feedback-comment').value;
    sendFeedbackAPI(feedbackType, comment);
}

async function sendFeedbackAPI(feedback_type, comment = null) {
    const msg = document.getElementById('feedback-message');
    msg.textContent = "Saving...";
    document.getElementById('initial-feedback').style.display = 'none';
    document.getElementById('advanced-feedback').style.display = 'none';
    try {
        await fetch('/api/submit-feedback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question: currentQuestionText, feedback_type, comment })
        });
        msg.textContent = "Thank you for the feedback!";
    } catch (err) {
        console.error("Feedback submission error:", err);
        msg.textContent = "Error saving feedback.";
    }
}

// --- OTHER FUNCTIONS ---
function trackSponsorClick() {
  if (typeof gtag === 'function') gtag('event', 'click', { 'event_category': 'sponsorship', 'event_label': 'Contact Banner' });
} 

window.addEventListener('DOMContentLoaded', checkForURLParameters);

function activateShareButton(question, ruleSet) {
    const shareButton = document.getElementById('shareButton');
    const encodedQuestion = encodeURIComponent(question);
    const shareUrl = `${window.location.origin}${window.location.pathname}?ruleset=${ruleSet}&question=${encodedQuestion}`;
    shareButton.disabled = false;
    shareButton.onclick = function() {
        if (navigator.share) {
            navigator.share({ title: 'RoboUmp AI Answer', text: `Here's the answer to "${question}":`, url: shareUrl });
        } else {
            navigator.clipboard.writeText(shareUrl).then(() => {
                shareButton.textContent = 'Link Copied!';
                setTimeout(() => { shareButton.textContent = 'Share'; }, 2000);
            });
        }
    };
}

function checkForURLParameters() {
    const params = new URLSearchParams(window.location.search);
    const question = params.get('question');
    const ruleSet = params.get('ruleset');
    if (question && ruleSet) {
        document.getElementById('questionInput').value = decodeURIComponent(question);
        document.getElementById('ruleSetSelect').value = ruleSet;
        askQuestion();
    }
}