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
    document.getElementById('shareButton').disabled = true;
    document.getElementById('askButton').disabled = true;
    document.getElementById('answer').textContent = 'Consulting the expert...';
    
    // Reset feedback widget to its initial state
    document.getElementById('feedback-container').style.display = 'none';
    document.getElementById('initial-feedback').style.display = 'block';
    document.getElementById('advanced-feedback').style.display = 'none';
    document.getElementById('feedback-message').textContent = '';
    document.getElementById('feedback-comment').value = '';
    document.getElementById('fb-explanation').checked = false;
    document.getElementById('fb-rule').checked = false;

    // --- 2. API CALL ---
    const ruleSet = document.getElementById('ruleSetSelect').value;
    grecaptcha.ready(() => {
        grecaptcha.execute('6LchII8rAAAAABrbtifib5ALdna7P8h-PItnTsrE', {action: 'submit'}).then(async (token) => {
            try {
                currentQuestionText = question;
                const response = await fetch('/api/ask-gemini', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ question, ruleSet, token })
                });

                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                
                const data = await response.json();
                document.getElementById('answer').innerHTML = marked.parse(data.answer);
                
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

    // If they clicked submit but didn't check a box, but wrote a comment
    if (feedbackTypes.length === 0 && comment.trim() !== "") {
        feedbackTypes.push('OTHER_ISSUE');
    }
    
    // Don't submit if there's no feedback at all
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