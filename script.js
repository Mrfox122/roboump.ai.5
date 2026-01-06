// Global variable to track the current question for feedback
let currentQuestionText = "";

document.getElementById('askButton').addEventListener('click', askQuestion);
document.getElementById('questionInput').addEventListener('keyup', function(event) {
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
    document.getElementById('shareButton').disabled = true;
    document.getElementById('askButton').disabled = true;
    document.getElementById('answer').textContent = 'Consulting the expert...';
    document.getElementById('feedback-container').style.display = 'none'; // Hide entire feedback area
    document.getElementById('initial-feedback').style.display = 'block';   // Show initial buttons
    document.getElementById('advanced-feedback').style.display = 'none'; // Hide advanced options
    document.getElementById('feedback-message').textContent = '';        // Clear status message

    // --- 2. API CALL ---
    const ruleSet = document.getElementById('ruleSetSelect').value;
    grecaptcha.ready(function() {
        grecaptcha.execute('6LchII8rAAAAABrbtifib5ALdna7P8h-PItnTsrE', {action: 'submit'}).then(async function(token) {
            try {
                currentQuestionText = question; // Save question for feedback
                const response = await fetch('/api/ask-gemini', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ question, ruleSet, token })
                });

                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                
                const data = await response.json();
                document.getElementById('answer').innerHTML = marked.parse(data.answer);
                
                // --- 3. SHOW FEEDBACK WIDGET ---
                document.getElementById('feedback-container').style.display = 'block';
                activateShareButton(question, ruleSet);

            } catch (error) {
                console.error("Error asking question:", error);
                document.getElementById('answer').textContent = 'Sorry, an error occurred. Please try again.';
            } finally {
                document.getElementById('askButton').disabled = false;
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