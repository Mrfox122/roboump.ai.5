// Global variable to track the last question asked (for feedback)
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
    const ruleSetSelect = document.getElementById('ruleSetSelect');
    const question = questionInput.value;
    const ruleSet = ruleSetSelect.value;
    const answerEl = document.getElementById('answer');
    const button = document.getElementById('askButton');

    // --- NEW: Grab feedback elements ---
    const feedbackArea = document.getElementById('feedback-area');
    const feedbackMsg = document.getElementById('feedback-message');
    const feedbackBtns = document.querySelectorAll('.feedback-btn');


    if (!question) {
        alert("Please enter a question.");
        return;
    }


    // Disable button and show loading state
    answerEl.textContent = 'Consulting the expert...';
    button.disabled = true;

    // --- NEW: Hide feedback buttons while loading new answer ---
    if (feedbackArea) feedbackArea.style.display = 'none';


    // Execute reCAPTCHA
    grecaptcha.ready(function() {
        grecaptcha.execute('6LchII8rAAAAABrbtifib5ALdna7P8h-PItnTsrE', {action: 'submit'}).then(async function(token) {

            try {
                // --- NEW: Capture question text for the feedback logic ---
                currentQuestionText = question;

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

                // --- NEW: Show feedback buttons and reset them for the new answer ---
                if (feedbackArea) {
                    feedbackArea.style.display = 'block';
                    if (feedbackMsg) feedbackMsg.textContent = ''; 
                    feedbackBtns.forEach(btn => btn.disabled = false);
                }

                activateShareButton(question, ruleSet);


            } catch (error) {
                console.error("Error asking question:", error);
                answerEl.textContent = 'Sorry, an error occurred. Please try again.';
            } finally {
                button.disabled = false;
            }
        });
    });
}

// --- NEW: Feedback Submission Function ---
async function sendFeedback(score) {
    const msg = document.getElementById('feedback-message');
    
    // Disable buttons so they can't spam click
    const buttons = document.querySelectorAll('.feedback-btn');
    buttons.forEach(btn => btn.disabled = true);

    if (msg) msg.textContent = "Saving...";

    try {
        await fetch('/api/submit-feedback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                question: currentQuestionText, 
                score: score 
            })
        });
        
        if (msg) {
            msg.textContent = score === 1 ? "Thanks! We'll keep doing that." : "Thanks! We'll look into this.";
        }
        
    } catch (err) {
        console.error(err);
        if (msg) msg.textContent = "Error saving feedback.";
    }
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

// --- SHARING FUNCTIONALITY ---

// This event listener runs the check for a shared link when the page first loads
window.addEventListener('DOMContentLoaded', checkForURLParameters);

// This is the main function that controls the Share button
function activateShareButton(question, ruleSet) {
    const shareButton = document.getElementById('shareButton');
    const encodedQuestion = encodeURIComponent(question);
    const shareUrl = `${window.location.origin}${window.location.pathname}?ruleset=${ruleSet}&question=${encodedQuestion}`;
    
    shareButton.disabled = false; // Make the button clickable

    shareButton.onclick = function() {
        // Use the modern Web Share API if available (on mobile)
        if (navigator.share) {
            navigator.share({
                title: 'RoboUmp AI Answer',
                text: `Here's the answer to "${question}":`,
                url: shareUrl,
            });
        } else {
            // Fallback for desktop: copy link to clipboard
            navigator.clipboard.writeText(shareUrl).then(function() {
                shareButton.textContent = 'Link Copied!';
                setTimeout(() => {
                    shareButton.textContent = 'Share';
                }, 2000); // Reset text after 2 seconds
            });
        }
    };
}

// This function checks for parameters in the URL when the page loads
function checkForURLParameters() {
    const params = new URLSearchParams(window.location.search);
    const question = params.get('question');
    const ruleSet = params.get('ruleset');

    if (question && ruleSet) {
        document.getElementById('questionInput').value = decodeURIComponent(question);
        document.getElementById('ruleSetSelect').value = ruleSet;
        askQuestion(); // Automatically ask the question from the shared link
    }
}