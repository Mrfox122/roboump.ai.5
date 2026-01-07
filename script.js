// Global variable to track the current question for feedback
let currentQuestionText = "";

document.getElementById('askButton').addEventListener('click', askQuestion);
document.getElementById('questionInput').addEventListener('keyup', (event) => {
    if (event.key === 'Enter') askQuestion();
});

async function askQuestion() {
    const questionInput = document.getElementById('questionInput');
    const question = questionInput.value;
    if (!question) {
        alert("Please enter a question.");
        return;
    }

    // --- 1. UI RESET ---
    const answerEl = document.getElementById('answer');
    const button = document.getElementById('askButton');
    const feedbackArea = document.getElementById('feedback-container');

    document.getElementById('shareButton').disabled = true;
    button.disabled = true;
    answerEl.textContent = 'Consulting the expert...';
    
    // Reset feedback widget to its initial state
    if (feedbackArea) {
        feedbackArea.style.display = 'none';
        document.getElementById('initial-feedback').style.display = 'block';
        document.getElementById('advanced-feedback').style.display = 'none';
        document.getElementById('feedback-message').textContent = '';
        document.getElementById('feedback-comment').value = '';
        document.getElementById('fb-explanation').checked = false;
        document.getElementById('fb-rule').checked = false;
    }

    // --- 2. API CALL ---
    const ruleSet = document.getElementById('ruleSetSelect').value;
    grecaptcha.ready(() => {
        grecaptcha.execute('6LchII8rAAAAABrbtifib5ALdna7P8h-PItnTsrE', {action: 'submit'}).then(async (token) => {
            
            // =================================================================
            // === THIS ENTIRE try...catch...finally BLOCK IS THE REPLACEMENT ===
            // =================================================================
            const TIMEOUT_DURATION = 25000; // 25 seconds

            // Promise 1: The actual API call
            const fetchPromise = fetch('/api/ask-gemini', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question, ruleSet, token })
            });

            // Promise 2: A timer
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('timeout')), TIMEOUT_DURATION)
            );

            try {
                const response = await Promise.race([fetchPromise, timeoutPromise]);

                // Check for 429 "Too Many Requests" error specifically
                if (response.status === 429) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || 'Too many requests'); 
                }

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`HTTP error! status: ${response.status} - ${errorText}`);
                }

                currentQuestionText = question;
                const data = await response.json();
                answerEl.innerHTML = marked.parse(data.answer);

                if (feedbackArea) {
                    feedbackArea.style.display = 'block';
                }
                activateShareButton(question, ruleSet);

            } catch (error) {
                console.error("Error in askQuestion:", error);
                
                // Display the correct error message to the user
                if (error.message.includes('Too many requests')) {
                    answerEl.textContent = 'The server is busy right now. Please wait a moment and try your question again.';
                } else if (error.message === 'timeout') {
                    answerEl.textContent = 'Sorry, the request timed out as it took longer than 25 seconds. Please try again.';
                } else {
                    answerEl.textContent = 'Sorry, an unexpected error occurred. Please try again.';
                }
            } finally {
                button.disabled = false; // Always re-enable the button
            }
            // =================================================================
            // === END OF THE REPLACEMENT BLOCK ===
            // =================================================================
        });
    });
}

// --- NEW FEEDBACK LOGIC ---
function submitSimpleFeedback(score) {
    if (score === 1) sendFeedbackAPI('GOOD');
}

function showAdvancedFeedback() {
    document.getElementById('initial-feedback').style.display = 'none';
    document.getElementById('advanced-feedback').style.display = 'block';
}

function handleAdvancedSubmit() {
    const explanationCheckbox = document.getElementById('fb-explanation');
    const ruleCheckbox = document.getElementById('fb-rule');
    const comment = document.getElementById('feedback-comment').value;

    let feedbackTypes = [];
    if (explanationCheckbox.checked) feedbackTypes.push('WRONG_EXPLANATION');
    if (ruleCheckbox.checked) feedbackTypes.push('WRONG_RULE');

    if (feedbackTypes.length === 0 && comment.trim() !== "") {
        feedbackTypes.push('OTHER_ISSUE');
    }
    
    if (feedbackTypes.length === 0) {
        alert("Please select an issue before submitting.");
        return;
    }

    sendFeedbackAPI(feedbackTypes.join(','), comment);
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

// --- SHARING & OTHER FUNCTIONS ---
function trackSponsorClick() {
  if (typeof gtag === 'function') gtag('event', 'click', { 'event_category': 'sponsorship', 'event_label': 'Contact Banner' });
} 

window.addEventListener('DOMContentLoaded', checkForURLParameters);

function activateShareButton(question, ruleSet) {
    const shareButton = document.getElementById('shareButton');
    const encodedQuestion = encodeURIComponent(question);
    const shareUrl = `${window.location.origin}${window.location.pathname}?ruleset=${ruleSet}&question=${encodedQuestion}`;
    shareButton.disabled = false;
    shareButton.onclick = () => {
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