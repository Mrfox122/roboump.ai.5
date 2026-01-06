// Global variable to track the current question for feedback
let currentQuestionText = "";

document.getElementById('askButton').addEventListener('click', askQuestion);
document.getElementById('questionInput').addEventListener('keyup', function(event) {
    if (event.key === 'Enter') askQuestion();
});

async function askQuestion() {
    // (Keep all the variable declarations from before)
    const shareButton = document.getElementById('shareButton');
    shareButton.disabled = true;
    const questionInput = document.getElementById('questionInput');
    const question = questionInput.value;
    const ruleSet = document.getElementById('ruleSetSelect').value;
    const answerEl = document.getElementById('answer');
    const button = document.getElementById('askButton');
    const feedbackArea = document.getElementById('feedback-area');

    if (!question) {
        alert("Please enter a question.");
        return;
    }

    // UI Reset
    answerEl.textContent = 'Consulting the expert...';
    button.disabled = true;
    if (feedbackArea) feedbackArea.style.display = 'none';

    grecaptcha.ready(function() {
        grecaptcha.execute('6LchII8rAAAAABrbtifib5ALdna7P8h-PItnTsrE', {action: 'submit'}).then(async function(token) {
            
            // --- NEW TIMEOUT LOGIC ---
            const TIMEOUT_DURATION = 25000; // 25 seconds in milliseconds

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
                // Race the two promises. Whichever finishes first wins.
                const response = await Promise.race([fetchPromise, timeoutPromise]);

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                currentQuestionText = question; // Save for feedback
                const data = await response.json();
                answerEl.innerHTML = marked.parse(data.answer);

                // Show and reset feedback buttons
                if (feedbackArea) {
                    document.getElementById('feedback-message').textContent = '';
                    document.querySelectorAll('.feedback-btn').forEach(btn => btn.disabled = false);
                    feedbackArea.style.display = 'block';
                }
                activateShareButton(question, ruleSet);

            } catch (error) {
                console.error("Error asking question:", error);
                // Check if the error was our custom timeout
                if (error.message === 'timeout') {
                    answerEl.textContent = 'Sorry, the request timed out. The server is likely under heavy load. Please try again in a moment.';
                } else {
                    answerEl.textContent = 'Sorry, an error occurred while generating the answer. Please try again.';
                }
            } finally {
                button.disabled = false; // Always re-enable the button
            }
        });
    });
}

// --- NEW FEEDBACK LOGIC ---

// Called by Thumbs Up (👍)
function submitSimpleFeedback(score) {
    if (score === 1) {
        sendFeedbackAPI('GOOD');
    }
}

// Called by Thumbs Down (👎)
function showAdvancedFeedback() {
    document.getElementById('initial-feedback').style.display = 'none';
    document.getElementById('advanced-feedback').style.display = 'block';
}

// Called by the advanced feedback buttons
function submitAdvancedFeedback(feedbackType) {
    const comment = document.getElementById('feedback-comment').value;
    sendFeedbackAPI(feedbackType, comment);
}

// The single function that sends data to the backend
async function sendFeedbackAPI(feedback_type, comment = null) {
    const msg = document.getElementById('feedback-message');
    msg.textContent = "Saving...";
    
    // Hide all feedback buttons after a choice is made
    document.getElementById('initial-feedback').style.display = 'none';
    document.getElementById('advanced-feedback').style.display = 'none';

    try {
        await fetch('/api/submit-feedback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                question: currentQuestionText, 
                feedback_type: feedback_type,
                comment: comment
            })
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
}``